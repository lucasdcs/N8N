// Simulador do whatsapp-ixc (ambiente de TESTE): WhatsApp (WAHA) de mentira + IXC de mentira + planta de exemplo.
// Os workflows "[SIM]" do n8n de teste chamam este serviço no lugar do WAHA, do IXC e do planta-loja.
// Nada daqui fala com o WhatsApp real nem com o IXC real. Tela: http://<servidor>:3999/ (usuário "sim", senha SIM_SENHA).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const VERSAO = '0.1.1';
const PORTA = +process.env.PORTA || 3999;
const SENHA = process.env.SIM_SENHA || '';
const N8N = String(process.env.N8N_URL || 'http://n8n-compose-n8n-1:5678').replace(/\/+$/, '');
const DADOS = process.env.DADOS || path.join(__dirname, 'dados');
const ARQ = path.join(DADOS, 'estado.json');
const PUB = path.join(__dirname, 'public');
const PLANTA = fs.existsSync(path.join(__dirname, 'planta-exemplo.png')) ? fs.readFileSync(path.join(__dirname, 'planta-exemplo.png')).toString('base64') : '';
const BOT = { fone: process.env.BOT_FONE || '554100000000', nome: 'Bot (número da automação)' };
const MAX_MSG = 3000, MAX_LOG = 300;

// ---------- estado (arquivo em dados/, sobrevive a restart) ----------
let E = { seq: 0, msgs: [], ixc: {}, idMsg: {}, idCh: 900000, idCli: 800000, wahaFora: false };
try { Object.assign(E, JSON.parse(fs.readFileSync(ARQ, 'utf8'))); } catch (e) { /* primeiro uso */ }
let LOG = [];
let CHAM = [];   // chamadas do n8n (para o resumo do botão ▶): { t, tipo: 'ixc'|'waha', emp, tabela, qtype, n, chat }
function chamada(x) { x.t = Date.now(); CHAM.push(x); if (CHAM.length > 500) CHAM = CHAM.slice(-500); }
let gravarT = null;
function gravar() {
  clearTimeout(gravarT);
  gravarT = setTimeout(() => { try { fs.mkdirSync(DADOS, { recursive: true }); fs.writeFileSync(ARQ + '.tmp', JSON.stringify(E)); fs.renameSync(ARQ + '.tmp', ARQ); } catch (e) { console.error('gravar', e.message); } }, 300);
}
function log(tipo, txt) { LOG.push({ t: Date.now(), tipo, txt: String(txt).slice(0, 400) }); if (LOG.length > MAX_LOG) LOG = LOG.slice(-MAX_LOG); }
function novaMsg(m) {
  m.seq = ++E.seq; m.t = m.t || Date.now();
  E.msgs.push(m); if (E.msgs.length > MAX_MSG) E.msgs = E.msgs.slice(-MAX_MSG);
  gravar(); return m;
}
const idWa = () => crypto.randomBytes(10).toString('hex').toUpperCase();

// ---------- horario de Brasilia no formato do IXC ----------
function brt(ms) { return new Date(ms === undefined ? Date.now() : ms).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace('T', ' ').slice(0, 19); }

