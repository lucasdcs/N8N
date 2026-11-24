// Testes da 0.4.0 (Painel do Bot): apelidos de shopping de ixc.apelidos no WF 03.
// Uso: node scripts/check/teste06.js <pasta n8n 0.3.0> <pasta n8n 0.4.0> <cfgs.json com 'apelidos' em "03:Escala: Buscar Dados">
// 1) com os apelidos padrao no banco (ou banco sem apelidos) a resposta e IGUAL a 0.3.0;
// 2) apelido novo responde; apelido apagado deixa de responder; generico (cidade) so vale sem shopping especifico.
const fs = require('fs'); const { run } = require('./harness');
const [A, B, CF] = process.argv.slice(2);
const ler = d => Object.fromEntries(JSON.parse(fs.readFileSync(d + '/03_IXC_Comandos_e_Consulta_de_Escala.json', 'utf8')).nodes.filter(n => n.parameters.jsCode).map(n => [n.name, n.parameters.jsCode]));
const V = ler(A), N = ler(B);
const CFG = JSON.parse(fs.readFileSync(CF, 'utf8'));
let ok = 0; const falhas = []; const check = (n, c) => c ? ok++ : falhas.push(n);
const clone = x => JSON.parse(JSON.stringify(x));
const esc = clone(CFG['03:Escala: Buscar Dados']); esc.mensagens = {};
esc.param.escala_grupos = 'gA@g.us'; esc.param.setores_grupo = 'gR@g.us';
const AP = esc.apelidos;
const filtro = (c, t) => run(c['Escala: Filtrar Pergunta'], { item: { json: {} }, nodes: {
  'WAHA: Normalizar': [{ json: { data: { key: { remoteJid: 'gA@g.us', id: 'X', participant: 'p@c.us', fromMe: false }, message: { conversation: t } } } }],
  'Carregar Parametros': [{ json: { grupo_automacao: 'gA@g.us', setores_grupo: 'gR@g.us', perguntas: '[]' } }] } });
const resp = (c, t, cfg) => { const f = filtro(c, t); if (!f.length) return null; const r = run(c['Escala: Montar Resposta'], { item: { json: {} }, nodes: { 'Escala: Filtrar Pergunta': f, 'Escala: Buscar Dados': [{ json: { cfg } }] } }); return r.length ? r[0].json.resposta : ''; };
const PERG = ['quem está no palladium curitiba?', 'tem alguém no jockey?', 'quem ta no pontal hoje', 'quem está em curitiba?', 'técnico de cascavel', 'quem está no park shopping?',
  'tem alguém em pelotas?', 'quem está no sinop amanhã', 'responsável pelo shopping itajaí', 'quem atende no porto belo', 'quem está no catuai?', 'quem ta em chapeco',
  'quem está no palladium foz?', 'quem está no canoas?', 'quem está na estação', 'quem está no ifashion?', 'quem atende no city center campo largo?', 'quem está em curitiba no jockey?'];
for (const t of PERG) {
  const a = resp(V, t, esc), b = resp(N, t, esc), c = resp(N, t, Object.assign(clone(esc), { apelidos: [] }));
  if (a !== b) console.log('DIF', t, '\n' + a + '\n---\n' + b);
  check('igual com apelidos do banco: ' + t, a === b);
  check('igual sem apelidos no banco: ' + t, a === c);
}
check('banco tem os 92 apelidos padrão', AP.length === 92);
// apelido novo / apagado / generico
const novo = Object.assign(clone(esc), { apelidos: AP.concat([{ a: 'novinho', alvos: ['4B:200'], g: false }]) });
check('apelido novo responde', /Shopping Ventura/.test(resp(N, 'quem está no novinho?', novo) || ''));
check('0.3.0 nao conhecia', resp(V, 'quem está no novinho?', esc) === '');
const semJockey = Object.assign(clone(esc), { apelidos: AP.filter(a => !/jockey|jockey plazza/.test(a.a)) });
check('apelido apagado nao responde', resp(N, 'tem alguém no jockey?', semJockey) === '');
const r1 = resp(N, 'quem está em curitiba no jockey?', esc);
check('generico ignorado com shopping especifico', /Jockey/.test(r1) && !/Palladium Curitiba/.test(r1));
const semGen = Object.assign(clone(esc), { apelidos: AP.map(a => Object.assign({}, a, { g: false })) });
check('sem flag generico, cidade soma', /Palladium Curitiba/.test(resp(N, 'quem está em curitiba no jockey?', semGen)));
console.log('ok:', ok, 'falhas:', JSON.stringify(falhas)); process.exit(falhas.length ? 1 : 0);
