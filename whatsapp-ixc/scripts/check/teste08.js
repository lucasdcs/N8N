// Testes da 0.4.2: tecnico renomeado no painel sem "Nome na planilha" continua ligado ao 12x36.
// Uso: node scripts/check/teste08.js <pasta n8n 0.4.1> <pasta n8n 0.4.2>   (dados ficticios, sem banco)
const fs = require('fs'); const { run } = require("./harness");
const [A, B] = process.argv.slice(2);
const ler = (d, f) => Object.fromEntries(JSON.parse(fs.readFileSync(d + '/' + f, 'utf8')).nodes.filter(n => n.parameters.jsCode).map(n => [n.name, n.parameters.jsCode]));
const W3 = '03_IXC_Comandos_e_Consulta_de_Escala.json', W1 = '01_IXC_Notificacoes_WhatsApp.json';
const V3 = ler(A, W3), N3 = ler(B, W3), V1 = ler(A, W1), N1 = ler(B, W1);
let ok = 0; const falhas = []; const check = (n, c, x) => { if (c) ok++; else { falhas.push(n); console.log('  ✘', n, '\n' + (x || '')); } };
const clone = x => JSON.parse(JSON.stringify(x));
const hoje = '2026-11-24', amanha = '2026-11-25';
const dias = { seg: '10:00-22:00', ter: '10:00-22:00', qua: '10:00-22:00', qui: '10:00-22:00', sex: '10:00-22:00', sab: '10:00-22:00', dom: '14:00-20:00' };
const T0 = [{ empresa: 'CACTA', id_func: '11', nome: 'Joao Henrique', fone: '5541900000011' },
  { empresa: 'CACTA', id_func: '12', nome: 'Juliano', fone: '5541900000012' },
  { empresa: 'CACTA', id_func: '13', nome: 'Marcos Lima', fone: '5541900000013' },
  { empresa: 'CACTA', id_func: '14', nome: 'Mirandinha', fone: '5541900000014' }];
const base = {
  hoje: hoje + ' 12:48', empresas: [{ id: 'CACTA', nome: 'Cacta Telecom' }],
  tecnicos: T0,
  locais: [{ empresa: 'CACTA', id_condominio: '263', nome: 'Jockey Plaza', tec_padrao: null }],
  escala_base: [Object.assign({ empresa: 'CACTA', id_condominio: '263', tipo: '12x36', obs: 'revezam 12x36',
    tecnicos: 'Joao Henrique (41) 90000-0011; Juliano (41) 90000-0012; Lucas Miranda (41) 90000-0014' }, dias)],
  escala_dia: [{ data: hoje, empresa: 'CACTA', id_condominio: '263', tecnico: 'Joao Henrique' }, { data: amanha, empresa: 'CACTA', id_condominio: '263', tecnico: 'Juliano' }],
  param: { escala_grupos: 'gA@g.us', setores_grupo: 'gR@g.us' }, setores: [], mensagens: {}, apelidos: [] };
const com = f => { const c = clone(base); f(c); return c; };
const tec = (c, id) => c.tecnicos.find(t => t.id_func === id);
const filtro = (c, t) => run(c['Escala: Filtrar Pergunta'], { item: { json: {} }, nodes: {
  'WAHA: Normalizar': [{ json: { data: { key: { remoteJid: 'gA@g.us', id: 'X', participant: 'p@c.us', fromMe: false }, message: { conversation: t } } } }],
  'Carregar Parametros': [{ json: { grupo_automacao: 'gA@g.us', setores_grupo: 'gR@g.us', perguntas: '[]' } }] } });
const resp = (c, t, cfg) => { const f = filtro(c, t); if (!f.length) return null; const r = run(c['Escala: Montar Resposta'], { item: { json: {} }, nodes: { 'Escala: Filtrar Pergunta': f, 'Escala: Buscar Dados': [{ json: { cfg } }] } }); return r.length ? r[0].json.resposta : ''; };
const cmd = (c, args, cfg) => run(c['IXC Cmd: Interpretar'], { item: { json: {} }, nodes: { 'IXC Cmd: Filtrar': [{ json: { args, autor: 'x', texto: 'ixc ' + args } }], 'IXC Cmd: Carregar': [{ json: { cfg } }] } })[0].json.resposta || '';
const P = 'quem está no jockey';