// ---------- cadastro (lido do banco de teste) ----------
let CAD = { ok: false, erro: 'ainda não leu o banco', empresas: [], locais: [], tecnicos: [], funcionarios: [], grupos: {}, param: {} };
async function lerBanco() {
  const c = new Client({ connectionTimeoutMillis: 5000 });
  try {
    await c.connect();
    const r = await c.query(`SELECT json_build_object(
      'empresas', (SELECT coalesce(json_agg(json_build_object('id', e.id, 'nome', e.nome, 'last', e.last_evento_id, 'dono_id', e.dono_id, 'ativo', e.ativo,
                    'ignorar', e.ignorar_assuntos, 'financeiros', e.assuntos_financeiros, 'base_url', e.base_url) ORDER BY e.id), '[]'::json) FROM ixc.empresas e),
      'locais', (SELECT coalesce(json_agg(json_build_object('empresa', l.empresa, 'id', l.id_condominio, 'nome', l.nome, 'grupo', l.grupo) ORDER BY l.nome), '[]'::json) FROM ixc.locais l),
      'tecnicos', (SELECT coalesce(json_agg(json_build_object('empresa', t.empresa, 'id', t.id_func, 'nome', t.nome, 'fone', t.fone, 'grupo', t.grupo) ORDER BY t.nome), '[]'::json) FROM ixc.tecnicos t),
      'funcionarios', (SELECT coalesce(json_agg(json_build_object('empresa', f.empresa, 'id', f.id_func, 'nome', f.nome) ORDER BY f.nome), '[]'::json) FROM ixc.funcionarios f),
      'param', (SELECT coalesce(json_object_agg(p.chave, p.valor), '{}'::json) FROM ixc.parametros p)
    ) AS cad`);
    const d = r.rows[0].cad;
    const P = d.param || {};
    const grupos = {};
    const add = (jid, nome, tipo) => { jid = String(jid || '').trim(); if (!jid) return; const g = grupos[jid] = grupos[jid] || { jid, nomes: [], tipo }; if (!g.nomes.includes(nome)) g.nomes.push(nome); if (tipo === 'sistema') g.tipo = 'sistema'; };
    add(P.grupo_automacao, 'Automação (comandos ixc)', 'sistema');
    add(P.setores_grupo, 'Recados (setores)', 'sistema');
    String(P.escala_grupos || '').split(',').forEach(j => add(j, 'Grupo de escala', 'sistema'));
    add(P.grupo_dono, 'Grupo do dono' + (P.dono_nome ? ' (' + P.dono_nome + ')' : ''), 'sistema');
    add(P.grupo_sem_local, 'Sem local identificado', 'sistema');
    for (const l of d.locais) add(l.grupo, l.nome, 'shopping');
    for (const t of d.tecnicos) if (t.grupo) add(t.grupo, 'Grupo de ' + t.nome, 'tecnico');
    const envio = String(P.envio || '').toUpperCase();
    const base = d.empresas.map(e => String(e.base_url || ''));
    CAD = { ok: true, erro: null, lido: Date.now(), empresas: d.empresas.map(e => { delete e.base_url; return e; }), locais: d.locais, tecnicos: d.tecnicos, funcionarios: d.funcionarios, grupos,
      param: { envio, envio_teste_para: P.envio_teste_para || '', waha_url: P.waha_url || '', semtec_min: P.semtec_min || '10', planta_ativo: P.planta_ativo || '', lembrete_privado: P.lembrete_privado || 'sim',
        base_ok: base.every(b => /ixc-simulador/.test(b)) } };
    for (const e of CAD.empresas) { const ix = emp(e.id); if (!ix.idMsg || ix.idMsg < +e.last) ix.idMsg = +e.last || 0; }
    gravar();
  } catch (e) {
    CAD.ok = false; CAD.erro = e.message; console.error('banco', e.message);
  } finally { try { await c.end(); } catch (e) { /* */ } }
  return CAD;
}

