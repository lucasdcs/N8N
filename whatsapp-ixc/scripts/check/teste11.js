// Testes da 0.6.0: avisos de chamado (WF 01) so no particular do tecnico atribuido; nada em grupo.
// Uso: node scripts/check/teste11.js <WF01 antes.json> <WF01 depois.json>
//   roda nas duas linhas: producao 0.2.x (exportado do n8n) e 0.5.0 (n8n/ do repositorio). Dados ficticios, sem banco.
const fs = require('fs'); const { run } = require('./harness');
const [A, B] = process.argv.slice(2);
const ler = f => Object.fromEntries(JSON.parse(fs.readFileSync(f, 'utf8')).nodes.filter(n => n.parameters.jsCode).map(n => [n.name, n.parameters.jsCode]));
const V = ler(A), N = ler(B);
let ok = 0; const falhas = []; const check = (n, c, x) => { if (c) ok++; else { falhas.push(n); console.log('  ✘', n, x === undefined ? '' : '\n' + x); } };
const clone = x => JSON.parse(JSON.stringify(x));

const CFG = {
  empresas: [{ id: '4B', ativo: true, dono_id: '36', ignorar_assuntos: ['99'], assuntos_financeiros: [], semtec_sem_local: true }],
  tecnicos: [{ empresa: '4B', id_func: '901', nome: 'Ana Um', fone: '5541900000901', grupo: 'gT@g.us' },
    { empresa: '4B', id_func: '902', nome: 'Bruno Dois', fone: '5541900000902', grupo: null },
    { empresa: '4B', id_func: '903', nome: 'Carla Semfone', fone: '', grupo: 'gT@g.us' }],
  locais: [{ empresa: '4B', id_condominio: '199', nome: 'Shopping Teste', grupo: 'gS@g.us', marcar_sem_tec: ['5541900000777'], marcar_escalar: ['5541900000888'] }],
  funcionarios: [{ empresa: '4B', id_func: '500', nome: 'Pessoa Escritorio' }],
  param: { envio: 'REAL', envio_teste_para: '5541900000001', waha_url: 'http://waha:3000', waha_session: 's1', grupo_dono: 'gD@g.us', dono_nome: 'Dono',
    grupo_sem_local: 'gL@g.us', supervisor_fone: '5541900000777', coordenador_fone: '5541900000888', falha_max_tentativas: '5', planta_ativo: 'nao' },
  pendentes: [], lembretes: [], escala_hoje: [{ empresa: '4B', id_condominio: '199', tecnico: 'Bruno Dois' }], feriados_hoje: [], mensagens: {},
};
const cfgCom = p => { const c = clone(CFG); Object.assign(c.param, p); return c; };
const AB = '2026-01-01 00:00:00';
// ev = evento de Processar Eventos; tecCh = id_tecnico do chamado
const rotear = (code, cfg, ev, tecCh, cond = '199') => run(code['Rotear'], {
  items: [{ json: { registros: [{ id: '5', razao: 'Cliente Teste', id_condominio: cond }] } }], nodes: {
    'Carregar Config': [{ json: { cfg } }],
    'Processar Eventos': [{ json: Object.assign({ empresa: '4B', id_chamado: '77', mensagem: 'texto da O.S.' }, ev) }],
    'Buscar Chamado': [{ json: { registros: [{ id: '77', protocolo: 'P77', id_condominio: cond, id_tecnico: tecCh, id_assunto: '1', data_abertura: AB, mensagem: '' }] } }] } });
const montar = (code, cfg, r) => run(code['Montar Mensagem'], { items: [{ json: { registros: [{ assunto: 'Assistencia Tecnica' }] } }],
  nodes: { 'Carregar Config': [{ json: { cfg } }], 'Rotear': r } });
const anexar = (code, cfg, m) => run(code['Anexar Planta'], { items: [{ json: {} }], nodes: { 'Carregar Config': [{ json: { cfg } }], 'Montar Mensagem': m } });

const ASS = { id_evento: '4', id_tecnico: '901' };  // transferido (chamado antigo)
// ---------- antes: ia para o grupo
let r0 = rotear(V, CFG, ASS, '901');
check('antes: transferido ia para o grupo do shopping com @', r0[0].json.grupo_jid === 'gS@g.us' && r0[0].json.marcar.includes('5541900000901'), JSON.stringify(r0[0].json));

