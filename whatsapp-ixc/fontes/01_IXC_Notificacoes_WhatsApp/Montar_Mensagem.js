// Workflow: WhatsApp - Notificacoes de chamados IXC (WAHA)
// No: Montar Mensagem

// 0.3.0 (Painel do Bot): textos editaveis em ixc.mensagens; sem texto editado usa o padrao embutido na chamada.
const MSG_ = (() => { try { let c = $('Carregar Config').first().json.cfg; if (typeof c === 'string') c = JSON.parse(c); return (c && c.mensagens) || {}; } catch (e) { return {}; } })();
const OFF_ = Object.keys(MSG_).some(k => MSG_[k] === null);  // 0.5.0: alguma mensagem desativada no Painel do Bot
function M(chave, padrao, v) {
  if (MSG_[chave] === null) return '';  // 0.5.0: desativada no Painel do Bot
  // 0.6.3: variavel do bot desativada no painel (vsys.<nome>) = vazia em todas as mensagens
  if (v) { const v2_ = {}; for (const k of Object.keys(v)) v2_[k] = MSG_['vsys.' + k] === null ? '' : v[k]; v = v2_; }
  const t = typeof MSG_[chave] === 'string' && MSG_[chave].trim() ? MSG_[chave] : padrao;
  if (!v) return t;
  const vazio = k => v[k] === null || v[k] === undefined || String(v[k]) === '';
  return t.split('\n').map(l => {
    const ks = [...l.matchAll(/\{([a-z_]+)\}/g)].map(m => m[1]).filter(k => k in v);
    const vz = ks.filter(vazio);
    // linha so com variaveis vazias (e emoji/pontuacao): some
    if (ks.length && vz.length === ks.length && !/[\p{L}\p{N}]/u.test(l.replace(/\{[a-z_]+\}/g, ''))) return null;
    const s = l.replace(/\{([a-z_]+)\}/g, (x, k) => (k in v ? (vazio(k) ? '' : String(v[k])) : x));
    return vz.length ? s.replace(/[\s—·:-]+$/u, '') : s;
  }).filter(l => l !== null).join('\n');
}
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

function resumir(texto, limite) {
  if (!texto) return '';
  let t = texto.trim().replace(/\s+/g, ' ');
  t = t.replace(/^(prezados?|ol[aá]|bom dia|boa tarde|boa noite)[,.\s]*/i, '');
  if (t.length <= limite) return t;
  const corte = t.slice(0, limite);
  const fim = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('! '), corte.lastIndexOf('? '));
  if (fim > limite * 0.4) return corte.slice(0, fim + 1);
  const esp = corte.lastIndexOf(' ');
  return corte.slice(0, esp > 0 ? esp : limite) + '...';
}
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

const items = $input.all();
const out = [];
// Planta da loja (servico planta-loja no CT100): Ativacao/Vistoria ABERTA (1a notificacao) ou TRANSFERIDA, com numero de loja (regra de 02/10/2026; assumido/re-alerta nao).
// Busca SO pelo numero; numero nao achado/repetido = sai sem imagem. Desligar: parametro planta_ativo='nao' (regra de 29/09/2026)
const C0 = carregarConfig();
const RX_PLANTA = new RegExp(C0.param.planta_assuntos || '^\\s*(ativa[çc][ãa]o|vistoria)', 'i');
const stP = $getWorkflowStaticData('global');
stP.planta = stP.planta || {};
for (const k of Object.keys(stP.planta)) if (Date.now() - stP.planta[k] > 30 * 86400000) delete stP.planta[k];
for (let i = 0; i < items.length; i++) {
  const d = $('Rotear').itemMatching(i).json;
  const a = unwrap(items[i].json);
  const assunto = (a.registros && a.registros[0] && a.registros[0].assunto) || 'nao informado';
  const marcar = d.marcar || [];
  const quem = marcar.length ? marcar.map(f => '@' + f).join(' ') : (d.nome ? '*' + d.nome + '*' : '');
  // 0.3.0: cabecalho, folga e linhas do chamado pelas mensagens do Painel do Bot (aviso.*); linha vazia some
  const AV = { 'aviso.novo': '🆕 Novo chamado — {marcados}', 'aviso.transferido': '📨 Chamado transferido — {marcados}', 'aviso.assumido': '👤 Chamado assumido — {marcados}',
    'aviso.sem_tecnico': '⚠️ Chamado sem técnico há 10+ min — {marcados}', 'aviso.segue_sem_tecnico': '⚠️ Chamado segue sem técnico há {tempo} — {marcados}',
    'aviso.escalado': '🚨 Chamado segue sem técnico há {tempo} (escalado) — {marcados}' };
  let texto = AV[d.evento_chave] ? M(d.evento_chave, AV[d.evento_chave], { marcados: quem, tempo: d.tempo || '' })
    : d.evento_emoji + ' ' + d.evento_label + (quem ? ' — ' + quem : '');   // pedido de infra: fixo
  if (d.folga) texto += '\n' + (d.folga_v ? M('aviso.folga', '⚠️ {tecnico} está de folga hoje — plantão no {shopping}: {plantao}', d.folga_v) : '⚠️ ' + d.folga);
  const cli = d.cliente || {};
  const nomeCliente = (cli.razao || '').trim(), nomeLoja = (cli.fantasia || '').trim();
  const fone = [cli.whatsapp, cli.telefone_celular, cli.fone, cli.telefone_comercial]
    .map(f => (f || '').trim()).find(f => f.replace(/\D/g, '').length >= 8) || '';
  const numLoja = numeroLoja(d.chamado, cli), outroNome = nomeLoja && nomeLoja.toLowerCase() !== nomeCliente.toLowerCase();
  const resumo = resumir(d.mensagem, 150);
  texto += '\n' + M('aviso.corpo', '🎫 #{protocolo} · {assunto}\n🏢 {shopping}\n👤 {cliente}\n🏬 {loja}\n📞 {telefone}\n💬 {resumo}', {
    protocolo: d.chamado.protocolo, assunto,
    shopping: d.sem_tecnico ? M('aviso.sem_tecnico_linha', '{shopping} · sem técnico atribuído', { shopping: d.shopping || 'Local não identificado' }) : (d.shopping || ''),
    cliente: nomeCliente, loja: numLoja ? numLoja + (outroNome ? ' · ' + nomeLoja : '') : (outroNome ? 'Loja: ' + nomeLoja : ''),
    telefone: fone, resumo: resumo || '' });
  let planta = null;
  if (C0.param.planta_ativo !== 'nao' && (d.primeira || String(d.evento) === '4') && RX_PLANTA.test(assunto) && /\d/.test(numLoja)) {
    const loc = localDe(C0, d.empresa, d.chamado, cli), kp = d.empresa + ':' + d.id_chamado;
    if (loc) {
      stP.planta[kp] = Date.now();
      planta = { empresa: d.empresa, id_condominio: loc.id_condominio, loja: numLoja.replace(/^Loja\s+/i, '') };
    }
  }
  if (OFF_) texto = texto.split('\n').filter(l => l.trim()).join('\n');  // 0.5.0: trecho desativado nao deixa linha em branco
  out.push({ pairedItem: { item: i }, json: { empresa: d.empresa, id_chamado: d.id_chamado, protocolo: d.chamado.protocolo, evento: d.evento, texto, grupo_jid: d.grupo_jid, mentioned: marcar, planta } });
}
return out;

