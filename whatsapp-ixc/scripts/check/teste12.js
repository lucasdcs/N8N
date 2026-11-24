// Testes da 0.6.1: so eventos de hoje / recentes, limite de avisos por rodada, limite de reenvios, 8 s entre mensagens.
// Uso: node scripts/check/teste12.js <WF01 0.6.0.json> <WF01 0.6.1.json>   (dados ficticios, sem banco)
const fs = require('fs'); const { run } = require('./harness');
const [A, B] = process.argv.slice(2);
const wfB = JSON.parse(fs.readFileSync(B, 'utf8'));
const ler = w => Object.fromEntries(w.nodes.filter(n => n.parameters.jsCode).map(n => [n.name, n.parameters.jsCode]));
const V = ler(JSON.parse(fs.readFileSync(A, 'utf8'))), N = ler(wfB);
let ok = 0; const falhas = []; const check = (n, c, x) => { if (c) ok++; else { falhas.push(n); console.log('  ✘', n, x === undefined ? '' : '\n' + x); } };
const clone = x => JSON.parse(JSON.stringify(x));

// horario de Brasilia "YYYY-MM-DD HH:MM:SS" de agora menos N minutos
const agora = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const ms = s => { const [d, h] = s.split(' '); const [Y, M, D] = d.split('-').map(Number); const [a, b, c] = h.split(':').map(Number); return Date.UTC(Y, M - 1, D, a, b, c || 0); };
const menos = min => new Date(ms(agora) - min * 60000).toISOString().replace('T', ' ').slice(0, 19);
const minDia = Math.floor(ms(agora) / 60000) % 1440;

const CFG = {
  empresas: [{ id: '4B', ativo: true, dono_id: '36', ignorar_assuntos: [], assuntos_financeiros: [] }],
  tecnicos: [{ empresa: '4B', id_func: '901', nome: 'Ana Um', fone: '5541900000901' }], locais: [], funcionarios: [],
  param: { envio: 'REAL', falha_max_tentativas: '5' }, pendentes: [], lembretes: [], escala_hoje: [], feriados_hoje: [], mensagens: {},
};
const cfgCom = p => { const c = clone(CFG); Object.assign(c.param, p); return c; };
const ev = (id, data, extra) => Object.assign({ id: String(id), id_chamado: String(100 + id), id_evento: '4', id_tecnico: '901', mensagem: 'x', data }, extra || {});
const processar = (code, cfg, regs) => run(code['Processar Eventos'], { items: [{ json: { registros: [] } }], static_: {}, nodes: {
  'Carregar Config': [{ json: { cfg } }], 'Empresas': [{ json: { empresa: '4B', base: 'http://x', auth: 'y', last: 0 } }],
  'Buscar Novas Mensagens': [{ json: { registros: regs } }] } }).map(x => x.json);

const regs = [ev(1, menos(2)), ev(2, menos(90)), ev(3, menos(60 * 24 + 5)), ev(4, '2026-01-01 10:00:00'), ev(5, ''), ev(6, '0000-00-00 00:00:00'),
  ev(7, menos(3), { mensagem: 'necessario vistoria de infra no local' }), ev(8, menos(60 * 30), { mensagem: 'necessario vistoria de infra no local' })];
