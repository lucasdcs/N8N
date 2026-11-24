// Testes da 0.6.2 (Painel do Bot 0.4.1; entregue antes como 0.5.1): variaveis e {shopping} nas mensagens novas.
// Uso: node scripts/check/teste13.js <pasta n8n 0.6.1> <pasta n8n 0.6.2> <cfgs.json>   (cfgs.json: ver teste10)
const fs = require('fs'); const { run } = require('./harness');
const [A, B, CF] = process.argv.slice(2);
const ler = (d, f) => Object.fromEntries(JSON.parse(fs.readFileSync(d + '/' + f + '.json', 'utf8')).nodes.filter(n => n.parameters.jsCode).map(n => [n.name, n.parameters.jsCode]));
const V = ler(A, '03_IXC_Comandos_e_Consulta_de_Escala'), N = ler(B, '03_IXC_Comandos_e_Consulta_de_Escala');
const CFG = JSON.parse(fs.readFileSync(CF, 'utf8'));
let ok = 0; const falhas = []; const check = (n, c, x) => { if (c) ok++; else { falhas.push(n); console.log('  ✘', n, x === undefined ? '' : '\n' + x); } };
const clone = x => JSON.parse(JSON.stringify(x));
const esc = clone(CFG['03:Escala: Buscar Dados']); esc.param.escala_grupos = 'gA@g.us,gR@g.us'; esc.param.setores_grupo = 'gR@g.us';
const PERG = JSON.parse(CFG['03:Carregar Parametros'].perguntas);
const RESP = [{ chave: 'resp.1', f: ['qual holding do {shopping}', 'holding do shopping {shopping} hoje'], g: 'todos', t: 'Holding do *{shopping}* é {holding}' },
  { chave: 'resp.2', f: ['senha wifi jockey'], g: 'todos', t: '📶 Senha: {senha}\nSuporte: {fone_sup}' },
  { chave: 'resp.3', f: ['contato do almoxarifado'], g: 'todos', t: '📦 {shopping}: almoxarifado\n{obs}' }];
const VARS = { holding: '4BTELECOM', senha: 'abc123', fone_sup: '(41) 99999-0001', obs: '' };
const PAR = (respostas, vars) => [{ json: { waha_url: 'http://waha:3000', waha_session: 's1', grupo_automacao: 'gA@g.us', setores_grupo: 'gR@g.us', perguntas: JSON.stringify(PERG), respostas: JSON.stringify(respostas), variaveis: vars === undefined ? undefined : JSON.stringify(vars) } }];
const filtro = (codes, texto, respostas, vars, g) => run(codes['Escala: Filtrar Pergunta'], { item: { json: {} }, nodes: {
  'WAHA: Normalizar': [{ json: { data: { key: { remoteJid: g || 'gA@g.us', id: 'X1', participant: '5541900000003@c.us', fromMe: false }, message: { conversation: texto } } } }],
  'Carregar Parametros': PAR(respostas, vars) } });
const resp = (codes, P0, cfg) => run(codes['Escala: Montar Resposta'], { item: { json: {} }, nodes: { 'Escala: Filtrar Pergunta': [{ json: P0 }], 'Escala: Buscar Dados': [{ json: { cfg } }] } });
const pergunta = (t, vars, cfg) => { const f = filtro(N, t, RESP, vars === undefined ? VARS : vars); return f.length ? resp(N, f[0].json, cfg || esc) : null; };
const corpo = r => r && r.length ? r[0].json.resposta.replace('🤖 *Resposta automática do bot de escalas*\n\n', '') : null;
const LOC = esc.locais, NOME = id => (LOC.find(l => l.empresa + ':' + l.id_condominio === id) || {}).nome;

