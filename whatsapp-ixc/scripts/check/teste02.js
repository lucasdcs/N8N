// Testes do WF 02 (lembretes de visita): 0.2.0 janelas 1h / 10 min, texto curto, planta no de 1h; 0.2.1 particular do tecnico.
// Uso: node scripts/check/teste02.js [pasta n8n]
const fs = require('fs'); const { run } = require('./harness');
const w = JSON.parse(fs.readFileSync((process.argv[2] || 'n8n') + '/02_IXC_Lembretes_de_Visita.json', 'utf8'));
const code = Object.fromEntries(w.nodes.filter(n => n.parameters.jsCode).map(n => [n.name, n.parameters.jsCode]));
let ok = 0; const falhas = []; const check = (n, c) => c ? ok++ : falhas.push(n);
const clone = (x) => JSON.parse(JSON.stringify(x));

const param = { waha_url: 'http://waha:3000/', waha_session: 's1', envio: 'REAL', envio_teste_para: '5541900000001', planta_ativo: 'sim' };
const cfg = [{ json: { cfg: { empresas: [], tecnicos: [], locais: [], funcionarios: [], param, pendentes: [],
  lembretes: [{ empresa: 'PONTO', id_chamado: '9', tipo: 'lembrete_1h', evento: '2026-10-28 15:00:00' }] } } }];
const cfgCom = (p) => { const c = clone(cfg); Object.assign(c[0].json.cfg.param, p); return c; };

// ---- Filtrar Janela
const emp = [{ json: { empresa: 'PONTO', agora: '2026-10-28 14:00:00' } }];
const ag = (id, hhmm) => ({ id, protocolo: 'P' + id, status: 'AG', data_agenda: '2026-10-28 ' + hhmm + ':00' });
const resp = [{ json: { registros: [ag('1', '14:55'), ag('2', '14:08'), ag('3', '14:12'), ag('4', '14:02'), ag('5', '14:10'), ag('9', '15:00')] } }];
const fj = run(code['Filtrar Janela'], { items: resp, nodes: { 'Carregar Config': cfg, 'Empresas': emp } });
const por = Object.fromEntries(fj.map(x => [x.json.chamado.id, x.json]));
check('55 min -> lembrete_1h', por['1'] && por['1'].tipo === 'lembrete_1h' && por['1'].janela === 'em 1 hora');
check('8 min -> lembrete_10min (faltam 8)', por['2'] && por['2'].tipo === 'lembrete_10min' && por['2'].faltam === 8);
check('10 min -> lembrete_10min', por['5'] && por['5'].tipo === 'lembrete_10min' && por['5'].faltam === 10);
check('12 min -> nada (antes era o de 15)', !por['3']);
check('2 min -> nada', !por['4']);
check('1h ja enviado -> nada', !por['9']);

// ---- Montar Lembrete
const base = { empresa: 'PONTO', marcar: ['5549900000002'], grupo_jid: 'g@g.us', shopping: 'Pátio Chapecó', nome: null, sem_tecnico: false,
  cliente: { razao: 'COLCHOES ORTOBOM PATIO CHAPECO EVENTO', fantasia: 'Ortobom', id_condominio: '84' } };
const chamado = { id: '1183', protocolo: '1183', data_agenda: '2026-10-28 14:00:00', id_condominio: '84', apartamento: 'SALA 102' };
const rot10 = [{ json: Object.assign(clone(base), { tipo: 'lembrete_10min', janela: 'em 10 minutos', faltam: 10, chamado }) }];
const rot1h = [{ json: Object.assign(clone(base), { tipo: 'lembrete_1h', janela: 'em 1 hora', faltam: 60, chamado }) }];
const ass = [{ json: { registros: [{ assunto: 'Vistoria de Eventos' }] } }];

