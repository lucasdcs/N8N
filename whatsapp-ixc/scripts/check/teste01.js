const fs = require('fs'); const { run } = require('./harness');
const w = JSON.parse(fs.readFileSync((process.argv[2] || 'n8n') + '/01_IXC_Notificacoes_WhatsApp.json', 'utf8'));
const code = Object.fromEntries(w.nodes.filter(n => n.parameters.jsCode).map(n => [n.name, n.parameters.jsCode]));
const cfg = [{ json: { cfg: { empresas: [], tecnicos: [], locais: [], funcionarios: [], param: { waha_url: 'http://waha:3000/', waha_session: 's1', falha_max_tentativas: '5', envio: 'REAL', envio_teste_para: '5541900000001' }, pendentes: [{ id: 7, empresa: '4B', id_chamado: '1', protocolo: 'P1', evento: '1', grupo: 'g@g.us', mentioned: ['5541900000002'], texto: 'oi', tentativas: 1 }] } } }];
const mm = [{ json: { empresa: '4B', id_chamado: '10', protocolo: '202610', evento: '1', texto: '🆕 Novo chamado — @5541900000002', grupo_jid: '120363000000000002@g.us', mentioned: ['5541900000002'], planta: { empresa: '4B', id_condominio: '199', loja: '36' } } },
            { json: { empresa: '4B', id_chamado: '11', protocolo: '202611', evento: '8', texto: '👤 Chamado assumido — *Fulano*', grupo_jid: '120363000000000002@g.us', mentioned: [], planta: null } }];
