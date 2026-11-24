// Testes da 0.4.1: nome do tecnico do cadastro (Painel do Bot) nos shoppings 12x36 / plantao da planilha.
// Uso: node scripts/check/teste07.js <pasta n8n 0.4.0> <pasta n8n 0.4.1> <cfgs.json da 0.4.0>
// Nomes e telefones ficticios. Planilha diz "Juliano" (hoje) e "Joao Pedro" (amanha) no 4B:199 (12x36).
const fs = require('fs'); const { run } = require('./harness');
const [A, B, CF] = process.argv.slice(2);
const ler = (d, f) => Object.fromEntries(JSON.parse(fs.readFileSync(d + '/' + f, 'utf8')).nodes.filter(n => n.parameters.jsCode).map(n => [n.name, n.parameters.jsCode]));
const W3 = '03_IXC_Comandos_e_Consulta_de_Escala.json', W1 = '01_IXC_Notificacoes_WhatsApp.json';
const V3 = ler(A, W3), N3 = ler(B, W3), V1 = ler(A, W1), N1 = ler(B, W1);
const CFG = JSON.parse(fs.readFileSync(CF, 'utf8'));
let ok = 0; const falhas = []; const check = (n, c, x) => { if (c) ok++; else { falhas.push(n); if (x !== undefined) console.log('  ✘', n, '\n' + x); } };
const clone = x => JSON.parse(JSON.stringify(x));
const q0 = JSON.parse(fs.readFileSync(B + '/' + W3, 'utf8')).nodes;
check('Buscar Dados le nome_planilha (to_jsonb)', q0.find(n => n.name === 'Escala: Buscar Dados').parameters.query.includes("to_jsonb(t)->>'nome_planilha'"));
check('IXC Cmd: Carregar le nome_planilha', q0.find(n => n.name === 'IXC Cmd: Carregar').parameters.query.includes("to_jsonb(t)->>'nome_planilha'"));