const antes = processar(V, CFG, regs), depois = processar(N, CFG, regs);
check('antes: tudo passava (6 avisos + 2 infra)', antes.length === 10, antes.length);
const ids = depois.filter(x => x.id_evento === '4').map(x => x.id);
check('recente (2 min) passa', ids.includes('1'));
check('90 min atras nao passa (padrao 60)', !ids.includes('2'), JSON.stringify(ids));
check('ontem nao passa', !ids.includes('3'));
check('data antiga nao passa', !ids.includes('4'));
check('sem data valida passa (nao fica mudo)', ids.includes('5') && ids.includes('6'), JSON.stringify(ids));
const inf = depois.filter(x => x.id_evento === 'INFRA').map(x => x.id);
check('infra recente passa, infra antiga nao', inf.includes('7') && !inf.includes('8'), JSON.stringify(inf));
const ids0 = processar(N, cfgCom({ aviso_max_idade_min: '0' }), regs).filter(x => x.id_evento === '4').map(x => x.id);
check('aviso_max_idade_min=0: so a regra do dia', ids0.includes('1') && (minDia < 90 || ids0.includes('2')) && !ids0.includes('3'), JSON.stringify(ids0));
const ids120 = processar(N, cfgCom({ aviso_max_idade_min: '120' }), regs).filter(x => x.id_evento === '4').map(x => x.id);
check('aviso_max_idade_min=120: 90 min passa (se for hoje)', minDia < 90 || ids120.includes('2'), JSON.stringify(ids120));

// Rotear: limite por rodada
const rotear = (code, cfg, n) => {
  const pe = [], bc = [], cl = [];
  for (let i = 0; i < n; i++) {
    pe.push({ json: { empresa: '4B', id_evento: '4', id_chamado: String(200 + i), id_tecnico: '901', mensagem: 'x' } });
    bc.push({ json: { registros: [{ id: String(200 + i), protocolo: 'P' + i, id_condominio: '0', id_tecnico: '901', id_assunto: '1', data_abertura: '2026-01-01 00:00:00' }] } });
    cl.push({ json: { registros: [{ id: '5', razao: 'Cli' }] } });
  }
  return run(code['Rotear'], { items: cl, nodes: { 'Carregar Config': [{ json: { cfg } }], 'Processar Eventos': pe, 'Buscar Chamado': bc } }).map(x => x.json);
};
let r = rotear(N, CFG, 14);
check('14 avisos: 10 saem', r.filter(x => !x.ignorado).length === 10, r.filter(x => !x.ignorado).length);
check('excedente: ignorado com motivo', r.filter(x => x.ignorado && /limite de 10 avisos por rodada/.test(x.motivo)).length === 4);
check('excedente: so os campos do registro', r.filter(x => x.ignorado).every(x => x.id_chamado && x.protocolo && !x.chamado));
check('antes: os 14 saiam', rotear(V, CFG, 14).filter(x => !x.ignorado).length === 14);
check('aviso_max_rodada=3', rotear(N, cfgCom({ aviso_max_rodada: '3' }), 5).filter(x => !x.ignorado).length === 3);
check('ate o limite: igual a 0.6.0', JSON.stringify(rotear(N, CFG, 4)) === JSON.stringify(rotear(V, CFG, 4)));

// Pendentes: limite de reenvios
const pend = cfgCom({}); pend.pendentes = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, empresa: '4B', grupo: '5541900000901@c.us', texto: 't', tentativas: 1, mentioned: [] }));
const pn = run(N['Pendentes'], { item: { json: {} }, nodes: { 'Carregar Config': [{ json: { cfg: pend } }] } });
check('reenvio: no maximo 5', pn.length === 5 && pn[0].json.falha_id === 1, pn.length);
const pend2 = clone(pend); pend2.param.reenvio_max_rodada = '2';
check('reenvio_max_rodada=2', run(N['Pendentes'], { item: { json: {} }, nodes: { 'Carregar Config': [{ json: { cfg: pend2 } }] } }).length === 2);

// intervalo
const nos = Object.fromEntries(wfB.nodes.map(n => [n.name, n]));
check('Enviar e Reenviar: 1 a cada 8 s', ['Enviar WhatsApp', 'Reenviar WhatsApp'].every(n => nos[n].parameters.options.batching.batch.batchSize === 1 && nos[n].parameters.options.batching.batch.batchInterval === 8000));

console.log(`teste12: ${ok}/${ok + falhas.length}` + (falhas.length ? ' FALHAS: ' + falhas.join(' | ') : ''));
process.exit(falhas.length ? 1 : 0);
