const fs = require('fs'); const { run } = require('./harness');
const w = JSON.parse(fs.readFileSync((process.argv[2] || 'n8n') + '/03_IXC_Comandos_e_Consulta_de_Escala.json', 'utf8'));
const code = Object.fromEntries(w.nodes.filter(n => n.parameters.jsCode).map(n => [n.name, n.parameters.jsCode]));
const GRUPO = '120363000000000001@g.us';
const waha = (body, from = GRUPO, extra = {}) => ({ json: { body: { event: 'message', session: 's1', payload: Object.assign({ id: 'false_' + from + '_ABC123', timestamp: 1761570000, from, fromMe: false, participant: '5541900000003@c.us', body, hasMedia: false, _data: { Info: { PushName: 'Fulano' } } }, extra) } } });
const P = [{ json: { waha_url: 'http://waha:3000', waha_session: 's1', grupo_automacao: GRUPO } }];
function norm(item) { return run(code['WAHA: Normalizar'], { item }); }
let ok = 0, falhas = [];
function check(nome, cond) { if (cond) ok++; else falhas.push(nome); }
// 1) evento que nao e mensagem -> descartado
check('descarta session.status', norm({ json: { body: { event: 'session.status', payload: { status: 'WORKING' } } } }).length === 0);
// 2) conversa privada -> descartada
check('descarta privado', norm(waha('oi', '5541900000001@c.us')).length === 0);
// 3) comando ixc no grupo de automacao
let n = norm(waha('ixc ajuda'));
check('normaliza grupo', n.length === 1 && n[0].json.data.key.remoteJid === GRUPO && n[0].json.data.message.conversation === 'ixc ajuda' && n[0].json.data.pushName === 'Fulano');
let f = run(code['IXC Cmd: Filtrar'], { item: P[0], nodes: { 'WAHA: Normalizar': n, 'Carregar Parametros': P } });
check('ixc ajuda reconhecido', f.length === 1 && f[0].json.args === 'ajuda' && f[0].json.autor === 'Fulano');
// 4) comando ixc em outro grupo -> ignorado
n = norm(waha('ixc ajuda', '120363000000000002@g.us'));
f = run(code['IXC Cmd: Filtrar'], { item: P[0], nodes: { 'WAHA: Normalizar': n, 'Carregar Parametros': P } });
check('ixc fora do grupo de automacao ignorado', f.length === 0);
// 5) pergunta de escala em grupo
n = norm(waha('quem ta no jockey?', '120363000000000002@g.us'));
f = run(code['Escala: Filtrar Pergunta'], { item: P[0], nodes: { 'WAHA: Normalizar': n, 'Carregar Parametros': P } });
check('pergunta de escala reconhecida', f.length === 1 && f[0].json.grupo === '120363000000000002@g.us' && f[0].json.id === 'false_120363000000000002@g.us_ABC123');
// 6) pergunta de setor
n = norm(waha('alguém do financeiro?', '120363000000000003@g.us'));
f = run(code['Escala: Filtrar Pergunta'], { item: P[0], nodes: { 'WAHA: Normalizar': n, 'Carregar Parametros': P } });
check('pergunta de setor', f.length === 1 && (f[0].json.setores || []).includes('financeiro'));
// 7) resposta do proprio bot (comeca com emoji) -> ignorada
n = norm(waha('🤖 *Resposta automática do bot de escalas*', GRUPO, { fromMe: true }));
f = run(code['Escala: Filtrar Pergunta'], { item: P[0], nodes: { 'WAHA: Normalizar': n, 'Carregar Parametros': P } });
check('ignora resposta do bot', f.length === 0);
// 8) fromMe (dono do numero digita ixc ok no proprio celular) -> aceito
n = norm(waha('ixc ok', GRUPO, { fromMe: true, participant: undefined }));
f = run(code['IXC Cmd: Filtrar'], { item: P[0], nodes: { 'WAHA: Normalizar': n, 'Carregar Parametros': P } });
check('fromMe aceito nos comandos', f.length === 1 && f[0].json.autor === 'Fulano');
// 9) Finalizar com resposta do check-exists do WAHA
const interp = [{ json: { acao: { tipo: 'numero', fone: '5541990000003' }, resumo: 'trocar numero', fone_validar: '5541990000003' } }];
const filt = [{ json: { autor: 'Fulano', texto: 'ixc numero x 41900000003' } }];
let r = run(code['IXC Cmd: Finalizar'], { item: { json: { numberExists: true, chatId: '554190000003@c.us' } }, nodes: { 'IXC Cmd: Interpretar': interp, 'IXC Cmd: Filtrar': filt } });
check('finalizar usa chatId do WAHA (9o digito)', r[0].json.resposta.includes('554190000003') && r[0].json.sql.includes('registrar_comando'));
r = run(code['IXC Cmd: Finalizar'], { item: { json: { numberExists: false } }, nodes: { 'IXC Cmd: Interpretar': interp, 'IXC Cmd: Filtrar': filt } });
check('finalizar numero inexistente', r[0].json.resposta.startsWith('❌'));
console.log('ok:', ok, 'falhas:', falhas); process.exit(falhas.length ? 1 : 0);
