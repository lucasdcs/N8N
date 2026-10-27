// Workflow: WhatsApp - Notificacoes de chamados IXC (WAHA)
// No: Processar Eventos

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
  return { grupo, marcar: t && t.fone ? [t.fone] : [], nome: nomePessoa(C, emp, pid), shopping: null };
}
function sqlLit(v) { return v === null || v === undefined ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'"; }
function sqlArr(a) { return 'ARRAY[' + (a || []).map(sqlLit).join(',') + ']::text[]'; }

// Pedido de infra escrito numa mensagem de O.S. -> grupo do responsável pela infra (setor de infra), mesmo sem transferir (regra de 28/09/2026).
// Frases de intencao (necessario/sem/encaminhar pra/vistoria de infra...); ignora texto automatico "Processo:" e negacoes.
const RX_INFRA = (() => {
  const I = 'infra(?:[\\s-]?estrutura)?';
  return new RegExp([
    'necess\\S*\\s+(?:d[aeo]\\s+|a\\s+realiza\\S*\\s+de\\s+|realizar\\s+|fazer\\s+)?(?:uma\\s+|a\\s+)?' + I,
    'precis\\S*\\s+(?:d[aeo]\\s+)?(?:uma\\s+|a\\s+)?' + I,
    '(?:sem|n[ãa]o\\s+(?:tem|t[eê]m|possui|h[aá]|existe|teria))\\s+(?:nenhuma\\s+)?' + I + '(?!\\s+de\\s+rede)',
    '(?:encaminh|pass|repass|envi|transfer|direcion|mand)\\S*\\s+(?:\\S+\\s+){0,4}(?:pra|para|[àa]|ao)\\s+(?:a\\s+|equipe\\s+(?:de\\s+)?|setor\\s+de\\s+)?' + I,
    '(?:tratar|falar|verificar|alinhar|acionar)\\s+com\\s+(?:a\\s+)?(?:equipe\\s+(?:de\\s+)?)?' + I,
    '(?:verificar|ver|checar)\\s+se\\s+(?:\\S+\\s+){0,3}tem\\s+' + I,
    '(?:vistoria|visita|pend[eê]ncia|pendente|servi[çc]o|execu[çc][ãa]o)\\s+de\\s+' + I,
    'setor\\s+de\\s+' + I,
    'aguardando\\s+(?:a\\s+)?' + I,
  ].join('|'), 'i');
})();
const RX_INFRA_NAO = /n[ãa]o\s+(?:necessita|precisa|iremos\s+encaminhar|vamos\s+encaminhar|h[aá]\s+necessidade)|^\s*Processo:/i;
function pedeInfra(txt) { const t = String(txt || ''); return RX_INFRA.test(t) && !RX_INFRA_NAO.test(t); }

// Junta os eventos novos de todas as empresas e cria eventos sinteticos 'SEMTEC' para chamado aberto sem ninguem:
// 1o aviso apos semtec_min; re-alerta a cada realerta_min so entre realerta_ini e realerta_fim (BRT);
// a partir de escalar_min aberto, marca tambem a coordenacao (regra de 27/09/2026).
const C = carregarConfig(), P = C.param;
const emps = $('Empresas').all().map(x => x.json);
const novas = $('Buscar Novas Mensagens').all();
const sems = $input.all();
const NOTIFICA = ['1', '4', '8'];
const st = $getWorkflowStaticData('global');
st.semtec = st.semtec || {};
const agoraMs = paraData(agoraBRT());
for (const k of Object.keys(st.semtec)) if (agoraMs - st.semtec[k].ultimo > 3 * 86400000) delete st.semtec[k];
st.infra = st.infra || {};
for (const k of Object.keys(st.infra)) if (agoraMs - st.infra[k] > 86400000) delete st.infra[k];
const semtecMin = +P.semtec_min || 10, realertaMin = +P.realerta_min || 120, escalarMin = +P.escalar_min || 240;
const minDia = Math.floor(agoraMs / 60000) % 1440;
const naDia = !String(P.realerta_pular_dias == null ? '0' : P.realerta_pular_dias).split(',').includes(String(new Date(agoraMs).getUTCDay())); // 0 = domingo (regra de 27/09)
const naJanela = minDia >= (+P.realerta_ini || 10) * 60 && minDia <= (+P.realerta_fim || 22) * 60 && naDia;
// Re-alerta em horarios fixos (param realerta_horarios, ex. '11:00,15:30' — regra de 28/09); vazio = a cada realerta_min.
// Sai uma vez por horario, ate 30 min depois dele, e so se o ultimo aviso do chamado foi mais de 1h antes.
const HORARIOS = String(P.realerta_horarios || '').split(',').map(s => s.trim()).filter(Boolean)
  .map(h => { const [a, b] = h.split(':').map(Number); return a * 60 + (b || 0); });
const inicioDiaMs = agoraMs - minDia * 60000;
function horaDeRealertar(ultimo) {
  return HORARIOS.some(h => { const hm = inicioDiaMs + h * 60000; return agoraMs >= hm && agoraMs - hm < 30 * 60000 && ultimo < hm - 60 * 60000; });
}
const out = [];
emps.forEach((e, k) => {
  const r = unwrap(novas[k] && novas[k].json);
  for (const m of (r.registros || [])) {
    if (NOTIFICA.includes(String(m.id_evento))) out.push({ json: Object.assign({}, m, { empresa: e.empresa }) });
    if (pedeInfra(m.mensagem) && String(m.id_tecnico || '0') !== String((C.empresas[e.empresa] || {}).dono_id || '')) {
      const ki = e.empresa + ':' + m.id_chamado, ult = st.infra[ki] || 0;
      if (agoraMs - ult < 6 * 3600000) continue; // 1 aviso de infra por chamado a cada 6h
      st.infra[ki] = agoraMs;
      out.push({ json: Object.assign({}, m, { empresa: e.empresa, id_evento: 'INFRA', autor: String(m.id_tecnico || '0') }) });
    }
  }
  const s = unwrap(sems[k] && sems[k].json);
  for (const c of (s.registros || [])) {
    if (String(c.id_tecnico || '0') !== '0' || c.status !== 'A') continue;
    if (!c.data_abertura || c.data_abertura.startsWith('0000')) continue;
    const idade = (agoraMs - paraData(c.data_abertura)) / 60000;
    const key = e.empresa + ':' + c.id, ent = st.semtec[key];
    const base = { id: null, id_chamado: c.id, id_evento: 'SEMTEC', id_tecnico: '0', mensagem: c.mensagem || '', empresa: e.empresa, idade_min: Math.round(idade) };
    if (ent) {
      if (HORARIOS.length ? !(naDia && horaDeRealertar(ent.ultimo)) : (!naJanela || agoraMs - ent.ultimo < realertaMin * 60000 - 90000)) continue;
      ent.ultimo = agoraMs;
      out.push({ json: Object.assign(base, { realerta: true, escalar: idade >= escalarMin }) });
    } else if (idade >= semtecMin && idade <= 120) {
      st.semtec[key] = { ultimo: agoraMs };
      out.push({ json: Object.assign(base, { realerta: false, escalar: false }) });
    }
  }
});
return out;