const plantas = [{ json: { ok: true, imagem: 'iVBORw0KGgo=', piso: 'Térreo', lojas: ['36'] } }, { json: {} }];
let ok = 0, falhas = []; const check = (n, c) => c ? ok++ : falhas.push(n);
const a = run(code['Anexar Planta'], { items: plantas, nodes: { 'Carregar Config': cfg, 'Montar Mensagem': mm } });
check('sendImage com planta', a[0].json.endpoint === 'http://waha:3000/api/sendImage' && a[0].json.corpo.file.data === 'iVBORw0KGgo=' && a[0].json.corpo.caption.startsWith('🆕') && a[0].json.corpo.session === 's1');
check('mentions formato WAHA', JSON.stringify(a[0].json.corpo.mentions) === JSON.stringify(['5541900000002@c.us']));
check('sendText sem planta/sem mentions', a[1].json.endpoint === 'http://waha:3000/api/sendText' && a[1].json.corpo.text.startsWith('👤') && a[1].json.corpo.mentions === undefined && a[1].json.corpo.linkPreview === false);
// Resultado Envio: resposta WAHA ok (GOWS: id string) / erro HTTP
const anex = a;
let r = run(code['Resultado Envio'], { items: [{ json: { id: 'true_120363000000000002@g.us_3EB0', timestamp: 1 } }, { json: { error: { message: 'Request failed with status code 422' } } }], nodes: { 'Carregar Config': cfg, 'Montar Mensagem': mm, 'Anexar Planta': anex } });
check('envio ok gravado', r[0].json.sql.includes("'ok'") && r[0].json.sql.includes('com planta'));
check('envio falha gravado', r[1].json.sql.includes("'falha'") && r[1].json.sql.includes('422'));
// Pendentes + Resultado Reenvio
const pend = run(code['Pendentes'], { item: { json: {} }, nodes: { 'Carregar Config': cfg } });
check('pendentes', pend.length === 1 && pend[0].json.falha_id === 7);
r = run(code['Resultado Reenvio'], { items: [{ json: { id: { _serialized: 'x' }, _data: {} } }], nodes: { 'Pendentes': pend } });
check('reenvio ok (WEBJS id objeto)', r[0].json.sql.includes("'ok'") && r[0].json.sql.includes('WHERE id = 7'));
// modos
const cfgN = JSON.parse(JSON.stringify(cfg)); cfgN[0].json.cfg.param.envio = 'NENHUM';
check('NENHUM nao envia', run(code['Anexar Planta'], { items: plantas, nodes: { 'Carregar Config': cfgN, 'Montar Mensagem': mm } }).length === 0);
check('NENHUM nao reenvia', run(code['Pendentes'], { item: { json: {} }, nodes: { 'Carregar Config': cfgN } }).length === 0);
const cfgS = JSON.parse(JSON.stringify(cfg)); cfgS[0].json.cfg.param.envio = 'SIMULAR';
const sim = run(code['Anexar Planta'], { items: plantas, nodes: { 'Carregar Config': cfgS, 'Montar Mensagem': mm } });
check('SIMULAR vai para o numero de teste', sim[1].json.corpo.chatId === '5541900000001@c.us' && sim[1].json.corpo.text.startsWith('🧪 SIMULAÇÃO → 120363000000000002@g.us') && sim[1].json.simulado === true);
const rs = run(code['Resultado Envio'], { items: [{ json: { id: 'x' } }, { json: { id: 'y' } }], nodes: { 'Carregar Config': cfgS, 'Montar Mensagem': mm, 'Anexar Planta': sim } });
check('SIMULAR grava motivo SIMULADO', rs[1].json.sql.includes("'SIMULADO'") && rs[1].json.sql.includes("'ok'"));
const ps = run(code['Pendentes'], { item: { json: {} }, nodes: { 'Carregar Config': cfgS } });
check('SIMULAR reenvio para teste', ps[0].json.chat_envio === '5541900000001@c.us' && ps[0].json.grupo_jid === 'g@g.us');
// WF02
const w2 = JSON.parse(fs.readFileSync((process.argv[2] || 'n8n') + '/02_IXC_Lembretes_de_Visita.json', 'utf8'));
const c2 = Object.fromEntries(w2.nodes.filter(n => n.parameters.jsCode).map(n => [n.name, n.parameters.jsCode]));
const rot = [{ json: { empresa: '4B', tipo: 'lembrete_1h', janela: 'em 1 hora', chamado: { id: '5', protocolo: 'P5', data_agenda: '2026-10-27 15:00:00', id_cliente: '1', referencia: 'Piso L2' }, cliente: { razao: 'LOJA X LTDA', fantasia: 'Loja X' }, marcar: ['5541900000002'], grupo_jid: 'g@g.us', shopping: 'Jockey Plaza' } }];
const ass = [{ json: { registros: [{ assunto: 'Visita' }] } }];
let l = run(c2['Montar Lembrete'], { items: ass, nodes: { 'Carregar Config': cfgS, 'Rotear Lembrete': rot } });
check('WF02 SIMULAR', l.length === 1 && l[0].json.chat_envio === '5541900000001@c.us' && l[0].json.texto.includes('Lembrete de visita') && l[0].json.simulado);
l = run(c2['Montar Lembrete'], { items: ass, nodes: { 'Carregar Config': cfg, 'Rotear Lembrete': rot } });
check('WF02 REAL', l.length === 1 && !l[0].json.chat_envio && l[0].json.grupo_jid === 'g@g.us');
check('WF02 NENHUM', run(c2['Montar Lembrete'], { items: ass, nodes: { 'Carregar Config': cfgN, 'Rotear Lembrete': rot } }).length === 0);
const ml2 = run(c2['Montar Lembrete'], { items: ass, nodes: { 'Carregar Config': cfgS, 'Rotear Lembrete': rot } });
const an2 = c2['Anexar Planta'] ? run(c2['Anexar Planta'], { items: [{ json: {} }], nodes: { 'Carregar Config': cfgS, 'Montar Lembrete': ml2 } }) : [];
const r2 = run(c2['Resultado'], { items: [{ json: { id: 'ok1' } }], nodes: { 'Carregar Config': cfgS, 'Montar Lembrete': ml2, 'Anexar Planta': an2 } });
check('WF02 resultado SIMULADO', r2[0].json.sql.includes("'SIMULADO'"));
console.log('ok:', ok, 'falhas:', falhas); process.exit(falhas.length ? 1 : 0);
