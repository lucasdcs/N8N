// Testes da 0.6.6: pedido de infra pelo encaminhamento (dono, assunto e setor de infra), citacao de outra O.S. e O.S. finalizada.
// Uso: node scripts/check/teste17.js <WF01 0.6.5.json> <WF01 0.6.6.json>   (dados ficticios, sem banco)
// Diferencial: tudo o que nao envolve infra tem que sair identico a versao anterior.
const fs = require('fs'); const { run } = require('./harness');
const [A, B] = process.argv.slice(2);
const ler = f => Object.fromEntries(JSON.parse(fs.readFileSync(f, 'utf8')).nodes.filter(n => n.parameters.jsCode).map(n => [n.name, n.parameters.jsCode]));
const V = ler(A), N = ler(B);
let ok = 0; const falhas = []; const check = (n, c, x) => { if (c) ok++; else { falhas.push(n); console.log('  ✘', n, x === undefined ? '' : '\n' + JSON.stringify(x, null, 1)); } };
const clone = x => JSON.parse(JSON.stringify(x));

const agora = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const ms = s => { const [d, h] = s.split(' '); const [Y, M, D] = d.split('-').map(Number); const [a, b, c] = h.split(':').map(Number); return Date.UTC(Y, M - 1, D, a, b, c || 0); };
const menos = min => new Date(ms(agora) - min * 60000).toISOString().replace('T', ' ').slice(0, 19);

const INFRA = '5545900000555';
const CFG = {
  empresas: [{ id: 'BZ', ativo: true, dono_id: '51', ignorar_assuntos: ['99'], assuntos_financeiros: ['98'], semtec_sem_local: true },
    { id: '4B', ativo: true, dono_id: '52', ignorar_assuntos: [], assuntos_financeiros: [] }],
  tecnicos: [{ empresa: 'BZ', id_func: '46', nome: 'Ana Um', fone: '5541900000046', grupo: 'gT@g.us' },
    { empresa: '4B', id_func: '46', nome: 'Bia Quatro', fone: '5541900000146', grupo: 'gT@g.us' }],
  locais: [{ empresa: 'BZ', id_condominio: '199', nome: 'Shopping Teste', grupo: 'gS@g.us', marcar_sem_tec: ['5541900000777'], marcar_escalar: [] }],
  funcionarios: [{ empresa: 'BZ', id_func: '51', nome: 'Resp Infra' }, { empresa: 'BZ', id_func: '60', nome: 'Pessoa Escritorio' }],
  param: { envio: 'REAL', envio_teste_para: '5541900000001', grupo_dono: 'gD@g.us', dono_nome: 'Dono', grupo_sem_local: 'gL@g.us',
    supervisor_fone: '5541900000777', coordenador_fone: '5541900000888', falha_max_tentativas: '5', planta_ativo: 'nao', infra_fone: INFRA },
  pendentes: [], lembretes: [], escala_hoje: [], feriados_hoje: [], mensagens: {},
};
const PARAM_INFRA = { infra_assuntos: 'BZ:33, BZ:77,4B:15', infra_setores: 'BZ:9,4B:9' };
const cfgCom = p => { const c = clone(CFG); Object.assign(c.param, p); return c; };

// ---------- Processar Eventos ----------
const processar = (code, cfg, regs, st) => run(code['Processar Eventos'], { items: [{ json: { registros: [] } }, { json: { registros: [] } }], static_: st || {}, nodes: {
  'Carregar Config': [{ json: { cfg } }], 'Empresas': [{ json: { empresa: 'BZ', base: 'http://x', auth: 'y', last: 0 } }, { json: { empresa: '4B', base: 'http://x', auth: 'y', last: 0 } }],
  'Buscar Novas Mensagens': [{ json: { registros: regs } }, { json: { registros: [] } }] } }).map(x => x.json);
let nM = 0;
const msg = (txt, extra) => Object.assign({ id: String(++nM), id_chamado: String(700 + nM), id_evento: '2', id_tecnico: '46', mensagem: txt, data: menos(2) }, extra || {});
const infraDe = (code, txt) => processar(code, CFG, [msg(txt)]).some(x => x.id_evento === 'INFRA');

const CITA = ['Fulano, replicar as informações da O.S de EXECUÇÃO DE INFRA aqui e encerrar esta O.S', 'ver a OS da vistoria de infra do cliente',
  'conforme O.S. de avaliação de infra anterior', 'mesma situação da o.s de pendência de infra'];