// 1) o caso do print: Juliano -> "Testinho - Juliano", Nome na planilha vazio
let c = com(c => { tec(c, '12').nome = 'Testinho - Juliano'; });
let a = resp(V3, P, c), b = resp(N3, P, c);
check('0.4.1 reproduz o bug (nome da planilha)', /👤 Juliano — @5541900000012/.test(a), a);
check('0.4.2 mostra o nome do cadastro', /👤 Testinho - Juliano — @5541900000012/.test(b), b);
check('0.4.2 Joao Henrique igual', /👤 Joao Henrique — @5541900000011/.test(b), b);
// 2) renomeado para nome sem relacao, sem Nome na planilha: liga pelo telefone da Equipe
c = com(c => { tec(c, '12').nome = 'Fulano Novo'; });
b = resp(N3, P, c);
check('0.4.2 sem relacao de nome: liga pelo telefone da Equipe', /👤 Fulano Novo — @5541900000012/.test(b), b);
check('0.4.1 nesse caso mostrava Juliano', /👤 Juliano/.test(resp(V3, P, c)));
// 3) Nome na planilha preenchido continua valendo (regra da 0.4.1)
c = com(c => { Object.assign(tec(c, '12'), { nome: 'Beltrano', nome_planilha: 'Juliano' }); });
check('nome na planilha continua valendo', /👤 Beltrano — @5541900000012/.test(resp(N3, P, c)));
// 4) contido ambiguo: dois cadastros com "juliano" e sem telefone na Equipe -> nao liga
c = com(c => { tec(c, '12').nome = 'Testinho - Juliano'; c.tecnicos.push({ empresa: 'CACTA', id_func: '15', nome: 'Juliano Costa Neto', fone: '5541900000015' }); c.escala_base[0].tecnicos = ''; });
b = resp(N3, P, c);
check('contido ambiguo nao liga (nome da planilha)', /👤 Juliano/.test(b) && !/Testinho/.test(b), b);
// 5) cadastro com "Nome na planilha" de outra pessoa nao e pego pela regra do contido
c = com(c => { tec(c, '12').nome = 'Testinho - Juliano'; c.tecnicos.push({ empresa: 'CACTA', id_func: '16', nome: 'Juliano Velho', nome_planilha: 'Jota', fone: '5541900000016' }); });
check('regra do contido ignora quem tem nome na planilha', /👤 Testinho - Juliano/.test(resp(N3, P, c)));
// 6) ixc quem
c = com(c => { tec(c, '12').nome = 'Testinho - Juliano'; });
b = cmd(N3, 'quem jockey', c);
check('ixc quem <shopping> com o nome novo', /Testinho - Juliano/.test(b), b);
b = cmd(N3, 'quem testinho', c);
check('ixc quem <nome novo> acha o Jockey', /Jockey Plaza/.test(b), b);
check('0.4.1 nao achava', !/Jockey Plaza/.test(cmd(V3, 'quem testinho', c)));
// 7) nada renomeado: 0.4.2 = 0.4.1
check('sem renomear: igual a 0.4.1', resp(V3, P, base) === resp(N3, P, base));
check('sem renomear (ixc quem): igual', cmd(V3, 'quem jockey', base) === cmd(N3, 'quem jockey', base));

// WF 01 Rotear: Juliano de plantao hoje, renomeado sem Nome na planilha
const c1 = { empresas: [{ id: 'CACTA', nome: 'Cacta' }], tecnicos: T0.map(t => Object.assign({ grupo: null }, t)),
  locais: [{ empresa: 'CACTA', id_condominio: '263', nome: 'Jockey Plaza', grupo: 'gJ@g.us', marcar_sem_tec: [] }],
  funcionarios: [], param: {}, pendentes: [], lembretes: [], mensagens: {}, escala_hoje: [{ empresa: 'CACTA', id_condominio: '263', tecnico: 'Juliano' }] };
const rotear = (code, cfg, t) => run(code['Rotear'], { items: [{ json: { registros: [{ id: '5', razao: 'Cli', id_condominio: '263' }] } }], nodes: {
  'Carregar Config': [{ json: { cfg } }],
  'Processar Eventos': [{ json: { empresa: 'CACTA', id_evento: '8', id_chamado: '77', id_tecnico: t, mensagem: 'x' } }],
  'Buscar Chamado': [{ json: { registros: [{ id: '77', protocolo: 'P77', id_condominio: '263', id_tecnico: t, id_assunto: '1', data_abertura: '2026-01-01 00:00:00' }] } }] } })[0].json;
const c1r = clone(c1); c1r.tecnicos.find(t => t.id_func === '12').nome = 'Testinho - Juliano';
let r0 = rotear(V1, c1r, '12'), r = rotear(N1, c1r, '12');
check('WF01 0.4.1 reproduz a folga falsa', !!r0.folga, JSON.stringify(r0));
check('WF01 0.4.2 sem folga falsa', !r.folga, JSON.stringify(r.folga));
r = rotear(N1, c1r, '13');
check('WF01 outro tecnico: plantao com o nome do cadastro', /plantão no Jockey Plaza: Testinho - Juliano$/.test(r.folga || ''), JSON.stringify(r.folga));
check('WF01 marca o plantonista', (r.marcar || []).includes('5541900000012'), JSON.stringify(r.marcar));
r = rotear(N1, c1, '13'); r0 = rotear(V1, c1, '13');
check('WF01 sem renomear: igual a 0.4.1', JSON.stringify([r.folga, r.marcar]) === JSON.stringify([r0.folga, r0.marcar]), JSON.stringify([r, r0]));
console.log('ok:', ok, 'falhas:', JSON.stringify(falhas)); process.exit(falhas.length ? 1 : 0);
