// Testes da 0.4.3: o 1o nome sozinho nao liga a planilha a um tecnico com 2o nome diferente.
// Uso: node scripts/check/teste09.js <pasta n8n 0.4.2> <pasta n8n 0.4.3>   (dados ficticios, sem banco)
const fs = require('fs'); const { run } = require('./harness');
const [A, B] = process.argv.slice(2);
const ler = (d, f) => Object.fromEntries(JSON.parse(fs.readFileSync(d + '/' + f, 'utf8')).nodes.filter(n => n.parameters.jsCode).map(n => [n.name, n.parameters.jsCode]));
const W3 = '03_IXC_Comandos_e_Consulta_de_Escala.json', W1 = '01_IXC_Notificacoes_WhatsApp.json';
const V3 = ler(A, W3), N3 = ler(B, W3), V1 = ler(A, W1), N1 = ler(B, W1);
let ok = 0; const falhas = []; const check = (n, c, x) => { if (c) ok++; else { falhas.push(n); console.log('  ✘', n, '\n' + (x || '')); } };
const clone = x => JSON.parse(JSON.stringify(x));
const hoje = '2026-11-24', amanha = '2026-11-25';
const dias = { seg: '10:00-22:00', ter: '10:00-22:00', qua: '10:00-22:00', qui: '10:00-22:00', sex: '10:00-22:00', sab: '10:00-22:00', dom: '10:00-22:00' };
const T0 = [{ empresa: 'CACTA', id_func: '31', nome: 'Joao Henrique', fone: '5541900000031' },
  { empresa: 'CACTA', id_func: '32', nome: 'Joao Soares', fone: '5541900000032' },
  { empresa: 'CACTA', id_func: '12', nome: 'Juliano', fone: '5541900000012' }];
const base = {
  hoje: hoje + ' 13:02', empresas: [{ id: 'CACTA', nome: 'Cacta Telecom' }], tecnicos: T0,
  locais: [{ empresa: 'CACTA', id_condominio: '263', nome: 'Jockey Plaza', tec_padrao: null }],
  escala_base: [Object.assign({ empresa: 'CACTA', id_condominio: '263', tipo: '12x36', obs: 'revezam 12x36',
    tecnicos: 'Joao Henrique (41) 90000-0031; Joao Soares (41) 90000-0032; Juliano (41) 90000-0012' }, dias)],
  escala_dia: [{ data: hoje, empresa: 'CACTA', id_condominio: '263', tecnico: 'Joao Soares' }, { data: amanha, empresa: 'CACTA', id_condominio: '263', tecnico: 'Juliano' }],
  param: { escala_grupos: 'gA@g.us', setores_grupo: 'gR@g.us' }, setores: [], mensagens: {}, apelidos: [] };
const com = f => { const c = clone(base); f(c); return c; };
const tec = (c, id) => c.tecnicos.find(t => t.id_func === id);
const filtro = (c, t) => run(c['Escala: Filtrar Pergunta'], { item: { json: {} }, nodes: {
  'WAHA: Normalizar': [{ json: { data: { key: { remoteJid: 'gA@g.us', id: 'X', participant: 'p@c.us', fromMe: false }, message: { conversation: t } } } }],
  'Carregar Parametros': [{ json: { grupo_automacao: 'gA@g.us', setores_grupo: 'gR@g.us', perguntas: '[]' } }] } });
const resp = (c, t, cfg) => { const f = filtro(c, t); if (!f.length) return null; const r = run(c['Escala: Montar Resposta'], { item: { json: {} }, nodes: { 'Escala: Filtrar Pergunta': f, 'Escala: Buscar Dados': [{ json: { cfg } }] } }); return r.length ? r[0].json.resposta : ''; };
const cmd = (c, args, cfg) => run(c['IXC Cmd: Interpretar'], { item: { json: {} }, nodes: { 'IXC Cmd: Filtrar': [{ json: { args, autor: 'x', texto: 'ixc ' + args } }], 'IXC Cmd: Carregar': [{ json: { cfg } }] } })[0].json.resposta || '';
const P = 'quem está no jockey';
const hojeL = r => (String(r).split('*Hoje')[1] || '').split('*Amanhã')[0];