for (const t of CITA) {
  if (!/avalia/.test(t)) check('0.6.5 marcava como pedido: ' + t.slice(0, 40), infraDe(V, t));
  check('0.6.6 nao marca (cita outra O.S.): ' + t.slice(0, 40), !infraDe(N, t));
}
const PEDE = ['necessario vistoria de infra no local', 'precisa de infraestrutura', 'encaminhar para infra', 'aguardando infra', 'loja sem infra',
  'tratar com equipe de infra', 'execução de infra pendente no local', 'Necessário execução de infra antes da ativação'];
for (const t of PEDE) check('pedido continua valendo: ' + t, infraDe(N, t) && infraDe(V, t));
for (const t of ['Processo: Vistoria de Link. vistoria de infra', 'não necessita infra', 'chamado normal sem nada']) check('nao e pedido nas duas: ' + t, !infraDe(N, t) && !infraDe(V, t));
// Processar Eventos fora do infra: identico
const regsNormais = [msg('x', { id_evento: '1', id_tecnico: '0' }), msg('y', { id_evento: '4' }), msg('z', { id_evento: '8' }), msg('w', { id_evento: '3' }), msg('velho', { id_evento: '4', data: menos(300) })];
check('Processar Eventos: eventos comuns identicos', JSON.stringify(processar(V, CFG, regsNormais)) === JSON.stringify(processar(N, CFG, regsNormais)));

// ---------- Rotear ----------
// casos: [{ emp, ev, tecMsg, ch: {id, id_tecnico, id_assunto, setor, status}, texto }]
let nCh = 0;
function rotear(code, cfg, casos, st) {
  const pe = [], bc = [], cl = [];
  for (const k of casos) {
    pe.push({ json: { empresa: k.emp || 'BZ', id_evento: k.ev, id_chamado: k.ch.id, id_tecnico: k.tecMsg === undefined ? (k.ch.id_tecnico || '0') : k.tecMsg, mensagem: k.texto || 'texto da O.S.', autor: k.autor } });
    bc.push({ json: { registros: [Object.assign({ protocolo: 'P' + k.ch.id, id_condominio: '199', id_tecnico: '0', id_assunto: '1', setor: '11', status: 'A', data_abertura: menos(1) }, k.ch)] } });
    cl.push({ json: { registros: [{ id: '5', razao: 'Cli', id_condominio: '199' }] } });
  }
  return run(code['Rotear'], { items: cl, static_: st || {}, nodes: { 'Carregar Config': [{ json: { cfg } }], 'Processar Eventos': pe, 'Buscar Chamado': bc } }).map(x => x.json);
}
const ch = o => Object.assign({ id: String(800 + ++nCh) }, o);
const so = (r, f) => r.filter(f);
const infras = r => so(r, x => x.evento === 'INFRA');
const enviados = r => so(r, x => !x.ignorado);
const CI = cfgCom(PARAM_INFRA);

// 1) aberta sem tecnico, assunto de infra
let c1 = ch({ id_assunto: '33' }), r5 = rotear(V, CI, [{ ev: '1', ch: c1 }]), r6 = rotear(N, CI, [{ ev: '1', ch: c1 }]);
check('assunto infra, aberta sem tecnico: 0.6.5 nao avisava', r5.length === 0, r5);
check('assunto infra, aberta sem tecnico: 0.6.6 avisa infra_fone', r6.length === 1 && !r6[0].ignorado && r6[0].evento === 'INFRA' && r6[0].grupo_jid === INFRA + '@c.us' && r6[0].evento_label === 'Pedido de infra' && r6[0].evento_emoji === '🏗️', r6);
check('pedido leva o texto de abertura e o shopping', r6[0] && r6[0].mensagem === 'texto da O.S.' && r6[0].shopping === 'Shopping Teste' && r6[0].chamado.id === c1.id && r6[0].primeira === false);
check('sem os parametros: igual a 0.6.5', JSON.stringify(rotear(N, CFG, [{ ev: '1', ch: ch({ id_assunto: '33' }) }])) === '[]');
check('espacos na lista de assuntos (BZ:77)', infras(rotear(N, CI, [{ ev: '1', ch: ch({ id_assunto: '77' }) }])).length === 1);
check('assunto de infra de outra empresa nao vale (4B:15 numa O.S. BZ)', infras(rotear(N, CI, [{ ev: '1', ch: ch({ id_assunto: '15' }) }])).length === 0);
check('assunto de infra na 4B', infras(rotear(N, CI, [{ emp: '4B', ev: '1', ch: ch({ id_assunto: '15' }) }])).length === 1);

