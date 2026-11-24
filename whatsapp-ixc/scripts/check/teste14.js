// Testes da 0.6.3 (Painel do Bot 0.4.2): variavel por shopping e variaveis do bot desativaveis.
// Uso: node scripts/check/teste14.js <pasta n8n 0.6.2> <pasta n8n 0.6.3> <cfgs.json>   (cfgs.json: ver teste10)
const fs = require('fs'); const { run } = require('./harness');
const [A, B, CF] = process.argv.slice(2);
const ler = (d, f) => Object.fromEntries(JSON.parse(fs.readFileSync(d + '/' + f + '.json', 'utf8')).nodes.filter(n => n.parameters.jsCode).map(n => [n.name, n.parameters.jsCode]));
const W = d => ({ w1: ler(d, '01_IXC_Notificacoes_WhatsApp'), w2: ler(d, '02_IXC_Lembretes_de_Visita'), w3: ler(d, '03_IXC_Comandos_e_Consulta_de_Escala') });
const V = W(A), N = W(B);
const CFG = JSON.parse(fs.readFileSync(CF, 'utf8'));
let ok = 0; const falhas = []; const check = (n, c, x) => { if (c) ok++; else { falhas.push(n); console.log('  ✘', n, x === undefined ? '' : '\n' + x); } };
const clone = x => JSON.parse(JSON.stringify(x));
const esc = clone(CFG['03:Escala: Buscar Dados']); esc.param.escala_grupos = 'gA@g.us,gR@g.us'; esc.param.setores_grupo = 'gR@g.us';
let k = 10; esc.tecnicos.forEach(t => t.fone = '55419990000' + String(k++).padStart(2, '0')); esc.setores.forEach(c => c.fone = '55419990000' + String(k++).padStart(2, '0'));
const PERG = JSON.parse(CFG['03:Carregar Parametros'].perguntas);
const LOC = esc.locais, NOME = id => (LOC.find(l => l.empresa + ':' + l.id_condominio === id) || {}).nome;
const RESP = [{ chave: 'resp.1', f: ['qual a holding do {shopping}'], g: 'todos', t: 'Holding do *{shopping}*: {holding}' },
  { chave: 'resp.2', f: ['senha wifi geral'], g: 'todos', t: 'Senha: {senha} · holding padrao: {holding}' }];
const VARS = { holding: { p: 'Padrão Holding', s: { 'CACTA:263': 'Cacta Holding', '4B:199': '4B Telecom' } }, senha: { p: 'abc123', s: {} } };
const PAR = (vars) => [{ json: { waha_url: 'http://waha:3000', waha_session: 's1', grupo_automacao: 'gA@g.us', setores_grupo: 'gR@g.us', perguntas: JSON.stringify(PERG), respostas: JSON.stringify(RESP), variaveis: JSON.stringify(vars) } }];
const filtro = (codes, texto, vars) => run(codes.w3['Escala: Filtrar Pergunta'], { item: { json: {} }, nodes: {
  'WAHA: Normalizar': [{ json: { data: { key: { remoteJid: 'gA@g.us', id: 'X1', participant: '5541900000003@c.us', fromMe: false }, message: { conversation: texto } } } }], 'Carregar Parametros': PAR(vars) } });
const resp = (codes, P0, cfg) => run(codes.w3['Escala: Montar Resposta'], { item: { json: {} }, nodes: { 'Escala: Filtrar Pergunta': [{ json: P0 }], 'Escala: Buscar Dados': [{ json: { cfg } }] } });
const corpo = (t, vars, codes, cfg) => { const c = codes || N; const f = filtro(c, t, vars || VARS); return f.length ? (resp(c, f[0].json, cfg || esc)[0] || { json: {} }).json.resposta.replace('🤖 *Resposta automática do bot de escalas*\n\n', '') : null; };