// ---------- depois: particular
let r = rotear(N, CFG, ASS, '901');
let j = r[0].json;
check('transferido -> particular do tecnico', !j.ignorado && j.grupo_jid === '5541900000901@c.us', JSON.stringify(j));
check('particular: sem @ e sem nome no topo', j.marcar.length === 0 && !j.nome);
check('particular: shopping continua na mensagem', j.shopping === 'Shopping Teste');
let m = montar(N, CFG, r);
check('texto: cabecalho sem marcacao', /^📨 Chamado transferido\n/.test(m[0].json.texto) && !/@\d/.test(m[0].json.texto), m[0].json.texto);
check('texto: 🏢 shopping', m[0].json.texto.includes('🏢 Shopping Teste'), m[0].json.texto);
check('mentioned vazio', m[0].json.mentioned.length === 0);
let a = anexar(N, CFG, m);
check('WAHA: chatId particular, sem mentions', a[0].json.corpo.chatId === '5541900000901@c.us' && !a[0].json.corpo.mentions && a[0].json.endpoint.endsWith('/api/sendText'), JSON.stringify(a[0].json.corpo));
a = anexar(N, cfgCom({ envio: 'SIMULAR' }), m);
check('SIMULAR: vai para o teste com o particular no cabecalho', a[0].json.corpo.chatId === '5541900000001@c.us' && a[0].json.corpo.text.includes('→ 5541900000901@c.us'), a[0].json.corpo.text);

j = rotear(N, CFG, { id_evento: '4', id_tecnico: '902' }, '902')[0].json;
check('transferido para outro -> particular do novo tecnico', j.grupo_jid === '5541900000902@c.us', JSON.stringify(j));
j = rotear(N, CFG, { id_evento: '1', id_tecnico: '901' }, '901')[0].json;
check('aberto ja com tecnico -> particular', j.grupo_jid === '5541900000901@c.us' && j.evento_label === 'Novo chamado');

// tecnico de folga (planilha diz Bruno Dois): antes marcava o plantao no grupo; agora so o atribuido
check('antes: folga marcava o plantao', !!rotear(V, CFG, ASS, '901')[0].json.folga);
j = rotear(N, CFG, ASS, '901')[0].json;
check('folga: sem linha de folga e sem marcar o plantao', !j.folga && j.marcar.length === 0, JSON.stringify(j));

// sem shopping mapeado: tecnico sem grupo antes era ignorado; agora recebe no particular
check('antes: sem shopping e tecnico sem grupo = ignorado', rotear(V, CFG, { id_evento: '4', id_tecnico: '902' }, '902', '555')[0].json.ignorado === true);
j = rotear(N, CFG, { id_evento: '4', id_tecnico: '902' }, '902', '555')[0].json;
check('sem shopping: particular mesmo assim', !j.ignorado && j.grupo_jid === '5541900000902@c.us' && j.shopping === null, JSON.stringify(j));