// 2) aberta com tecnico, assunto de infra: pedido + aviso normal ao tecnico
let r = rotear(N, CI, [{ ev: '1', ch: ch({ id_assunto: '33', id_tecnico: '46' }) }]);
check('assunto infra com tecnico: pedido + Novo chamado ao tecnico', enviados(r).length === 2 && infras(r).length === 1 && so(r, x => x.evento === '1' && x.grupo_jid === '5541900000046@c.us' && x.evento_label === 'Novo chamado').length === 1, r);
check('pedido com tecnico mostra o nome dele', infras(r)[0].evento_label === 'Pedido de infra — Ana Um');
check('aviso ao tecnico identico a 0.6.5', JSON.stringify(so(r, x => x.evento === '1')) === JSON.stringify(rotear(V, CI, [{ ev: '1', ch: ch({ id: so(r, x => x.evento === '1')[0].id_chamado, id_assunto: '33', id_tecnico: '46' }) }])));

// 3) transferida (nao nova) com assunto de infra, fora do setor: so o aviso do tecnico (assunto vale na abertura)
let c3 = ch({ id_assunto: '33', id_tecnico: '46', data_abertura: menos(600) });
r = rotear(N, CI, [{ ev: '4', ch: c3 }]);
check('assunto infra transferida ao tecnico (sem setor infra): sem pedido', infras(r).length === 0 && JSON.stringify(r) === JSON.stringify(rotear(V, CI, [{ ev: '4', ch: c3 }])), r);

// 4) transferida para o dono (responsavel pela infra)
let c4 = ch({ id_tecnico: '51', data_abertura: menos(600) });
r5 = rotear(V, CFG, [{ ev: '4', ch: c4 }]); r6 = rotear(N, CFG, [{ ev: '4', ch: c4 }]);
check('dono: 0.6.5 so ignorava', r5.length === 1 && r5[0].ignorado && /dono do número/.test(r5[0].motivo), r5);
check('dono: 0.6.6 pedido para infra_fone + o mesmo registro de ignorado', r6.length === 2 && infras(r6).length === 1 && !infras(r6)[0].ignorado && infras(r6)[0].grupo_jid === INFRA + '@c.us'
  && infras(r6)[0].evento_label === 'Pedido de infra' && JSON.stringify(so(r6, x => x.evento === '4')) === JSON.stringify(r5), r6);
check('dono: vale sem infra_assuntos/infra_setores (so dono_id)', infras(rotear(N, CFG, [{ ev: '1', ch: ch({ id_tecnico: '51' }) }])).length === 1);
check('dono na 4B (52)', infras(rotear(N, CFG, [{ emp: '4B', ev: '4', ch: ch({ id_tecnico: '52', data_abertura: menos(600) }) }])).length === 1);
check('id do dono de outra empresa nao vale (52 na BZ)', infras(rotear(N, CFG, [{ ev: '4', ch: ch({ id_tecnico: '52', data_abertura: menos(600) }) }])).length === 0);
check('dono assumiu (evento 8): sem pedido, igual a 0.6.5', (() => { const c = ch({ id_tecnico: '51', data_abertura: menos(600) }); return JSON.stringify(rotear(N, CFG, [{ ev: '8', ch: c }])) === JSON.stringify(rotear(V, CFG, [{ ev: '8', ch: c }])); })());

// 5) setor de infra
let c5 = ch({ setor: '9', id_tecnico: '46', data_abertura: menos(600) });
r = rotear(N, CI, [{ ev: '4', ch: c5 }]);
check('transferida no setor infra para tecnico: pedido + aviso do tecnico', infras(r).length === 1 && so(r, x => x.evento === '4' && !x.ignorado).length === 1, r);
r = rotear(N, CI, [{ ev: '1', ch: ch({ setor: '9' }) }]);
check('aberta no setor infra sem ninguem: pedido', infras(r).length === 1 && r.length === 1, r);
check('setor 9 sem infra_setores: nada', rotear(N, cfgCom({ infra_assuntos: 'BZ:33' }), [{ ev: '1', ch: ch({ setor: '9' }) }]).length === 0);