check('jockey: valor do shopping', corpo('qual a holding do jockey?') === 'Holding do *' + NOME('CACTA:263') + '*: Cacta Holding', corpo('qual a holding do jockey?'));
check('palladium: valor dele', corpo('qual a holding do palladium?') === 'Holding do *' + NOME('4B:199') + '*: 4B Telecom');
check('shopping sem valor: padrao', corpo('qual a holding do cascavel?') === 'Holding do *' + NOME('CACTA:260') + '*: Padrão Holding');
let x = corpo('qual a holding do xyz?');
check('todos: cada um com o seu valor', x.split('\n').length === LOC.length && x.includes('*' + NOME('CACTA:263') + '*: Cacta Holding') && x.includes('*' + NOME('4B:199') + '*: 4B Telecom') && x.includes('*' + NOME('CACTA:260') + '*: Padrão Holding'));
check('sem {shopping} na frase: padrao', corpo('senha wifi geral') === 'Senha: abc123 · holding padrao: Padrão Holding');
check('padrao vazio + shopping sem valor: linha fica sem o valor', corpo('qual a holding do cascavel?', { holding: { p: '', s: { 'CACTA:263': 'Cacta Holding' } } }) === 'Holding do *' + NOME('CACTA:260') + '*');
check('formato da 0.6.2 (texto) ainda funciona', corpo('qual a holding do jockey?', { holding: '4BTELECOM' }) === 'Holding do *' + NOME('CACTA:263') + '*: 4BTELECOM');
check('0.6.2 com formato velho = 0.6.3', corpo('qual a holding do jockey?', { holding: '4BTELECOM' }, V) === corpo('qual a holding do jockey?', { holding: '4BTELECOM' }));
// variáveis do bot desativadas (vsys.<nome> = null no mapa de mensagens)
const off = (cfg, ...ks) => { const c = clone(cfg); c.mensagens = Object.assign({}, c.mensagens || {}); for (const kk of ks) c.mensagens['vsys.' + kk] = null; return c; };
const perg = (codes, t, cfg) => { const f = filtro(codes, t, {}); return f.length ? resp(codes, f[0].json, cfg) : []; };
for (const t of ['quem está no jockey?', 'quem está no palladium curitiba?', 'algum n2?', 'quem ta hoje?']) {
  check('sem desativar: igual 0.6.2 — ' + t, JSON.stringify(perg(V, t, esc)) === JSON.stringify(perg(N, t, esc)));
}
const r0 = perg(N, 'algum n2?', esc)[0].json.resposta, r1 = perg(N, 'algum n2?', off(esc, 'telefone'))[0];
check('{telefone} desativado: sem @ no setor', /@55/.test(r0) && r1 && !/@55/.test(r1.json.resposta) && r1.json.mentioned.length === 0, r1 && r1.json.resposta);
const r2 = perg(N, 'quem está no jockey?', off(esc, 'shopping'))[0].json.resposta;
check('{shopping} desativado: nome some do titulo', !r2.includes(NOME('CACTA:263')), r2);
// WF 01: {marcados} desativado
const c1 = clone(CFG['01:Carregar Config']); c1.param.envio = 'REAL'; c1.mensagens = {};
const montar = (codes, d, cfg) => run(codes.w1['Montar Mensagem'], { items: [{ json: { registros: [{ assunto: 'Ativação' }] } }], nodes: { 'Rotear': [{ json: d }], 'Carregar Config': [{ json: { cfg } }] } })[0].json.texto;
const d1 = { empresa: '4B', id_chamado: '10', evento: '1', grupo_jid: 'g@g.us', marcar: ['5541999990001'], nome: null, shopping: 'Palladium Curitiba', sem_tecnico: false, mensagem: 'Cliente sem sinal.', primeira: true,
  chamado: { protocolo: '202611240001', apartamento: '101', id_condominio: '199' }, cliente: { razao: 'CLIENTE', fantasia: 'Loja', id_condominio: '199' }, evento_emoji: '🆕', evento_label: 'Novo chamado', evento_chave: 'aviso.novo' };
check('aviso sem desativar: igual 0.6.2', montar(V, d1, c1) === montar(N, d1, c1));
check('{marcados} desativado: sem @ no aviso', /@5541999990001/.test(montar(N, d1, c1)) && !/@5541999990001/.test(montar(N, d1, off(c1, 'marcados'))), montar(N, d1, off(c1, 'marcados')));
check('{protocolo} desativado: some do corpo', !/202611240001/.test(montar(N, d1, off(c1, 'protocolo'))) && /202611240001/.test(montar(N, d1, c1)));
// WF 02
const c2 = clone(CFG['02:Carregar Config']); c2.param.envio = 'REAL'; c2.param.planta_ativo = 'sim'; c2.mensagens = {};
const lemb = (codes, d, cfg) => run(codes.w2['Montar Lembrete'], { items: [{ json: { registros: [{ assunto: 'Visita' }] } }], nodes: { 'Rotear Lembrete': [{ json: d }], 'Carregar Config': [{ json: { cfg } }] } }).map(o => o.json.texto);
const l1 = { empresa: 'PONTO', marcar: ['5549900000002'], grupo_jid: 'g@g.us', shopping: 'Pátio Chapecó', nome: null, sem_tecnico: false, tipo: 'lembrete_1h', janela: 'em 1 hora',
  cliente: { razao: 'X', fantasia: 'Ortobom', id_condominio: '84' }, chamado: { id: '1183', protocolo: '1183', data_agenda: '2026-10-28 14:00:00', id_condominio: '84', apartamento: 'SALA 102' } };
check('lembrete sem desativar: igual 0.6.2', JSON.stringify(lemb(V, l1, c2)) === JSON.stringify(lemb(N, l1, c2)));
check('lembrete com {marcados} desativado: sem @', !/@5549900000002/.test(lemb(N, l1, off(c2, 'marcados'))[0]) && /@5549900000002/.test(lemb(N, l1, c2)[0]));
console.log('ok:', ok, 'falhas:', JSON.stringify(falhas)); process.exit(falhas.length ? 1 : 0);