// ---------- o que nao sai (registrado como ignorado)
const ign = (ev, tec, cond, cfg = CFG) => { const x = rotear(N, cfg, ev, tec, cond); return x.length ? x[0].json : null; };
j = ign({ id: null, id_evento: 'SEMTEC', id_tecnico: '0', realerta: false, escalar: false, idade_min: 12 }, '0');
check('sem tecnico (1o aviso) -> ignorado', j && j.ignorado && /sem técnico atribuído/.test(j.motivo), JSON.stringify(j));
check('antes: sem tecnico ia ao grupo do shopping', rotear(V, CFG, { id_evento: 'SEMTEC', id_tecnico: '0', realerta: false, escalar: false }, '0')[0].json.grupo_jid === 'gS@g.us');
j = ign({ id_evento: 'SEMTEC', id_tecnico: '0', realerta: true, escalar: true, idade_min: 300 }, '0');
check('escalado -> ignorado', j && j.ignorado, JSON.stringify(j));
j = ign({ id_evento: 'SEMTEC', id_tecnico: '0', realerta: false, escalar: false }, '0', '555');
check('sem tecnico e sem shopping -> ignorado (nao vai ao grupo_sem_local)', j && j.ignorado, JSON.stringify(j));
j = ign({ id_evento: '8', id_tecnico: '901' }, '901');
check('assumido -> ignorado (cortado)', j && j.ignorado && /assumido/.test(j.motivo), JSON.stringify(j));
check('antes: assumido saia', rotear(V, CFG, { id_evento: '8', id_tecnico: '901' }, '901')[0].json.ignorado === false);
const INF = { id_evento: 'INFRA', id_tecnico: '901', autor: '901' };
j = ign(INF, '901');
check('infra sem infra_fone -> ignorado', j && j.ignorado && /infra_fone/.test(j.motivo), JSON.stringify(j));
const cI = cfgCom({ infra_fone: '(45) 9000-0555' }), cI55 = cfgCom({ infra_fone: '5545900000555' });
j = ign(INF, '901', '199', cI);
check('infra_fone sem 55 (< 12 digitos) -> ignorado', j && j.ignorado, JSON.stringify(j));
r = rotear(N, cI55, INF, '901'); j = r[0].json;
check('infra -> particular do responsavel', !j.ignorado && j.grupo_jid === '5545900000555@c.us' && j.marcar.length === 0 && j.shopping === 'Shopping Teste', JSON.stringify(j));
check('antes: infra ia para o grupo_dono', rotear(V, CFG, INF, '901')[0].json.grupo_jid === 'gD@g.us');
m = montar(N, cI55, r);
check('infra: texto com o autor', /^🏗️ Pedido de infra — Ana Um\n/.test(m[0].json.texto), m[0].json.texto);
j = ign(INF, '901', '555', cI55);
check('infra sem shopping: particular com Local nao identificado', !j.ignorado && j.shopping === 'Local não identificado', JSON.stringify(j));
j = ign({ id_evento: '4', id_tecnico: '36' }, '36');
check('dono do numero -> ignorado', j && j.ignorado && /dono do número/.test(j.motivo), JSON.stringify(j));
j = ign({ id_evento: '4', id_tecnico: '903' }, '903');
check('tecnico sem telefone -> ignorado', j && j.ignorado && /sem telefone/.test(j.motivo), JSON.stringify(j));
j = ign({ id_evento: '4', id_tecnico: '500' }, '500');
check('funcionario fora de ixc.tecnicos -> ignorado', j && j.ignorado && /fora do cadastro/.test(j.motivo), JSON.stringify(j));
check('nenhum destino em grupo', [ASS, { id_evento: '1', id_tecnico: '902' }].every(e => !/@g\.us$/.test(rotear(N, CFG, e, e.id_tecnico)[0].json.grupo_jid || '')));

// ---------- aviso_privado = 'nao' volta ao anterior
const off = cfgCom({ aviso_privado: 'nao' });
check('aviso_privado=nao: igual ao antes (assumido)', JSON.stringify(rotear(N, off, ASS, '901')) === JSON.stringify(rotear(V, off, ASS, '901')));
check('aviso_privado=nao: igual ao antes (sem tecnico)', JSON.stringify(rotear(N, off, { id_evento: 'SEMTEC', id_tecnico: '0', realerta: false, escalar: false }, '0'))
  === JSON.stringify(rotear(V, off, { id_evento: 'SEMTEC', id_tecnico: '0', realerta: false, escalar: false }, '0')));

// ---------- reenvio: falha antiga para grupo nao volta
const pend = cfgCom({}); pend.pendentes = [{ id: 1, empresa: '4B', grupo: 'gS@g.us', texto: 'x', tentativas: 1, mentioned: [] }, { id: 2, empresa: '4B', grupo: '5541900000901@c.us', texto: 'y', tentativas: 1, mentioned: [] }];
const pn = run(N['Pendentes'], { item: { json: {} }, nodes: { 'Carregar Config': [{ json: { cfg: pend } }] } });
check('reenvio: so o particular', pn.length === 1 && pn[0].json.falha_id === 2, JSON.stringify(pn));
const pendOff = clone(pend); pendOff.param.aviso_privado = 'nao';
check('reenvio com aviso_privado=nao: os dois', run(N['Pendentes'], { item: { json: {} }, nodes: { 'Carregar Config': [{ json: { cfg: pendOff } }] } }).length === 2);

console.log(`teste11: ${ok}/${ok + falhas.length}` + (falhas.length ? ' FALHAS: ' + falhas.join(' | ') : ''));
process.exit(falhas.length ? 1 : 0);