let m = run(code['Montar Lembrete'], { items: ass, nodes: { 'Carregar Config': cfg, 'Rotear Lembrete': rot10 } });
check('10 min: texto curto', m[0].json.texto === '⏰ Não esqueça: visita na *Ortobom* (Pátio Chapecó, SALA 102) daqui 10 minutos, às 14:00.\n@5549900000002');
check('10 min: sem planta', m[0].json.planta === null && m[0].json.tipo === 'lembrete_10min');
const rotSem = clone(rot10); rotSem[0].json.cliente = {}; rotSem[0].json.chamado = Object.assign({}, chamado, { apartamento: '' }); rotSem[0].json.marcar = []; rotSem[0].json.faltam = 1;
m = run(code['Montar Lembrete'], { items: ass, nodes: { 'Carregar Config': cfg, 'Rotear Lembrete': rotSem } });
check('10 min: sem nome/loja/marcacao', m[0].json.texto === '⏰ Não esqueça: visita do chamado #1183 (Pátio Chapecó) daqui 1 minuto, às 14:00.');

m = run(code['Montar Lembrete'], { items: ass, nodes: { 'Carregar Config': cfg, 'Rotear Lembrete': rot1h } });
check('1h: texto completo', m[0].json.texto.startsWith('⏰ *Lembrete de visita — em 1 hora* — @5549900000002') && m[0].json.texto.includes('🏬 SALA 102'));
check('1h: pede a planta', JSON.stringify(m[0].json.planta) === JSON.stringify({ empresa: 'PONTO', id_condominio: '84', loja: 'SALA 102', nome: 'Ortobom' }));
const m1h = m;
check('1h: planta_ativo=nao -> sem planta', run(code['Montar Lembrete'], { items: ass, nodes: { 'Carregar Config': cfgCom({ planta_ativo: 'nao' }), 'Rotear Lembrete': rot1h } })[0].json.planta === null);
const rotLj = clone(rot1h); rotLj[0].json.chamado.apartamento = 'LOJA 36';
check('1h: "LOJA 36" -> loja 36', run(code['Montar Lembrete'], { items: ass, nodes: { 'Carregar Config': cfg, 'Rotear Lembrete': rotLj } })[0].json.planta.loja === '36');
const rotNum = clone(rot1h); rotNum[0].json.chamado.apartamento = ''; rotNum[0].json.cliente.apartamento = '';
check('1h: sem numero de loja -> sem planta', run(code['Montar Lembrete'], { items: ass, nodes: { 'Carregar Config': cfg, 'Rotear Lembrete': rotNum } })[0].json.planta === null);
const rotCond = clone(rot1h); rotCond[0].json.chamado.id_condominio = '0';
check('1h: condominio do cliente', run(code['Montar Lembrete'], { items: ass, nodes: { 'Carregar Config': cfg, 'Rotear Lembrete': rotCond } })[0].json.planta.id_condominio === '84');
check('NENHUM: nao monta', run(code['Montar Lembrete'], { items: ass, nodes: { 'Carregar Config': cfgCom({ envio: 'NENHUM' }), 'Rotear Lembrete': rot1h } }).length === 0);

// ---- Anexar Planta
const okPl = [{ json: { ok: true, imagem: 'iVBORw0KGgo=', piso: 'L1', lojas: ['102'], shopping: 'Pátio Chapecó' } }];
let a = run(code['Anexar Planta'], { items: okPl, nodes: { 'Carregar Config': cfg, 'Montar Lembrete': m1h } });
const cap = a[0].json.corpo.caption || '';
check('1h com planta: sendImage', a[0].json.endpoint === 'http://waha:3000/api/sendImage' && a[0].json.corpo.file.data === 'iVBORw0KGgo=' && a[0].json.corpo.chatId === 'g@g.us');
check('1h com planta: linha da planta logo depois da loja', cap.split('\n').indexOf('🗺️ Planta: L1 · loja 102') === cap.split('\n').indexOf('🏬 SALA 102 · Ortobom') + 1);
check('mentions WAHA', JSON.stringify(a[0].json.corpo.mentions) === JSON.stringify(['5549900000002@c.us']));
check('planta_info com planta', a[0].json.planta_info === 'com planta: L1 loja 102');
const anexOk = a;
a = run(code['Anexar Planta'], { items: [{ json: { ok: false, motivo: 'loja 102 aparece 2x na planta' } }], nodes: { 'Carregar Config': cfg, 'Montar Lembrete': m1h } });
check('1h loja repetida: sendText + motivo', a[0].json.endpoint === 'http://waha:3000/api/sendText' && a[0].json.corpo.text === m1h[0].json.texto && a[0].json.planta_info === 'sem planta: loja 102 aparece 2x na planta');
a = run(code['Anexar Planta'], { items: [{ json: { error: { message: 'getaddrinfo ENOTFOUND planta-loja' } } }], nodes: { 'Carregar Config': cfg, 'Montar Lembrete': m1h } });
check('servico fora: sendText', a[0].json.endpoint.endsWith('/api/sendText') && a[0].json.planta_info.includes('ENOTFOUND'));
const m10 = run(code['Montar Lembrete'], { items: ass, nodes: { 'Carregar Config': cfg, 'Rotear Lembrete': rot10 } });
a = run(code['Anexar Planta'], { items: [{ json: { ok: false, motivo: 'shopping sem planta indexada' } }], nodes: { 'Carregar Config': cfg, 'Montar Lembrete': m10 } });
check('10 min: sendText sem planta_info', a[0].json.endpoint.endsWith('/api/sendText') && a[0].json.planta_info === null && a[0].json.corpo.linkPreview === false);
const mS = run(code['Montar Lembrete'], { items: ass, nodes: { 'Carregar Config': cfgCom({ envio: 'SIMULAR' }), 'Rotear Lembrete': rot1h } });
a = run(code['Anexar Planta'], { items: okPl, nodes: { 'Carregar Config': cfgCom({ envio: 'SIMULAR' }), 'Montar Lembrete': mS } });
check('SIMULAR: imagem vai para o numero de teste', a[0].json.corpo.chatId === '5541900000001@c.us' && a[0].json.corpo.caption.startsWith('🧪 SIMULAÇÃO → g@g.us'));
const anexS = a;

