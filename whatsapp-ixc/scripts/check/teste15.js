// Testes da 0.6.4: resposta com varios shoppings em ordem do texto montado (agrupa pelo que vem primeiro).
// Uso: node scripts/check/teste15.js <pasta n8n 0.6.3> <pasta n8n 0.6.4> <cfgs.json>   (cfgs.json: ver teste10)
const fs = require('fs'); const { run } = require('./harness');
const [A, B, CF] = process.argv.slice(2);
const ler = d => Object.fromEntries(JSON.parse(fs.readFileSync(d + '/03_IXC_Comandos_e_Consulta_de_Escala.json', 'utf8')).nodes.filter(n => n.parameters.jsCode).map(n => [n.name, n.parameters.jsCode]));
const V = ler(A), N = ler(B);
const CFG = JSON.parse(fs.readFileSync(CF, 'utf8'));
let ok = 0; const falhas = []; const check = (n, c, x) => { if (c) ok++; else { falhas.push(n); console.log('  ✘', n, x === undefined ? '' : '\n' + x); } };
const esc = JSON.parse(JSON.stringify(CFG['03:Escala: Buscar Dados'])); esc.param.escala_grupos = 'gA@g.us'; esc.param.setores_grupo = 'gR@g.us';
const LOC = esc.locais, PERG = CFG['03:Carregar Parametros'].perguntas;
// holding = nome da empresa de cada shopping (como no print: "Buzz Telecom", "Cacta Telecom", "4BTELECOM"…)
const EMP = Object.fromEntries(esc.empresas.map(e => [e.id, e.id === '4B' ? '4BTELECOM' : e.nome]));
const S = Object.fromEntries(LOC.map(l => [l.empresa + ':' + l.id_condominio, EMP[l.empresa] || l.empresa]));
const run3 = (codes, txt, frase, texto, vars) => {
  const par = [{ json: { waha_url: 'x', waha_session: 's', grupo_automacao: 'gA@g.us', setores_grupo: 'gR@g.us', perguntas: PERG,
    respostas: JSON.stringify([{ chave: 'resp.1', f: [frase], g: 'todos', t: texto }]), variaveis: JSON.stringify(vars) } }];
  const f = run(codes['Escala: Filtrar Pergunta'], { item: { json: {} }, nodes: { 'WAHA: Normalizar': [{ json: { data: { key: { remoteJid: 'gA@g.us', id: 'X', participant: 'p@c.us', fromMe: false }, message: { conversation: txt } } } }], 'Carregar Parametros': par } });
  if (!f.length) return null;
  const r = run(codes['Escala: Montar Resposta'], { item: { json: {} }, nodes: { 'Escala: Filtrar Pergunta': f, 'Escala: Buscar Dados': [{ json: { cfg: esc } }] } });
  return r.length ? r[0].json.resposta.replace('🤖 *Resposta automática do bot de escalas*\n\n', '') : '';
};
const VARS = { holding: { p: '', s: S } };
const linhas = run3(N, 'qual holding', 'qual holding {shopping}', '{holding} - {shopping}', VARS).split('\n');
check('uma linha por shopping', linhas.length === LOC.length, linhas.length + ' x ' + LOC.length);
const hold = linhas.map(l => l.split(' - ')[0]);
const grupos = hold.filter((h, i) => i === 0 || h !== hold[i - 1]);
check('agrupado por holding (cada holding aparece num bloco so)', grupos.length === new Set(hold).size, grupos.join(' | '));
check('holdings em ordem', JSON.stringify(grupos) === JSON.stringify(grupos.slice().sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true }))), grupos.join(' | '));
const okDentro = grupos.every(g => { const sh = linhas.filter(l => l.startsWith(g + ' - ')).map(l => l.slice(g.length + 3)); return JSON.stringify(sh) === JSON.stringify(sh.slice().sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true }))); });
check('dentro da holding, shoppings em ordem', okDentro);
check('0.6.3 nao agrupava (era por nome do shopping)', (() => { const h3 = run3(V, 'qual holding', 'qual holding {shopping}', '{holding} - {shopping}', VARS).split('\n').map(l => l.split(' - ')[0]); return h3.filter((h, i) => i === 0 || h !== h3[i - 1]).length > new Set(h3).size; })());
check('mesmo conjunto de linhas que a 0.6.3', JSON.stringify(linhas.slice().sort()) === JSON.stringify(run3(V, 'qual holding', 'qual holding {shopping}', '{holding} - {shopping}', VARS).split('\n').sort()));
// texto que comeca com o shopping: continua por shopping
const l2 = run3(N, 'qual holding', 'qual holding {shopping}', '{shopping}: {holding}', VARS).split('\n').map(l => l.split(': ')[0]);
check('texto comecando pelo shopping: ordem de shopping', JSON.stringify(l2) === JSON.stringify(l2.slice().sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true }))));
// um shopping so: igual 0.6.3
check('um shopping: igual 0.6.3', run3(N, 'qual holding jockey', 'qual holding {shopping}', '{holding} - {shopping}', VARS) === run3(V, 'qual holding jockey', 'qual holding {shopping}', '{holding} - {shopping}', VARS));
// texto de varias linhas: blocos ordenados pelo inicio
const b3 = run3(N, 'contato curitiba', 'contato {shopping}', '*{holding}*\n{shopping}', VARS).split('\n\n');
check('blocos (varias linhas) tambem ordenados', b3.length > 1 && JSON.stringify(b3) === JSON.stringify(b3.slice().sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true }))), b3.join(' / '));
console.log('ok:', ok, 'falhas:', JSON.stringify(falhas)); process.exit(falhas.length ? 1 : 0);