// 6) trava de 6 h (memoria do workflow) e uma vez por O.S. na rodada
const st = {}; const c6 = ch({ id_assunto: '33' });
check('1a vez avisa', infras(rotear(N, CI, [{ ev: '1', ch: c6 }], st)).length === 1);
check('transferida ao dono logo depois: nao repete (trava 6 h)', infras(rotear(N, CI, [{ ev: '4', ch: Object.assign({}, c6, { id_tecnico: '51' }) }], st)).length === 0);
check('memoria antiga (7 h): avisa de novo', (() => { const s = { infra: {} }; s.infra['BZ:' + c6.id] = ms(agora) - 7 * 3600000; return infras(rotear(N, CI, [{ ev: '4', ch: Object.assign({}, c6, { id_tecnico: '51' }) }], s)).length === 1; })());
const c6b = ch({ id_assunto: '33', id_tecnico: '51' });
r = rotear(N, CI, [{ ev: '1', ch: c6b }, { ev: '4', ch: c6b }]);
check('aberta e transferida ao dono na mesma rodada: 1 pedido so', infras(r).length === 1, r);
// pedido escrito por outra pessoa (46) numa O.S. que esta com o dono + transferencia ao dono na mesma rodada:
// passa pelo Processar Eventos de verdade (marca a trava) e depois pelo Rotear -> 1 pedido so (0.6.5: nenhum)
const doProcessar = (code, cfg, regs, st) => processar(code, cfg, regs, st).map(x => ({ ev: x.id_evento, tecMsg: x.id_tecnico, autor: x.autor, texto: x.mensagem }));
const fluxo = (code, regs, chamado) => { const s = {}; const ev = doProcessar(code, CFG, regs, s).map(k => Object.assign(k, { ch: chamado })); return rotear(code, CFG, ev, s); };
const c6c = ch({ id_tecnico: '51', data_abertura: menos(600) });
const regs6 = [msg('Transferido', { id_evento: '4', id_chamado: c6c.id, id_tecnico: '51' }), msg('necessario vistoria de infra', { id_evento: '2', id_chamado: c6c.id, id_tecnico: '46' })];
r6 = fluxo(N, regs6, c6c); r5 = fluxo(V, regs6, c6c);
check('dono + pedido escrito na mesma rodada: 1 pedido (0.6.5: nenhum)', infras(enviados(r6)).length === 1 && infras(enviados(r5)).length === 0, { r6, r5 });
const regs6b = [msg('Transferido, necessario vistoria de infra', { id_evento: '4', id_chamado: c6c.id, id_tecnico: '51' })];
check('transferido ao dono com frase de infra: 1 pedido', infras(enviados(fluxo(N, regs6b, c6c))).length === 1);
const c6d = ch({ id_tecnico: '46', data_abertura: menos(600) });
const regs6d = [msg('necessario vistoria de infra', { id_evento: '2', id_chamado: c6d.id, id_tecnico: '46' })];
check('pedido escrito comum: identico a 0.6.5 (Processar + Rotear)', JSON.stringify(fluxo(N, regs6d, c6d)) === JSON.stringify(fluxo(V, regs6d, c6d)));

// 7) O.S. finalizada
r = rotear(N, CI, [{ ev: '1', ch: ch({ id_assunto: '33', status: 'F' }) }]);
check('assunto infra ja finalizada: ignorado com motivo', r.length === 1 && r[0].ignorado && r[0].evento === 'INFRA' && r[0].motivo === 'pedido de infra: O.S. já finalizada', r);
const c7 = ch({ id_tecnico: '46', status: 'F', data_abertura: menos(600) });
r5 = rotear(V, CFG, [{ ev: 'INFRA', ch: c7, autor: '46', texto: 'necessario vistoria de infra' }]);
r6 = rotear(N, CFG, [{ ev: 'INFRA', ch: c7, autor: '46', texto: 'necessario vistoria de infra' }]);
check('pedido escrito em O.S. finalizada: 0.6.5 mandava', enviados(r5).length === 1, r5);
check('pedido escrito em O.S. finalizada: 0.6.6 ignora com motivo', r6.length === 1 && r6[0].ignorado && r6[0].motivo === 'pedido de infra: O.S. já finalizada', r6);
const c7b = ch({ id_tecnico: '46', data_abertura: menos(600) });
check('pedido escrito em O.S. aberta: identico a 0.6.5', JSON.stringify(rotear(N, CFG, [{ ev: 'INFRA', ch: c7b, autor: '46', texto: 'necessario vistoria de infra' }]))
  === JSON.stringify(rotear(V, CFG, [{ ev: 'INFRA', ch: c7b, autor: '46', texto: 'necessario vistoria de infra' }])));

