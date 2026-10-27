// Workflow: WhatsApp - Notificacoes de chamados IXC (WAHA)
// No: Rotear

function unwrap(x) {
  if (x && typeof x === 'object' && typeof x.data === 'string') {
    try { return JSON.parse(x.data); } catch (e) { return x; }
  }
  return x || {};
}
function paraData(s) { // 'YYYY-MM-DD HH:MM:SS' (horario de Brasilia) -> ms (tratado como UTC, so pra comparar)
  const [d, h] = s.split(' '); const [Y, M, D] = d.split('-').map(Number); const [hh, mm, ss] = (h || '0:0:0').split(':').map(Number);
  return Date.UTC(Y, M - 1, D, hh, mm, ss || 0);
}
function agoraBRT() { return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }); }
function carregarConfig() {
  let c = $('Carregar Config').first().json.cfg;
  if (typeof c === 'string') c = JSON.parse(c);
  const idx = (lst, f) => Object.fromEntries((lst || []).map(x => [x.empresa + ':' + x[f], x]));
  return {
    empresas: Object.fromEntries((c.empresas || []).map(e => [e.id, e])),
    tec: idx(c.tecnicos, 'id_func'), loc: idx(c.locais, 'id_condominio'), func: idx(c.funcionarios, 'id_func'),
    param: c.param || {}, pendentes: c.pendentes || [], lembretes: c.lembretes || [],
  };
}
// Regras de roteamento (iguais para todas as empresas; mapas no Postgres, schema ixc)
function localDe(C, emp, chamado, cliente) {
  const id = String(chamado.id_condominio || '0') !== '0' ? String(chamado.id_condominio) : String((cliente || {}).id_condominio || '0');
  return C.loc[emp + ':' + id] || null;
}
function nomePessoa(C, emp, pid) {
  const t = C.tec[emp + ':' + pid]; if (t) return t.nome;
  const f = C.func[emp + ':' + pid]; return f ? f.nome : ('técnico id ' + pid);
}
// Sem ninguem atribuido: grupo do shopping marcando quem esta em marcar_sem_tec (+ coordenacao se escalar)
function rotaSemTecnico(C, emp, loc, escalar) {
  const P = C.param, E = C.empresas[emp] || {};
  if (loc) {
    const marcar = [...(loc.marcar_sem_tec || [])];
    if (escalar) for (const f of (loc.marcar_escalar || [])) if (!marcar.includes(f)) marcar.push(f);
    return { grupo: loc.grupo, marcar, shopping: loc.nome };
  }
  if (!E.semtec_sem_local) return null;
  const marcar = [P.supervisor_fone];
  if (escalar && P.coordenador_fone && !marcar.includes(P.coordenador_fone)) marcar.push(P.coordenador_fone);
  return { grupo: P.grupo_sem_local, marcar, shopping: 'Local não identificado' };
}
// Pessoa atribuida (pid): dono do numero -> grupo dele; senao grupo do shopping (ou do tecnico) marcando a pessoa
function rotaPessoa(C, emp, loc, pid) {
  const P = C.param, E = C.empresas[emp] || {};
  if (E.dono_id && pid === String(E.dono_id)) return { grupo: P.grupo_dono, marcar: [], nome: P.dono_nome, shopping: loc ? loc.nome : null };
  const t = C.tec[emp + ':' + pid];
  const grupo = loc ? loc.grupo : (t ? t.grupo : null);
  if (!grupo) return null;
  return { grupo, marcar: t && t.fone ? [t.fone] : [], nome: nomePessoa(C, emp, pid), shopping: loc ? loc.nome : null }; // shopping sempre: tudo no grupo Resolutto Tecnicos (regra de 29/09/2026)
}
function sqlLit(v) { return v === null || v === undefined ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'"; }
function sqlArr(a) { return 'ARRAY[' + (a || []).map(sqlLit).join(',') + ']::text[]'; }

// Feriados (ixc.feriados): re-alerta nao sai, igual domingo (regra de 27/09/2026)
let CFGRAW = $('Carregar Config').first().json.cfg; if (typeof CFGRAW === 'string') CFGRAW = JSON.parse(CFGRAW);
const FERIADOS = CFGRAW.feriados_hoje || [];
function feriadoHoje(emp, loc) {
  return FERIADOS.some(f => (!f.empresa || f.empresa === emp) && (!f.id_condominio || (loc && String(f.id_condominio) === String(loc.id_condominio))));
}
// Plantão do dia (ixc.escala_dia, planilha ESCALAS aba HOJE): quem está escalado no shopping hoje (regra de 29/09/2026)
function normTxt(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
const PALAVRAS_GENERICAS = new Set(['shopping', 'outlet', 'plaza', 'mall', 'open', 'patio', 'catuai', 'palladium', 'center', 'centro', 'park', 'boulevard', 'ifashion']);
function plantaoHoje(C, ESCALA, emp, loc) {
  if (!loc) return null;
  const linhas = ESCALA.filter(x => x.empresa === emp && String(x.id_condominio) === String(loc.id_condominio));
  if (!linhas.length) return null;
  const chaves = normTxt(loc.nome).split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !PALAVRAS_GENERICAS.has(w));
  // "Fulano em Porto Belo e Beltrano em Tijucas" -> só a parte deste shopping
  let partes = linhas.flatMap(x => String(x.tecnico).split(/\s+e\s+|[,;/]/)).map(s => s.trim()).filter(Boolean);
  const doLocal = partes.filter(p => chaves.some(k => normTxt(p).includes(k)));
  if (doLocal.length) partes = doLocal;
  const nomes = partes.map(p => p.replace(/\s+(em|no|na|do|da)\s+.*$/i, '').trim()).filter(Boolean);
  const texto = ' ' + normTxt(nomes.join(' ')).replace(/[^a-z0-9]+/g, ' ') + ' ';
  const tem = (w) => w && texto.includes(' ' + w + ' ');
  // técnico cadastrado cujo 1º nome aparece; se dois tiverem o mesmo 1º nome, desempata pelo 2º (senão não marca ninguém)
  const porPrimeiro = {};
  for (const t of Object.values(C.tec).filter(t => t.empresa === emp)) {
    const [p1, p2] = normTxt(t.nome).split(/\s+/);
    if (tem(p1)) (porPrimeiro[p1] = porPrimeiro[p1] || []).push({ t, p2 });
  }
  const tecs = [];
  for (const cands of Object.values(porPrimeiro)) {
    if (cands.length === 1) tecs.push(cands[0].t);
    else { const f = cands.filter(c => tem(c.p2)); if (f.length === 1) tecs.push(f[0].t); }
  }
  return { nomes, texto, tecs, tem };
}

const ESCALA_HOJE = CFGRAW.escala_hoje || [];

// 1 mensagem por chamado por checagem (estado final). Grupo = shopping (condominio do chamado ou do cliente).
const C = carregarConfig();
const agoraMs = paraData(agoraBRT());
const items = $input.all();
const porChamado = new Map();
const out = [];
for (let i = 0; i < items.length; i++) {
  const ev = $('Processar Eventos').itemMatching(i).json;
  const emp = ev.empresa, tipo = String(ev.id_evento);
  const ch = unwrap($('Buscar Chamado').itemMatching(i).json);
  const chamado = (ch.registros && ch.registros[0]) || {};
  if (!chamado.id) {
    out.push({ pairedItem: { item: i }, json: { ignorado: true, empresa: emp, id_chamado: ev.id_chamado, protocolo: null, evento: tipo, motivo: 'falha ao consultar o chamado no IXC' } });
    continue;
  }
  const cr = unwrap(items[i].json);
  const cliente = (cr.registros && cr.registros[0]) || {};
  const key = emp + ':' + chamado.id + (tipo === 'INFRA' ? ':INFRA' : ''); // aviso de infra e separado do aviso normal
  const e = porChamado.get(key) || { novo: false };
  if (tipo === '1') { e.novo = true; e.textoAbertura = ev.mensagem; }
  if (!(e.ev && e.ev !== 'SEMTEC' && tipo === 'SEMTEC')) { e.i = i; e.msg = ev; e.ev = tipo; }
  e.chamado = chamado; e.cliente = cliente; e.emp = emp;
  porChamado.set(key, e);
}
for (const e of porChamado.values()) {
  const { msg, chamado, cliente, ev, emp } = e;
  const E = C.empresas[emp] || {};
  const base = { empresa: emp, id_chamado: chamado.id, protocolo: chamado.protocolo, evento: ev };
  if ((E.ignorar_assuntos || []).includes(String(chamado.id_assunto))) {
    out.push({ pairedItem: { item: e.i }, json: Object.assign(base, { ignorado: true, motivo: 'assunto automático' }) });
    continue;
  }
  if ((E.assuntos_financeiros || []).includes(String(chamado.id_assunto))) {
    out.push({ pairedItem: { item: e.i }, json: Object.assign(base, { ignorado: true, motivo: 'assunto financeiro' }) });
    continue;
  }
  const loc = localDe(C, emp, chamado, cliente);
  const tecChamado = String(chamado.id_tecnico || '0') !== '0' ? String(chamado.id_tecnico) : null;
  const tecEvento = String(msg.id_tecnico || '0') !== '0' ? String(msg.id_tecnico) : null;
  let rota, emoji, label, semTec = false, folga = null;
  if (ev === 'INFRA') {
    if (tecChamado && tecChamado === String(E.dono_id)) continue; // ja esta com o responsável pela infra: o aviso normal cobre
    emoji = '🏗️'; label = 'Pedido de infra' + (msg.autor && msg.autor !== '0' ? ' — ' + nomePessoa(C, emp, msg.autor) : '');
    rota = { grupo: C.param.grupo_dono, marcar: [], nome: null, shopping: loc ? loc.nome : 'Local não identificado' };
  } else if (ev === 'SEMTEC') {
    if (tecChamado || e.novo) continue; // alguem assumiu / acabou de abrir
    rota = rotaSemTecnico(C, emp, loc, msg.escalar);
    if (!rota) { out.push({ pairedItem: { item: e.i }, json: Object.assign(base, { ignorado: true, motivo: 'sem técnico e sem shopping mapeado' }) }); continue; }
    semTec = true;
    if (msg.realerta && C.param.feriados_ativo === 'sim' && feriadoHoje(emp, loc)) continue; // desligado por hora (regra de 27/09)
    if (msg.realerta) {
      const h = Math.floor((msg.idade_min || 0) / 60);
      const t = h >= 24 ? Math.floor(h / 24) + 'd ' + (h % 24) + 'h' : h + 'h';
      emoji = msg.escalar ? '🚨' : '⚠️'; label = 'Chamado segue sem técnico há ' + t + (msg.escalar ? ' (escalado)' : '');
    } else { emoji = '⚠️'; label = 'Chamado sem técnico há 10+ min'; }
  } else {
    const pid = tecEvento || tecChamado;
    if (!pid) continue; // aberto sem ninguem: espera o aviso SEMTEC
    const idade = chamado.data_abertura ? (agoraMs - paraData(chamado.data_abertura)) / 60000 : 9999;
    if (e.novo || (ev === '4' && idade < 15)) { emoji = '🆕'; label = 'Novo chamado'; }
    else if (ev === '4') { emoji = '📨'; label = 'Chamado transferido'; }
    else { emoji = '👤'; label = 'Chamado assumido'; }
    // Auditoria do __NOME__ Del Corsi nao notifica (regra de 02/10/2026); se ele transferir pra outra pessoa, avisa normal
    const txtCh = [e.textoAbertura, msg.mensagem, chamado.mensagem].filter(Boolean).join(' ');
    if (/del\s+corsi/i.test(nomePessoa(C, emp, pid)) && /auditoria/i.test(txtCh)) {
      out.push({ pairedItem: { item: e.i }, json: Object.assign(base, { ignorado: true, motivo: 'auditoria do __NOME__ Del Corsi' }) });
      continue;
    }
    rota = rotaPessoa(C, emp, loc, pid);
    if (!rota) { out.push({ pairedItem: { item: e.i }, json: Object.assign(base, { ignorado: true, motivo: 'sem shopping mapeado e pessoa fora do mapa (' + nomePessoa(C, emp, pid) + ')' }) }); continue; }
    // Técnico de campo atribuído mas fora da escala de hoje no shopping: marca também quem está de plantão (regra de 29/09/2026)
    const tAtrib = C.tec[emp + ':' + pid];
    if (tAtrib && loc && rota.grupo === loc.grupo) {
      const pl = plantaoHoje(C, ESCALA_HOJE, emp, loc);
      if (pl && pl.nomes.length && !pl.tem(normTxt(tAtrib.nome).split(/\s+/)[0])) {
        rota.marcar = [...rota.marcar];
        for (const t of pl.tecs) if (t.fone && !rota.marcar.includes(t.fone)) rota.marcar.push(t.fone);
        folga = tAtrib.nome + ' está de folga hoje — plantão no ' + loc.nome + ': ' + pl.nomes.join(' e ');
      }
    }
  }
  out.push({ pairedItem: { item: e.i }, json: Object.assign(base, {
    ignorado: false, chamado, cliente, mensagem: (e.novo && e.textoAbertura) || msg.mensagem || '', grupo_jid: rota.grupo, marcar: rota.marcar,
    nome: rota.nome || null, shopping: rota.shopping, sem_tecnico: semTec, evento_emoji: emoji, evento_label: label, folga,
    primeira: !!(e.novo || (ev === 'SEMTEC' && !msg.realerta)), // 1a notificacao do chamado (planta da loja, regra de 29/09/2026)
  }) });
}
return out;