// ---------- IXC de mentira ----------
const ASSUNTOS = [
  { id: '990001', assunto: 'Suporte técnico (simulado)' },
  { id: '990002', assunto: 'Ativação de loja (simulado)' },
  { id: '990003', assunto: 'Vistoria (simulado)' },
  { id: '990004', assunto: 'Sem sinal / internet lenta (simulado)' },
];
function emp(id) {
  const x = E.ixc[id] = E.ixc[id] || { chamados: [], clientes: [], mensagens: [], idMsg: 0 };
  return x;
}
function assuntosDe(empresa) {
  const e = CAD.empresas.find(x => x.id === empresa) || {};
  const out = ASSUNTOS.slice();
  if ((e.financeiros || []).length) out.push({ id: String(e.financeiros[0]), assunto: 'Assunto financeiro (o bot ignora)' });
  if ((e.ignorar || []).length) out.push({ id: String(e.ignorar[0]), assunto: 'Assunto automático (o bot ignora)' });
  return out;
}
function campo(o, k) { return o[k] === undefined || o[k] === null ? '' : String(o[k]); }
function compara(v, oper, q) {
  const nv = Number(v), nq = Number(q), num = v !== '' && q !== '' && !isNaN(nv) && !isNaN(nq);
  const a = num ? nv : v, b = num ? nq : q;
  switch (String(oper || '=').toUpperCase()) {
    case '=': return a == b; case '!=': case '<>': return a != b;
    case '>': return a > b; case '>=': return a >= b; case '<': return a < b; case '<=': return a <= b;
    case 'L': return String(v).toLowerCase().includes(String(q).toLowerCase());
    case 'IN': return String(q).split(',').map(s => s.trim()).includes(String(v));
    default: return a == b;
  }
}
function listar(tabela, lista, b) {
  const pref = tabela + '.';
  const k = String(b.qtype || '').replace(pref, '');
  let r = lista.filter(o => !k || compara(campo(o, k), b.oper, String(b.query === undefined ? '' : b.query)));
  let grid = [];
  try { grid = typeof b.grid_param === 'string' ? JSON.parse(b.grid_param || '[]') : (b.grid_param || []); } catch (e) { grid = []; }
  for (const g of grid) { const gk = String(g.TB || '').replace(pref, ''); r = r.filter(o => compara(campo(o, gk), g.OP, String(g.P))); }
  if (b.sortname) {
    const sk = String(b.sortname).replace(pref, ''), desc = String(b.sortorder || '').toLowerCase() === 'desc';
    r = r.slice().sort((x, y) => { const a = campo(x, sk), c = campo(y, sk); const n = !isNaN(+a) && !isNaN(+c) && a !== '' && c !== ''; const d = n ? (+a) - (+c) : a.localeCompare(c); return desc ? -d : d; });
  }
  const rp = Math.max(1, +b.rp || 20), pg = Math.max(1, +b.page || 1);
  const pag = r.slice((pg - 1) * rp, pg * rp);
  return pag.length ? { page: String(pg), total: r.length, registros: pag } : { page: String(pg), total: 0 };
}
function ixcConsulta(empresa, tabela, b) {
  const x = emp(empresa);
  if (tabela === 'su_oss_chamado_mensagem') return listar(tabela, x.mensagens, b);
  if (tabela === 'su_oss_chamado') return listar(tabela, x.chamados, b);
  if (tabela === 'cliente') return listar(tabela, x.clientes, b);
  if (tabela === 'su_oss_assunto') return listar(tabela, assuntosDe(empresa), b);
  return { type: 'error', message: 'tabela não simulada: ' + tabela };
}
function evento(empresa, ch, id_evento, id_tecnico, mensagem) {
  const x = emp(empresa);
  const m = { id: String(++x.idMsg), id_chamado: String(ch.id), id_evento: String(id_evento), id_tecnico: String(id_tecnico || '0'), mensagem: mensagem || '', data: brt(), id_operador: '0' };
  x.mensagens.push(m); if (x.mensagens.length > 2000) x.mensagens = x.mensagens.slice(-2000);
  return m;
}
function nomeTec(empresa, id) {
  if (!id || String(id) === '0') return 'ninguém';
  const t = CAD.tecnicos.find(z => z.empresa === empresa && z.id === String(id)) || CAD.funcionarios.find(z => z.empresa === empresa && z.id === String(id));
  return t ? t.nome : 'id ' + id;
}
function criarChamado(d) {
  const empresa = String(d.empresa || '');
  if (!CAD.empresas.find(e => e.id === empresa)) throw new Error('empresa inválida');
  const x = emp(empresa);
  const loc = CAD.locais.find(l => l.empresa === empresa && l.id === String(d.id_condominio));
  const id = ++E.idCh, idc = ++E.idCli;
  const loja = String(d.loja || '').trim();
  const cli = { id: String(idc), razao: String(d.cliente || 'Cliente Simulado ' + idc).slice(0, 80), fantasia: String(d.fantasia || '').slice(0, 80),
    whatsapp: String(d.telefone || '(41) 90000-0000'), telefone_celular: '', fone: '', telefone_comercial: '',
    id_condominio: loc ? loc.id : '0', complemento: loja ? 'Loja ' + loja : '', apartamento: '' };
  const aberto = Math.max(0, +d.aberto_ha || 0);
  const ch = { id: String(id), protocolo: '2026' + id, id_cliente: cli.id, id_condominio: loc ? loc.id : '0', id_assunto: String(d.id_assunto || ASSUNTOS[0].id),
    id_tecnico: String(d.id_tecnico || '0'), status: 'A', data_abertura: brt(Date.now() - aberto * 60000), data_agenda: '0000-00-00 00:00:00',
    mensagem: String(d.mensagem || 'Chamado de teste do simulador').slice(0, 1000), apartamento: '', complemento: loja ? 'Loja ' + loja : '', id_filial: '1' };
  x.clientes.push(cli); x.chamados.push(ch);
  // Aberto "há X min" = chamado antigo: o evento de abertura já teria sido lido numa rodada anterior (senão o WF 01 trata como
  // "acabou de abrir" e não manda o aviso de sem técnico). Aberto agora = gera o evento 1 (aviso de novo chamado).
  if (!aberto) evento(empresa, ch, 1, ch.id_tecnico, ch.mensagem);
  log('ixc', `${empresa}: chamado ${ch.protocolo} aberto${aberto ? ' há ' + aberto + ' min (sem evento de abertura)' : ''} (${loc ? loc.nome : 'sem shopping'}, técnico: ${nomeTec(empresa, ch.id_tecnico)})`);
  gravar(); return ch;
}
function acaoChamado(d) {
  const empresa = String(d.empresa || ''), x = emp(empresa);
  const ch = x.chamados.find(c => c.id === String(d.id));
  if (!ch) throw new Error('chamado não encontrado');
  const tec = String(d.id_tecnico || '0');
  switch (d.acao) {
    case 'transferir': ch.id_tecnico = tec; evento(empresa, ch, 4, tec, d.texto || 'Transferido (simulador)'); break;
    case 'assumir': ch.id_tecnico = tec; evento(empresa, ch, 8, tec, d.texto || 'Assumido (simulador)'); break;
    case 'mensagem': evento(empresa, ch, String(d.id_evento || '2'), tec, String(d.texto || '')); break;
    case 'agendar': ch.data_agenda = brt(Date.now() + (+d.minutos || 0) * 60000); ch.status = ch.status === 'F' ? 'A' : ch.status; if (tec !== '0' && d.trocar_tecnico) ch.id_tecnico = tec; break;
    case 'desagendar': ch.data_agenda = '0000-00-00 00:00:00'; break;
    case 'envelhecer': ch.data_abertura = brt(Date.now() - (+d.minutos || 0) * 60000); break;
    case 'fechar': ch.status = 'F'; evento(empresa, ch, 3, ch.id_tecnico, 'Finalizado (simulador)'); break;
    case 'reabrir': ch.status = 'A'; break;
    default: throw new Error('ação inválida');
  }
  log('ixc', `${empresa}: chamado ${ch.protocolo} → ${d.acao}${['transferir', 'assumir', 'agendar'].includes(d.acao) ? ' (' + nomeTec(empresa, ch.id_tecnico) + ')' : ''}${d.minutos ? ' ' + d.minutos + ' min' : ''}`);
  gravar(); return ch;
}

