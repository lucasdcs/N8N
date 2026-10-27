// Workflow: WhatsApp - Notificacoes de chamados IXC (WAHA)
// No: Empresas

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

// Uma linha por IXC ativo (tabela ixc.empresas). O token fica no banco, nao no workflow.
const C = carregarConfig();
return Object.values(C.empresas).map(e => ({ json: { empresa: e.id, base: e.base_url, auth: e.auth, last: e.last_evento_id } }));