// ---- Resultado
let r = run(code['Resultado'], { items: [{ json: { id: 'true_g@g.us_X' } }], nodes: { 'Carregar Config': cfg, 'Montar Lembrete': m1h, 'Anexar Planta': anexOk } });
check('Resultado ok com planta', r[0].json.sql.includes("'ok'") && r[0].json.sql.includes("'com planta: L1 loja 102'") && r[0].json.sql.includes("'lembrete_1h'"));
r = run(code['Resultado'], { items: [{ json: { id: 'x' } }], nodes: { 'Carregar Config': cfg, 'Montar Lembrete': mS, 'Anexar Planta': anexS } });
check('Resultado SIMULADO · com planta', r[0].json.sql.includes("'SIMULADO · com planta: L1 loja 102'"));
r = run(code['Resultado'], { items: [{ json: { error: { message: 'Request failed with status code 413' } } }], nodes: { 'Carregar Config': cfg, 'Montar Lembrete': m1h, 'Anexar Planta': anexOk } });
check('Resultado falha', r[0].json.sql.includes("'falha'") && r[0].json.sql.includes('413'));

// ---- estrutura do workflow
const con = w.connections;
check('Montar -> Buscar Planta -> Anexar -> Enviar', con['Montar Lembrete'].main[0][0].node === 'Buscar Planta' && con['Buscar Planta'].main[0][0].node === 'Anexar Planta' && con['Anexar Planta'].main[0][0].node === 'Enviar WhatsApp');
const env = w.nodes.find(n => n.name === 'Enviar WhatsApp'), bp = w.nodes.find(n => n.name === 'Buscar Planta');
check('Enviar usa endpoint/corpo', env.parameters.url === '={{ $json.endpoint }}' && env.parameters.jsonBody === '={{ JSON.stringify($json.corpo) }}' && env.credentials.httpHeaderAuth.name === 'WAHA API');
check('Buscar Planta nunca para o fluxo', bp.onError === 'continueRegularOutput' && bp.alwaysOutputData === true && bp.parameters.url === 'http://planta-loja:3100/planta');

