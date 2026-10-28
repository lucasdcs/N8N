// Workflow: WhatsApp - Lembretes de visita IXC (WAHA)
// No: Montar Lembrete

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

// Numero da loja: 1o campo preenchido entre apartamento/complemento do chamado e do cliente (regra de 28/09/2026)
function numeroLoja(c, cli) {
  for (const v of [(c || {}).apartamento, (c || {}).complemento, (cli || {}).apartamento, (cli || {}).complemento]) {
    const s = String(v || '').replace(/\s+/g, ' ').trim();
    if (!/\d/.test(s) && !/^(lojas?|lj)\b/i.test(s)) continue;
    let n = s.replace(/^(lojas?|lj|luc)\b\s*[:.\-nº°]*\s*/i, '').replace(/^(lojas?|lj)(?=\d)/i, '');
    if (!n) continue;
    if (n.length > 30) n = n.slice(0, 30).replace(/\s+\S*$/, '');
    return /^\d/.test(n) || s !== n ? 'Loja ' + n : n;
  }
  return '';
}

const PLANTA_ATIVA = String(carregarConfig().param.planta_ativo || 'nao').trim().toLowerCase() !== 'nao';
const items = $input.all();
const out = [];
for (let i = 0; i < items.length; i++) {
  const d = $('Rotear Lembrete').itemMatching(i).json;
  const a = unwrap(items[i].json);
  const assunto = (a.registros && a.registros[0] && a.registros[0].assunto) || '';
  const c = d.chamado, cli = d.cliente || {};
  const hora = c.data_agenda.slice(11, 16);
  const fim = (c.data_agenda_final && !c.data_agenda_final.startsWith('0000')) ? c.data_agenda_final.slice(11, 16) : '';
  const marcar = d.marcar || [];
  const quem = marcar.length ? marcar.map(f => '@' + f).join(' ') : (d.nome ? '*' + d.nome + '*' : '');
  const nomeCliente = (cli.razao || '').trim(), nomeLoja = (cli.fantasia || '').trim();
  const fone = [cli.whatsapp, cli.telefone_celular, cli.fone, cli.telefone_comercial]
    .map(f => (f || '').trim()).find(f => f.replace(/\D/g, '').length >= 8) || '';
  const numLoja = numeroLoja(c, cli);
  const local = (numLoja ? (c.referencia || '') : (c.complemento || c.referencia || '')).trim();
  // Lembrete curto (10 min antes): uma linha, sem planta (a planta ja foi no de 1h). Regra de 28/10/2026 (0.2.0).
  if (d.tipo === 'lembrete_10min') {
    const quemVisita = nomeLoja || nomeCliente;
    const onde = [d.shopping, numLoja].filter(Boolean).join(', ');
    const n = d.faltam || 10;
    let curto = '⏰ Não esqueça: visita' + (quemVisita ? ' na *' + quemVisita + '*' : ' do chamado #' + c.protocolo) + (onde ? ' (' + onde + ')' : '')
      + ' daqui ' + n + (n === 1 ? ' minuto' : ' minutos') + ', às ' + hora + '.';
    if (quem) curto += '\n' + quem + (d.sem_tecnico ? ' · sem técnico atribuído' : '');
    out.push({ pairedItem: { item: i }, json: { empresa: d.empresa, tipo: d.tipo, id_chamado: c.id, protocolo: c.protocolo, evento: c.data_agenda,
      texto: curto, grupo_jid: d.grupo_jid, mentioned: marcar, planta: null } });
    continue;
  }
  // Lembrete de 1h: pede a planta (servico planta-loja) quando ha numero de loja e shopping; desligar: planta_ativo = 'nao'
  const idCond = String(c.id_condominio || '0') !== '0' ? String(c.id_condominio) : String(cli.id_condominio || '0');
  const planta = (PLANTA_ATIVA && /\d/.test(numLoja) && idCond !== '0')
    ? { empresa: d.empresa, id_condominio: idCond, loja: numLoja.replace(/^Loja\s+/i, ''), nome: nomeLoja || nomeCliente }
    : null;
  let texto = '⏰ *Lembrete de visita — ' + d.janela + '*' + (quem ? ' — ' + quem : '');
  if (d.sem_tecnico) texto += '\n🏢 ' + (d.shopping || 'Local não identificado') + ' · sem técnico atribuído';
  else if (d.shopping) texto += '\n🏢 ' + d.shopping;
  texto += '\n🕐 Visita às *' + hora + '*' + (fim && fim !== hora ? ' (até ' + fim + ')' : '');
  texto += '\n🎫 #' + c.protocolo + (assunto ? ' · ' + assunto : '');
  if (nomeCliente) texto += '\n👤 ' + nomeCliente;
  const outroNome = nomeLoja && nomeLoja.toLowerCase() !== nomeCliente.toLowerCase();
  if (numLoja) texto += '\n🏬 ' + numLoja + (outroNome ? ' · ' + nomeLoja : '');
  else if (outroNome) texto += '\n🏬 Loja: ' + nomeLoja;
  if (local) texto += '\n📍 ' + local;
  if (fone) texto += '\n📞 ' + fone;
  out.push({ pairedItem: { item: i }, json: { empresa: d.empresa, tipo: d.tipo, id_chamado: c.id, protocolo: c.protocolo, evento: c.data_agenda,
    texto, grupo_jid: d.grupo_jid, mentioned: marcar, planta } });
}
// Modo de envio (ixc.parametros.envio): NENHUM = nao manda (e nao grava: o lembrete sai quando o modo mudar, se ainda estiver na janela);
// SIMULAR = manda para envio_teste_para com o grupo de destino no cabecalho; REAL = manda para os grupos.
const PARAM = carregarConfig().param || {};
const ENVIO = String(PARAM.envio || 'NENHUM').trim().toUpperCase();
const TESTE = String(PARAM.envio_teste_para || '').replace(/\D/g, '');
if (ENVIO === 'NENHUM') return [];
if (ENVIO !== 'REAL' && !TESTE) throw new Error('parametro envio=' + ENVIO + ' exige envio_teste_para');
if (ENVIO !== 'REAL') for (const o of out) { o.json.chat_envio = TESTE + '@c.us'; o.json.texto = '🧪 SIMULAÇÃO → ' + o.json.grupo_jid + '\n' + o.json.texto; o.json.simulado = true; }
return out;