// 8) sem infra_fone
r = rotear(N, cfgCom(Object.assign({}, PARAM_INFRA, { infra_fone: '' })), [{ ev: '1', ch: ch({ id_assunto: '33' }) }]);
check('sem infra_fone: ignorado com motivo', r.length === 1 && r[0].ignorado && r[0].motivo === 'pedido de infra: infra_fone não cadastrado', r);

// 9) assunto ignorado/financeiro continua fora
check('assunto automatico continua ignorado', (() => { const x = rotear(N, cfgCom({ infra_assuntos: 'BZ:99' }), [{ ev: '1', ch: ch({ id_assunto: '99' }) }]); return x.length === 1 && x[0].motivo === 'assunto automático'; })());

// 10) modo grupo (aviso_privado = nao): igual a 0.6.5, exceto O.S. finalizada
const G = cfgCom(Object.assign({ aviso_privado: 'nao' }, PARAM_INFRA));
const casosG = [{ ev: '4', ch: ch({ id_tecnico: '51', data_abertura: menos(600) }) }, { ev: '1', ch: ch({ id_assunto: '33' }) }, { ev: '4', ch: ch({ setor: '9', id_tecnico: '46', data_abertura: menos(600) }) },
  { ev: 'INFRA', ch: ch({ id_tecnico: '51' }), autor: '46', texto: 'necessario vistoria de infra' }, { ev: 'INFRA', ch: ch({ id_tecnico: '46' }), autor: '46', texto: 'necessario vistoria de infra' }];
check('modo grupo: identico a 0.6.5', JSON.stringify(rotear(N, G, casosG)) === JSON.stringify(rotear(V, G, casosG)));

// 11) diferencial: lote comum (sem nada de infra) identico, com e sem parametros
const lote = [{ ev: '1', ch: ch({ id_tecnico: '46' }) }, { ev: '1', ch: ch({}) }, { ev: '4', ch: ch({ id_tecnico: '46', data_abertura: menos(600) }) },
  { ev: '8', ch: ch({ id_tecnico: '46' }) }, { ev: '4', ch: ch({ id_tecnico: '60', data_abertura: menos(600) }) }, { ev: 'SEMTEC', ch: ch({}) },
  { ev: '1', ch: ch({ id_assunto: '98' }) }, { emp: '4B', ev: '4', ch: ch({ id_tecnico: '46', data_abertura: menos(600) }) }];
check('lote comum identico (sem parametros)', JSON.stringify(rotear(N, CFG, lote)) === JSON.stringify(rotear(V, CFG, lote)));
check('lote comum identico (com parametros)', JSON.stringify(rotear(N, CI, lote)) === JSON.stringify(rotear(V, CI, lote)));
// 12) limite de avisos por rodada conta os pedidos
const muitos = Array.from({ length: 12 }, () => ({ ev: '1', ch: ch({ id_assunto: '33', id_tecnico: '46' }) }));
r = rotear(N, CI, muitos);
check('limite de 10 por rodada inclui os pedidos de infra', enviados(r).length === 10 && so(r, x => x.ignorado && /limite de 10/.test(x.motivo)).length === 14, enviados(r).length);

// 13) Montar Mensagem aceita o item novo (texto do pedido)
try {
  const it = infras(rotear(N, CI, [{ ev: '1', ch: ch({ id_assunto: '33' }) }]))[0];
  const mm = run(N['Montar Mensagem'], { items: [{ json: { registros: [{ id: '33', assunto: 'Execucao infra' }] } }], nodes: { 'Carregar Config': [{ json: { cfg: CI } }], 'Rotear': [{ json: it }], 'Ignorado?': [{ json: it }] } }).map(x => x.json);
  check('Montar Mensagem: texto do pedido', mm.length === 1 && mm[0].evento === 'INFRA' && /^🏗️ Pedido de infra\n🎫 #P/.test(mm[0].texto) && mm[0].grupo_jid === INFRA + '@c.us', mm);
} catch (e) { check('Montar Mensagem roda com o item novo', false, String(e.stack || e)); }

console.log(`teste17: ${ok}/${ok + falhas.length}` + (falhas.length ? ' FALHAS: ' + falhas.join(' | ') : ''));
process.exit(falhas.length ? 1 : 0);