// ---- 0.2.1: particular do tecnico (Rotear Lembrete)
const cfgP = clone(cfg);
Object.assign(cfgP[0].json.cfg, {
  empresas: [{ id: 'PONTO', dono_id: '99', assuntos_financeiros: [] }],
  tecnicos: [{ empresa: 'PONTO', id_func: '7', nome: 'Tecnico PONTO-7', fone: '5549900000002', grupo: 'gt@g.us' },
             { empresa: 'PONTO', id_func: '8', nome: 'Tecnico PONTO-8', fone: '', grupo: 'gt@g.us' },
             { empresa: 'PONTO', id_func: '99', nome: 'Dono', fone: '5541900000009', grupo: 'gt@g.us' }],
  locais: [{ empresa: 'PONTO', id_condominio: '84', nome: 'Pátio Chapecó', grupo: 'g@g.us', marcar_sem_tec: ['5541900000005'], marcar_escalar: [] }],
});
cfgP[0].json.cfg.param.grupo_dono = 'gdono@g.us';
const fjA = (tec) => [{ json: { empresa: 'PONTO', tipo: 'lembrete_1h', janela: 'em 1 hora', faltam: 55, chamado: Object.assign({}, chamado, { id_tecnico: tec }) } }];
const cliR = [{ json: { registros: [clone(base.cliente)] } }];
const rotear = (tec, c) => run(code['Rotear Lembrete'], { items: cliR, nodes: { 'Carregar Config': c || cfgP, 'Filtrar Janela': fjA(tec) } });
let ro = rotear('7');
check('0.2.1: tecnico com fone -> particular', ro[0].json.grupo_jid === '5549900000002@c.us' && ro[0].json.privado === true && ro[0].json.marcar.length === 0 && ro[0].json.shopping === 'Pátio Chapecó');
ro = rotear('8');
check('0.2.1: tecnico sem fone -> grupo', ro[0].json.grupo_jid === 'g@g.us' && ro[0].json.privado === false);
ro = rotear('0');
check('0.2.1: sem tecnico -> grupo marcando marcar_sem_tec', ro[0].json.grupo_jid === 'g@g.us' && ro[0].json.sem_tecnico && ro[0].json.marcar[0] === '5541900000005');
ro = rotear('99');
check('0.2.1: dono do numero -> grupo do dono', ro[0].json.grupo_jid === 'gdono@g.us' && ro[0].json.privado === false);
const cfgPn = clone(cfgP); cfgPn[0].json.cfg.param.lembrete_privado = 'nao';
check('0.2.1: lembrete_privado=nao -> grupo', rotear('7', cfgPn)[0].json.grupo_jid === 'g@g.us');
const rp = rotear('7');
m = run(code['Montar Lembrete'], { items: ass, nodes: { 'Carregar Config': cfgP, 'Rotear Lembrete': rp } });
check('0.2.1: 1h no particular sem @', m[0].json.texto.split('\n')[0] === '⏰ *Lembrete de visita — em 1 hora*' && m[0].json.grupo_jid === '5549900000002@c.us' && m[0].json.privado === true && m[0].json.planta);
a = run(code['Anexar Planta'], { items: okPl, nodes: { 'Carregar Config': cfgP, 'Montar Lembrete': m } });
check('0.2.1: foto vai para o particular, sem mentions', a[0].json.corpo.chatId === '5549900000002@c.us' && a[0].json.corpo.mentions === undefined && a[0].json.endpoint.endsWith('/api/sendImage'));
r = run(code['Resultado'], { items: [{ json: { id: 'x' } }], nodes: { 'Carregar Config': cfgP, 'Montar Lembrete': m, 'Anexar Planta': a } });
check('0.2.1: motivo particular · com planta', r[0].json.sql.includes("'particular · com planta: L1 loja 102'") && r[0].json.sql.includes("'5549900000002@c.us'"));
const rp10 = clone(rp); rp10[0].json.tipo = 'lembrete_10min'; rp10[0].json.faltam = 10;
m = run(code['Montar Lembrete'], { items: ass, nodes: { 'Carregar Config': cfgP, 'Rotear Lembrete': rp10 } });
check('0.2.1: 10 min no particular, uma linha', m[0].json.texto === '⏰ Não esqueça: visita na *Ortobom* (Pátio Chapecó, SALA 102) daqui 10 minutos, às 14:00.');
const cfgPS = clone(cfgP); cfgPS[0].json.cfg.param.envio = 'SIMULAR';
m = run(code['Montar Lembrete'], { items: ass, nodes: { 'Carregar Config': cfgPS, 'Rotear Lembrete': rp } });
check('0.2.1: SIMULAR mostra o destino particular', m[0].json.chat_envio === '5541900000001@c.us' && m[0].json.texto.startsWith('🧪 SIMULAÇÃO → 5549900000002@c.us'));

console.log('ok:', ok, 'falhas:', falhas); process.exit(falhas.length ? 1 : 0);