// 0) sem renomear: Joao Soares certo (desempate pelo 2o nome) nas duas
check('sem renomear 0.4.2 ok', /👤 Joao Soares — @5541900000032/.test(hojeL(resp(V3, P, base))));
check('sem renomear 0.4.3 igual a 0.4.2', resp(V3, P, base) === resp(N3, P, base));
// 1) o caso do print: ID 32 renomeado sem relacao, sobrou so o Joao Henrique
let c = com(c => { tec(c, '32').nome = 'JS Teste'; });
let a = hojeL(resp(V3, P, c)), b = hojeL(resp(N3, P, c));
check('0.4.2 reproduz o bug (Joao Henrique)', /👤 Joao Henrique — @5541900000031/.test(a), a);
check('0.4.3 liga pelo telefone da Equipe: JS Teste', /👤 JS Teste — @5541900000032/.test(b) && !/Henrique/.test(b), b);
// 2) renomeado mantendo o nome dentro
c = com(c => { tec(c, '32').nome = 'Testinho - Joao Soares'; });
b = hojeL(resp(N3, P, c));
check('0.4.3 nome contido: Testinho - Joao Soares', /👤 Testinho - Joao Soares — @5541900000032/.test(b), b);
// 3) renomeado sem relacao e sem a Equipe: nao inventa o Henrique (fica o nome da planilha, sem @)
c = com(c => { tec(c, '32').nome = 'JS Teste'; c.escala_base[0].tecnicos = ''; });
b = hojeL(resp(N3, P, c));
check('0.4.3 sem Equipe: nome da planilha, sem @ do Henrique', /👤 Joao Soares/.test(b) && !/5541900000031|Henrique/.test(b), b);
// 4) Nome na planilha continua mandando
c = com(c => { Object.assign(tec(c, '32'), { nome: 'Fulano', nome_planilha: 'Joao Soares' }); });
check('nome na planilha continua valendo', /👤 Fulano — @5541900000032/.test(hojeL(resp(N3, P, c))));
// 5) planilha so "Joao" com um unico joao no cadastro: liga (2o nome ausente nao contradiz)
c = com(c => { tec(c, '32').nome = 'JS Teste'; c.escala_dia[0].tecnico = 'Joao'; c.escala_base[0].tecnicos = 'Joao Henrique (41) 90000-0031'; });
check('planilha so "Joao" + unico joao: liga', /👤 Joao Henrique — @5541900000031/.test(hojeL(resp(N3, P, c))));
// 6) ixc quem
c = com(c => { tec(c, '32').nome = 'JS Teste'; });
b = cmd(N3, 'quem jockey', c);
check('ixc quem jockey: JS Teste, sem Henrique hoje', /JS Teste/.test(b) && !/Hoje[^\n]*\n[^\n]*Henrique/.test(b), b);
// 7) Juliano / 0.4.2 continua
c = com(c => { tec(c, '12').nome = 'Testinho - Juliano'; });
check('0.4.2 Juliano continua', /👤 Testinho - Juliano — @5541900000012/.test(resp(N3, P, c)));

// WF 01 Rotear
const c1 = { empresas: [{ id: 'CACTA', nome: 'Cacta' }], tecnicos: T0.map(t => Object.assign({ grupo: null }, t)),
  locais: [{ empresa: 'CACTA', id_condominio: '263', nome: 'Jockey Plaza', grupo: 'gJ@g.us', marcar_sem_tec: [] }],
  funcionarios: [], param: {}, pendentes: [], lembretes: [], mensagens: {}, escala_hoje: [{ empresa: 'CACTA', id_condominio: '263', tecnico: 'Joao Soares' }] };
const rotear = (code, cfg, t) => run(code['Rotear'], { items: [{ json: { registros: [{ id: '5', razao: 'Cli', id_condominio: '263' }] } }], nodes: {
  'Carregar Config': [{ json: { cfg } }],
  'Processar Eventos': [{ json: { empresa: 'CACTA', id_evento: '8', id_chamado: '77', id_tecnico: t, mensagem: 'x' } }],
  'Buscar Chamado': [{ json: { registros: [{ id: '77', protocolo: 'P77', id_condominio: '263', id_tecnico: t, id_assunto: '1', data_abertura: '2026-01-01 00:00:00' }] } }] } })[0].json;
const c1r = clone(c1); c1r.tecnicos.find(t => t.id_func === '32').nome = 'Testinho - Joao Soares';
let r0 = rotear(V1, c1r, '31'), r = rotear(N1, c1r, '31');
check('WF01 0.4.2: Henrique atribuido NAO ganhava folga (achava que era o plantao)', !r0.folga, JSON.stringify(r0.folga));
check('WF01 0.4.3: Henrique atribuido -> folga, plantao Testinho - Joao Soares', /plantão no Jockey Plaza: Testinho - Joao Soares$/.test(r.folga || ''), JSON.stringify(r.folga));
check('WF01 0.4.3 marca o plantonista certo (o 31 e o atribuido)', (r.marcar || []).includes('5541900000032'), JSON.stringify(r.marcar));
check('WF01 0.4.3: Soares renomeado atribuido -> sem folga', !rotear(N1, c1r, '32').folga);
r = rotear(N1, c1, '31'); r0 = rotear(V1, c1, '31');
check('WF01 sem renomear, 0.4.2 ja errava: Henrique sem folga com planilha "Joao Soares"', !r0.folga);
check('WF01 sem renomear, 0.4.3: folga com plantao Joao Soares', /plantão no Jockey Plaza: Joao Soares$/.test(r.folga || '') && r.marcar.includes('5541900000032'), JSON.stringify(r.folga));
r = rotear(N1, c1, '32'); r0 = rotear(V1, c1, '32');
check('WF01 sem renomear, Soares atribuido: igual a 0.4.2 (sem folga)', !r.folga && !r0.folga && JSON.stringify(r.marcar) === JSON.stringify(r0.marcar));
console.log('ok:', ok, 'falhas:', JSON.stringify(falhas)); process.exit(falhas.length ? 1 : 0);