let f = filtro(N, 'Bom dia, qual a holding do jockey?', RESP, VARS);
check('"qual a holding" nao e "qual holding" (palavras na ordem)', f.length === 0 || f[0].json.resposta_chave !== 'resp.1');
f = filtro(N, 'Bom dia, qual holding do jockey?', RESP, VARS);
check('filtro: {shopping} capturado + variaveis', f.length === 1 && f[0].json.resposta_chave === 'resp.1' && f[0].json.resposta_shopping === 'jockey' && f[0].json.resposta_vars.holding === '4BTELECOM', JSON.stringify(f));
check('jockey', corpo(pergunta('Bom dia, qual holding do jockey?')) === 'Holding do *' + NOME('CACTA:263') + '* é 4BTELECOM', corpo(pergunta('Bom dia, qual holding do jockey?')));
check('apelido palladium', corpo(pergunta('qual holding do palladium?')) === 'Holding do *' + NOME('4B:199') + '* é 4BTELECOM');
check('frase com texto depois do {shopping}', corpo(pergunta('qual a holding do shopping catuai cascavel hoje?')) === 'Holding do *' + NOME('CACTA:260') + '* é 4BTELECOM', corpo(pergunta('qual a holding do shopping catuai cascavel hoje?')));
let x = corpo(pergunta('qual holding do curitiba'));
check('apelido de cidade: uma linha por shopping', x.split('\n').length === 4 && x.split('\n').every(l => /^Holding do \*.+\* é 4BTELECOM$/.test(l)), x);
x = corpo(pergunta('qual holding do xpto inexistente'));
check('shopping nao reconhecido: todos', x.split('\n').length === LOC.length && x.split('\n')[0].includes(LOC.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))[0].nome), x.split('\n').length + ' x ' + LOC.length);
check('sem nada depois: todos', corpo(pergunta('qual holding do?')).split('\n').length === LOC.length);
x = corpo(pergunta('qual holding do jockey', Object.assign({}, VARS, { holding: '' })));
check('variavel desativada: vazio, sem pontuacao sobrando', x === 'Holding do *' + NOME('CACTA:263') + '* é', JSON.stringify(x));
let r = pergunta('Senha wifi jockey');
check('sem {shopping}: variaveis + telefone vira @', corpo(r) === '📶 Senha: abc123\nSuporte: @5541999990001' && JSON.stringify(r[0].json.mentioned) === '["5541999990001"]', corpo(r));
check('variavel vazia com texto na linha: fica o texto sem a pontuacao do fim (regra do M)', corpo(pergunta('Senha wifi jockey', Object.assign({}, VARS, { fone_sup: '' }))) === '📶 Senha: abc123\nSuporte');
check('linha so com variavel vazia some', corpo(pergunta('contato do almoxarifado', VARS)).split('\n').every(l => l.trim()) && !/\{obs\}/.test(corpo(pergunta('contato do almoxarifado', VARS))), corpo(pergunta('contato do almoxarifado', VARS)));
check('variavel que nao existe fica como esta', corpo(pergunta('Senha wifi jockey', {})) === '📶 Senha: {senha}\nSuporte: {fone_sup}');
check('variaveis ausente (banco antigo) = {}', filtro(N, 'senha wifi jockey', RESP, undefined)[0].json.resposta_vars && corpo(resp(N, filtro(N, 'senha wifi jockey', RESP, undefined)[0].json, esc)) === '📶 Senha: {senha}\nSuporte: {fone_sup}');
check('variaveis com lixo nao quebra', filtro(N, 'senha wifi jockey', RESP, [1, 2]).length === 1);
const RESP3 = [{ chave: 'resp.3', f: ['contato do almoxarifado {shopping}'], g: 'todos', t: '📦 {shopping}: almoxarifado\n{obs}' }];
f = filtro(N, 'contato do almoxarifado curitiba', RESP3, VARS);
x = corpo(resp(N, f[0].json, esc));
check('texto de varias linhas: blocos separados por linha em branco', x.split('\n\n').length === 4 && !/\{obs\}/.test(x), x);
check('{shopping} no comeco da frase', (() => { const ff = filtro(N, 'jockey: holding dele?', [{ chave: 'resp.9', f: ['{shopping} holding dele'], g: 'todos', t: '{shopping} = {holding}' }], VARS); return ff.length === 1 && corpo(resp(N, ff[0].json, esc)) === NOME('CACTA:263') + ' = 4BTELECOM'; })());
// regressao da 0.6.1
const R0 = [{ chave: 'resp.1', f: ['senha wifi jockey'], g: 'todos', t: 'Senha abc' }];
const a = filtro(V, 'senha do Wi-Fi? senha wifi jockey', R0), b = filtro(N, 'senha do Wi-Fi? senha wifi jockey', R0, {});
check('sem variaveis/sem {shopping}: resposta igual a 0.6.1', JSON.stringify(resp(V, a[0].json, esc)) === JSON.stringify(resp(N, b[0].json, esc)));
for (const t of ['quem está no jockey?', 'algum n2?', 'alguém do financeiro?', 'quem ta hoje?']) {
  const fa = filtro(V, t, []), fb = filtro(N, t, [], {});
  check('igual 0.6.1: ' + t, JSON.stringify(fa) === JSON.stringify(fb) && (!fa.length || JSON.stringify(resp(V, fa[0].json, esc)) === JSON.stringify(resp(N, fb[0].json, esc))));
}
console.log('ok:', ok, 'falhas:', JSON.stringify(falhas)); process.exit(falhas.length ? 1 : 0);