// ---------- WAHA de mentira ----------
function wahaEnvio(tipo, b) {
  if (E.wahaFora) return [503, { statusCode: 503, message: 'WAHA simulado fora do ar (opção da tela do simulador)' }];
  const chat = String(b.chatId || '');
  if (!/@(g\.us|c\.us|s\.whatsapp\.net|lid)$/.test(chat)) return [400, { statusCode: 400, message: 'chatId inválido: ' + chat }];
  const id = 'true_' + chat + '_' + idWa();
  const m = { id, chat, de: BOT.fone, nome: BOT.nome, fromMe: true, texto: tipo === 'imagem' ? String(b.caption || '') : String(b.text || ''),
    imagem: tipo === 'imagem' && b.file ? (b.file.data ? 'data:' + (b.file.mimetype || 'image/png') + ';base64,' + b.file.data : (b.file.url || '')) : null,
    mentions: Array.isArray(b.mentions) ? b.mentions.map(String) : [], reply_to: b.reply_to || null, sessao: b.session || '' };
  novaMsg(m);
  chamada({ tipo: 'waha', chat });
  log('waha', `bot → ${chat}: ${m.texto.split('\n')[0]}`);
  return [201, { id, timestamp: Math.floor(m.t / 1000), from: BOT.fone + '@c.us', to: chat, fromMe: true, body: m.texto, _data: { id: { id, fromMe: true, remote: chat } } }];
}
async function postar(url, corpo) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}), signal: ctl.signal });
    const txt = await r.text();
    return { status: r.status, txt: txt.slice(0, 300) };
  } catch (e) { return { status: 0, txt: e.name === 'AbortError' ? 'tempo esgotado' : e.message }; } finally { clearTimeout(t); }
}
async function mensagemDoGrupo(d) {
  const chat = String(d.chat || ''), texto = String(d.texto || '').slice(0, 4000);
  if (!chat || !texto.trim()) throw new Error('escolha a conversa e escreva a mensagem');
  const fromMe = !!d.fromMe;
  const fone = fromMe ? BOT.fone : String(d.fone || '5541900000001').replace(/\D/g, '');
  const id = (fromMe ? 'true_' : 'false_') + chat + '_' + idWa() + (fromMe ? '' : '_' + fone + '@c.us');
  const m = novaMsg({ id, chat, de: fone, nome: fromMe ? BOT.nome : String(d.nome || fone), fromMe, texto, mentions: [], reply_to: d.reply_to || null, usuario: true });
  const payload = { event: 'message.any', session: 'default', me: { id: BOT.fone + '@c.us' }, payload: {
    id, timestamp: Math.floor(m.t / 1000), from: chat, fromMe, to: fromMe ? chat : BOT.fone + '@c.us', participant: chat.endsWith('@g.us') ? fone + '@c.us' : null,
    body: texto, hasMedia: false, ack: 1, _data: { Info: { PushName: fromMe ? '' : String(d.nome || ''), Sender: fone + '@c.us', Chat: chat, IsFromMe: fromMe, IsGroup: chat.endsWith('@g.us') } } } };
  const r = await postar(N8N + '/webhook/sim-ixc-whatsapp', payload);
  m.n8n = r.status;
  if (r.status !== 200) m.n8n_erro = r.status === 404 ? 'o workflow [SIM] 03 não está publicado no n8n de teste' : r.txt;
  log('n8n', `mensagem → WF 03: HTTP ${r.status || 'sem resposta'} ${r.status === 200 ? '' : r.txt}`);
  gravar(); return m;
}
const RODAR = { '01': 'sim-rodar-01', '02': 'sim-rodar-02', '04': 'sim-rodar-04' };
const espera = ms => new Promise(ok => setTimeout(ok, ms));
// 0.1.1: o botão ▶ espera a rodada terminar (3 s sem chamadas novas, até 25 s) e devolve um resumo do que o workflow fez
async function rodar(wf, quieto) {
  if (!RODAR[wf]) throw new Error('workflow inválido');
  const t0 = Date.now();
  const r = await postar(N8N + '/webhook/' + RODAR[wf], { origem: 'simulador' });
  log('n8n', `rodar WF ${wf}: HTTP ${r.status || 'sem resposta'} ${r.status === 200 ? '' : r.txt}`);
  if (r.status !== 200) { r.resumo = r.status === 404 ? `WF ${wf}: o workflow [SIM] ${wf} não está publicado no n8n de teste.` : `WF ${wf}: o n8n não respondeu (${r.status || r.txt}).`; return r; }
  if (quieto) return r;
  for (let i = 0; i < 25; i++) {
    await espera(1000);
    const ult = CHAM.filter(c => c.t >= t0).map(c => c.t);
    const fim = ult.length ? Math.max(...ult) : 0;
    if ((fim && Date.now() - fim > 3000) || (wf === '04' && Date.now() - t0 > 8000 && !fim)) break;
  }
  r.resumo = resumo(wf, CHAM.filter(c => c.t >= t0));
  log('resumo', r.resumo);
  return r;
}
function resumo(wf, cs) {
  const ixc = cs.filter(c => c.tipo === 'ixc'), env = cs.filter(c => c.tipo === 'waha');
  const soma = f => ixc.filter(f).reduce((a, c) => a + c.n, 0);
  const emps = new Set(ixc.map(c => c.emp)).size;
  const msgs = env.length + (env.length === 1 ? ' mensagem enviada' : ' mensagens enviadas') + (env.length ? ' (' + [...new Set(env.map(c => nomeChatSim(c.chat)))].join(', ') + ')' : '');
  if (wf === '01') {
    if (!ixc.length) return 'WF 01 rodou mas não consultou o IXC simulado: veja a execução do [SIM] 01 em Executions no n8n.';
    const ev = soma(c => c.tabela === 'su_oss_chamado_mensagem'), st = soma(c => c.tabela === 'su_oss_chamado' && c.qtype === 'su_oss_chamado.status');
    return `WF 01: ${emps} empresas consultadas · ${ev} evento(s) novo(s) · ${st} chamado(s) sem técnico → ${msgs}.` +
      (!env.length ? (ev || st ? ' Nada a avisar agora (ex.: sem técnico só avisa com 10+ min de aberto; repetido não reenvia).' : ' Nada a avisar: abra um chamado na aba IXC simulado.') : '');
  }
  if (wf === '02') {
    if (!ixc.length) return 'WF 02 rodou mas não consultou o IXC simulado: veja a execução do [SIM] 02 em Executions no n8n.';
    const ag = soma(c => c.tabela === 'su_oss_chamado');
    return `WF 02: ${ag} visita(s) agendada(s) daqui pra frente → ${msgs}.` + (!env.length ? ' O lembrete só sai faltando 40–60 min (1 h) ou 3–10 min (10 min), uma vez por visita: use "Agendar +55 min" ou "+8 min" no chamado.' : '');
  }
  return `WF 04: planilha ESCALAS lida → ${msgs}.` + (!env.length ? ' O 04 só manda mensagem (no grupo de automação) quando a planilha tem alerta (nome não reconhecido, troca); a escala do dia vai para o banco de teste.' : '');
}
function nomeChatSim(jid) { const g = CAD.grupos[jid]; if (g) return g.nomes[0]; const t = CAD.tecnicos.find(x => x.fone && jid.startsWith(String(x.fone).replace(/\D/g, ''))); return t ? 'particular de ' + t.nome : jid; }