const base = clone(CFG['03:Escala: Buscar Dados']); base.mensagens = {};
base.param.escala_grupos = 'gA@g.us'; base.param.setores_grupo = 'gR@g.us';
const [hoje] = String(base.hoje).split(' ');
const amanha = (() => { const d = new Date(hoje + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
base.escala_dia = base.escala_dia.filter(d => !(d.empresa === '4B' && d.id_condominio === '199'))
  .concat([{ data: hoje, empresa: '4B', id_condominio: '199', tecnico: 'Juliano' }, { data: amanha, empresa: '4B', id_condominio: '199', tecnico: 'Joao Pedro' }]);
const T = [{ empresa: '4B', id_func: '901', nome: 'Juliano Silva', fone: '5541900000901' }, { empresa: '4B', id_func: '902', nome: 'Joao Pedro Souza', fone: '5541900000902' },
  { empresa: '4B', id_func: '903', nome: 'Joao Soares', fone: '5541900000903' }];
base.tecnicos = base.tecnicos.filter(t => !/^(juliano|joao)/i.test(t.nome)).concat(T);
const com = (f) => { const c = clone(base); f(c.tecnicos); return c; };

const filtro = (c, t) => run(c['Escala: Filtrar Pergunta'], { item: { json: {} }, nodes: {
  'WAHA: Normalizar': [{ json: { data: { key: { remoteJid: 'gA@g.us', id: 'X', participant: 'p@c.us', fromMe: false }, message: { conversation: t } } } }],
  'Carregar Parametros': [{ json: { grupo_automacao: 'gA@g.us', setores_grupo: 'gR@g.us', perguntas: '[]' } }] } });
const resp = (c, t, cfg) => { const f = filtro(c, t); if (!f.length) return null; const r = run(c['Escala: Montar Resposta'], { item: { json: {} }, nodes: { 'Escala: Filtrar Pergunta': f, 'Escala: Buscar Dados': [{ json: { cfg } }] } }); return r.length ? r[0].json.resposta : ''; };
const cmd = (c, args, cfg) => run(c['IXC Cmd: Interpretar'], { item: { json: {} }, nodes: { 'IXC Cmd: Filtrar': [{ json: { args, autor: 'x', texto: 'ixc ' + args } }], 'IXC Cmd: Carregar': [{ json: { cfg } }] } })[0].json.resposta || '';
const P = 'quem está no palladium curitiba?';

// 1) cadastro sem renomear: 0.4.0 mostrava o nome da planilha; 0.4.1 mostra o do cadastro + telefone do cadastro
let a = resp(V3, P, base), b = resp(N3, P, base);
check('0.4.0 mostrava o nome da planilha', /👤 Juliano —/.test(a), a);
check('0.4.1 mostra o nome do cadastro', /👤 Juliano Silva — @5541900000901/.test(b), b);
check('0.4.1 desempata Joao pelo 2o nome', /👤 Joao Pedro Souza — @5541900000902/.test(b), b);
// 2) renomeado no painel com "nome na planilha"
let c = com(t => { t.find(x => x.id_func === '901').nome = 'Mirandinha'; t.find(x => x.id_func === '901').nome_planilha = 'Juliano'; });
b = resp(N3, P, c);
check('renomeado + nome na planilha: mostra o nome novo', /👤 Mirandinha — @5541900000901/.test(b), b);
check('0.4.0 continuava com o nome da planilha', /👤 Juliano/.test(resp(V3, P, c)));
// 3) renomeado SEM nome na planilha: nao liga -> como antes (nome da planilha)
c = com(t => { t.find(x => x.id_func === '901').nome = 'Mirandinha'; });
b = resp(N3, P, c);
check('renomeado sem nome na planilha: volta ao nome da planilha', /👤 Juliano/.test(b) && !/Mirandinha/.test(b), b);
// 4) "ixc quem palladium curitiba" e "ixc quem mirandinha"
c = com(t => { t.find(x => x.id_func === '901').nome = 'Mirandinha'; t.find(x => x.id_func === '901').nome_planilha = 'Juliano'; });
const ccmd = Object.assign(clone(CFG['03:IXC Cmd: Carregar']), { tecnicos: c.tecnicos, escala_dia: c.escala_dia, mensagens: {} });
b = cmd(N3, 'quem palladium curitiba', ccmd);
check('ixc quem <shopping> mostra o nome do cadastro', /Mirandinha/.test(b), b);
b = cmd(N3, 'quem mirandinha', ccmd);
check('ixc quem <nome do cadastro> acha o 12x36', /Palladium Curitiba/.test(b), b);
check('0.4.0 nao achava pelo nome do cadastro', !/Palladium Curitiba/.test(cmd(V3, 'quem mirandinha', ccmd)));
// 5) outros shoppings (nao 12x36) iguais a 0.4.0
for (const p of ['quem está no jockey?', 'quem ta no pontal hoje', 'quem está no sinop amanhã', 'quem atende no city center campo largo?']) {
  const x = resp(V3, p, base), y = resp(N3, p, base);
  check('igual a 0.4.0 fora do 4B:199: ' + p, x === y || !/Juliano|Joao/.test(x + y), x + '\n---\n' + y);
}

// WF 01 Rotear: tecnico atribuido no 12x36, planilha diz "Juliano" hoje
const c1 = clone(CFG['01:Carregar Config']); c1.mensagens = {};
const loc = c1.locais.find(l => l.empresa === '4B' && l.id_condominio === '199');
c1.tecnicos = c1.tecnicos.filter(t => !/^(juliano|joao)/i.test(t.nome)).concat(T.map(t => Object.assign({ grupo: null }, t)));
c1.escala_hoje = [{ empresa: '4B', id_condominio: '199', tecnico: 'Juliano' }];
const rotear = (code, cfg, tec) => run(code['Rotear'], { items: [{ json: { registros: [{ id: '5', razao: 'Cli', id_condominio: '199' }] } }], nodes: {
  'Carregar Config': [{ json: { cfg } }],
  'Processar Eventos': [{ json: { empresa: '4B', id_evento: '8', id_chamado: '77', id_tecnico: tec, mensagem: 'x' } }],
  'Buscar Chamado': [{ json: { registros: [{ id: '77', protocolo: 'P77', id_condominio: '199', id_tecnico: tec, id_assunto: '1', data_abertura: '2026-01-01 00:00:00' }] } }] } })[0].json;
let r = rotear(N1, c1, '901');
check('WF01: Juliano de plantao nao gera folga', !r.folga, JSON.stringify(r.folga));
const c1r = clone(c1); Object.assign(c1r.tecnicos.find(t => t.id_func === '901'), { nome: 'Mirandinha', nome_planilha: 'Juliano' });
r = rotear(N1, c1r, '901');
check('WF01: renomeado + nome na planilha nao gera folga falsa', !r.folga, JSON.stringify(r.folga));
check('WF01 0.4.0: renomeado gerava folga falsa', !!rotear(V1, c1r, '901').folga);
r = rotear(N1, c1r, '903');
check('WF01: outro tecnico -> folga com o plantao pelo nome do cadastro', /plantão no .*: Mirandinha$/.test(r.folga || ''), JSON.stringify(r.folga));
check('WF01: marca o plantonista', (r.marcar || []).includes('5541900000901'), JSON.stringify(r.marcar));
r = rotear(N1, c1, '903'); const r0 = rotear(V1, c1, '903');
check('WF01: sem renomear, folga igual a 0.4.0 (so troca o nome exibido)', !!r.folga && !!r0.folga && JSON.stringify(r.marcar) === JSON.stringify(r0.marcar), JSON.stringify([r.folga, r0.folga]));
console.log('ok:', ok, 'falhas:', JSON.stringify(falhas)); process.exit(falhas.length ? 1 : 0);