// ---------- HTTP ----------
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
function enviar(res, st, obj, tipo) {
  const corpo = typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj);
  res.writeHead(st, { 'Content-Type': tipo || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(corpo);
}
function lerCorpo(req) {
  return new Promise((ok, erro) => {
    let n = 0; const partes = [];
    req.on('data', c => { n += c.length; if (n > 15e6) { erro(new Error('corpo grande demais')); req.destroy(); } else partes.push(c); });
    req.on('end', () => { const s = Buffer.concat(partes).toString('utf8'); if (!s) return ok({}); try { ok(JSON.parse(s)); } catch (e) { ok({ _texto: s }); } });
    req.on('error', erro);
  });
}
function autorizado(req) {
  if (!SENHA) return true;
  const h = String(req.headers.authorization || '');
  if (!h.startsWith('Basic ')) return false;
  const [u, s] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(/:(.*)/s);
  const a = Buffer.from(String(s || '')), b = Buffer.from(SENHA);
  return u === 'sim' && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function estado(desde) {
  const d = +desde || 0;
  const ixc = {};
  for (const [k, v] of Object.entries(E.ixc)) ixc[k] = { chamados: v.chamados.slice(-100).reverse().map(c => {
    const cli = v.clientes.find(x => x.id === c.id_cliente) || {}, loc = CAD.locais.find(l => l.empresa === k && l.id === c.id_condominio);
    return Object.assign({}, c, { cliente: cli.razao, shopping: loc ? loc.nome : '—', tecnico: nomeTec(k, c.id_tecnico), assunto: (assuntosDe(k).find(a => a.id === c.id_assunto) || {}).assunto || c.id_assunto });
  }) };
  return { versao: VERSAO, seq: E.seq, agora: brt(), msgs: E.msgs.filter(m => m.seq > d), ixc, log: LOG.slice(-80), wahaFora: E.wahaFora,
    cad: { ok: CAD.ok, erro: CAD.erro, param: CAD.param, lido: CAD.lido } };
}

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  try {
    // --- chamadas do n8n (rede interna do Docker) ---
    if (p === '/saude' || p === '/api/server/status') return enviar(res, 200, { ok: true, simulador: VERSAO });
    if (req.method === 'POST' && p === '/api/sendText') { const [s, o] = wahaEnvio('texto', await lerCorpo(req)); return enviar(res, s, o); }
    if (req.method === 'POST' && p === '/api/sendImage') { const [s, o] = wahaEnvio('imagem', await lerCorpo(req)); return enviar(res, s, o); }
    if (p === '/api/contacts/check-exists') {
      const f = String(u.searchParams.get('phone') || '').replace(/\D/g, '');
      const existe = f.length >= 12 && !/^5500/.test(f) && !f.endsWith('0000000');
      log('waha', `consulta número ${f}: ${existe ? 'tem' : 'não tem'} WhatsApp`);
      return enviar(res, 200, { numberExists: existe, chatId: existe ? f + '@c.us' : null });
    }
    if (p.startsWith('/api/sessions')) return enviar(res, 200, [{ name: 'default', status: 'WORKING', me: { id: BOT.fone + '@c.us', pushName: 'Simulador' } }]);
    let m = p.match(/^\/ixc\/([^/]+)\/webservice\/v1\/([a-z_]+)$/);
    if (m && req.method === 'POST') {
      const b = await lerCorpo(req); const empresa = decodeURIComponent(m[1]);
      const r = ixcConsulta(empresa, m[2], b);
      chamada({ tipo: 'ixc', emp: empresa, tabela: m[2], qtype: String(b.qtype || ''), n: r.registros ? r.registros.length : 0 });
      if (m[2] !== 'su_oss_assunto' && m[2] !== 'cliente') log('ixc-api', `${empresa} ${m[2]} ${b.qtype || ''} ${b.oper || ''} ${b.query || ''} → ${r.total || 0}`);
      return enviar(res, 200, r);
    }
    if (req.method === 'POST' && p === '/planta') {
      const b = await lerCorpo(req);
      log('planta', `planta pedida: ${b.empresa || ''} condomínio ${b.id_condominio || ''} loja ${b.loja || ''}`);
      if (!PLANTA) return enviar(res, 200, { ok: false, motivo: 'simulador sem imagem de exemplo' });
      return enviar(res, 200, { ok: true, imagem: PLANTA, piso: 'Piso simulado', lojas: [String(b.loja || '?')], shopping: 'exemplo do simulador' });
    }
    // --- tela (com senha) ---
    if (!autorizado(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Simulador whatsapp-ixc", charset="UTF-8"' }); return res.end('senha'); }
    if (req.method === 'GET' && (p === '/' || /^\/[a-z0-9-]+\.(html|js|css|png|svg)$/.test(p))) {
      const f = path.join(PUB, p === '/' ? 'index.html' : p.slice(1));
      if (!fs.existsSync(f)) return enviar(res, 404, 'não encontrado', 'text/plain');
      return enviar(res, 200, fs.readFileSync(f), TIPOS[path.extname(f)]);
    }
    if (p === '/sim/estado') return enviar(res, 200, estado(u.searchParams.get('desde')));
    if (p === '/sim/cadastro') {
      if (u.searchParams.get('recarregar') || !CAD.ok) await lerBanco();
      return enviar(res, CAD.ok ? 200 : 500, Object.assign({}, CAD, { assuntos: Object.fromEntries(CAD.empresas.map(e => [e.id, assuntosDe(e.id)])), bot: BOT }));
    }
    if (req.method === 'POST') {
      const b = await lerCorpo(req);
      if (p === '/sim/enviar') return enviar(res, 200, await mensagemDoGrupo(b));
      if (p === '/sim/chamado') return enviar(res, 200, criarChamado(b));
      if (p === '/sim/acao') return enviar(res, 200, acaoChamado(b));
      if (p === '/sim/rodar') return enviar(res, 200, await rodar(String(b.wf || '')));
      if (p === '/sim/opcoes') { if ('wahaFora' in b) E.wahaFora = !!b.wahaFora; log('sim', 'WAHA simulado ' + (E.wahaFora ? 'FORA do ar' : 'no ar')); gravar(); return enviar(res, 200, { wahaFora: E.wahaFora }); }
      if (p === '/sim/limpar') {
        if (b.o === 'conversas') E.msgs = [];
        else if (b.o === 'chat') E.msgs = E.msgs.filter(x => x.chat !== String(b.chat || ''));
        else if (b.o === 'ixc') { for (const k of Object.keys(E.ixc)) { E.ixc[k].chamados = []; E.ixc[k].clientes = []; E.ixc[k].mensagens = []; } }
        else throw new Error('o que limpar?');
        log('sim', 'limpou ' + b.o); gravar(); return enviar(res, 200, { ok: true });
      }
    }
    return enviar(res, 404, { erro: 'rota não simulada: ' + req.method + ' ' + p });
  } catch (e) {
    return enviar(res, 400, { erro: e.message });
  }
});

if (require.main === module) {
  srv.listen(PORTA, () => console.log(`simulador whatsapp-ixc ${VERSAO} na porta ${PORTA} (n8n: ${N8N})${SENHA ? '' : ' — SEM SENHA'}`));
  lerBanco().then(c => console.log(c.ok ? `banco ok: ${c.empresas.length} empresas, ${c.locais.length} shoppings, ${Object.keys(c.grupos).length} grupos` : 'banco: ' + c.erro));
}
module.exports = { srv, lerBanco, ixcConsulta, criarChamado, acaoChamado, _E: () => E, _CAD: () => CAD, brt };
