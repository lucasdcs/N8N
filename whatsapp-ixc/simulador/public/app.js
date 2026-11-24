// Tela do simulador whatsapp-ixc (sem dependências).
'use strict';
const $ = s => document.querySelector(s);
const S = { cad: null, msgs: [], seq: 0, chat: null, ixc: {}, lidos: {}, resp: null, busca: '' };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
async function api(url, corpo) {
  const r = await fetch(url, corpo === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || ('HTTP ' + r.status));
  return j;
}
function toast(t, erro) { const a = $('#aviso'); a.textContent = t; a.className = 'toast' + (erro ? ' erro' : ''); a.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { a.hidden = true; }, 4000); }
const digitos = s => String(s || '').replace(/\D/g, '');

// ---------- nomes ----------
function pessoaPorFone(f) {
  f = digitos(f); if (!f || !S.cad) return null;
  if (f === digitos(S.cad.bot.fone)) return S.cad.bot.nome;
  const t = S.cad.tecnicos.find(x => digitos(x.fone) && (digitos(x.fone) === f || digitos(x.fone).slice(-8) === f.slice(-8)));
  return t ? t.nome : null;
}
function nomeChat(jid) {
  const g = S.cad && S.cad.grupos[jid];
  if (g) return g.nomes.join(' · ');
  if (/@c\.us$/.test(jid)) { const n = pessoaPorFone(jid); return '👤 Particular: ' + (n || jid.split('@')[0]); }
  return jid;
}
function tipoChat(jid) { const g = S.cad && S.cad.grupos[jid]; return g ? g.tipo : (/@c\.us$/.test(jid) ? 'privado' : 'outro'); }

// ---------- formatação estilo WhatsApp ----------
function formatar(m) {
  let t = esc(m.texto);
  t = t.replace(/@(\d{8,15})/g, (x, f) => { const n = pessoaPorFone(f); return '<span class="mencao" title="@' + f + '">@' + esc(n || f) + '</span>'; });
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:]|$)/g, '$1<b>$2</b>').replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:]|$)/g, '$1<i>$2</i>').replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?:]|$)/g, '$1<s>$2</s>');
  return t.replace(/\n/g, '<br>');
}
function hora(t) { return new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

// ---------- lista de conversas ----------
function chats() {
  const m = new Map();
  if (S.cad) for (const g of Object.values(S.cad.grupos)) m.set(g.jid, { jid: g.jid, ult: 0, n: 0 });
  for (const x of S.msgs) { const c = m.get(x.chat) || { jid: x.chat, ult: 0, n: 0 }; c.ult = Math.max(c.ult, x.t); c.n++; c.ultimo = x; m.set(x.chat, c); }
  const ordem = { sistema: 0, privado: 1, shopping: 2, tecnico: 3, outro: 4 };
  return [...m.values()].sort((a, b) => (b.ult - a.ult) || (ordem[tipoChat(a.jid)] - ordem[tipoChat(b.jid)]) || nomeChat(a.jid).localeCompare(nomeChat(b.jid)));
}
function desenharChats() {
  const q = S.busca.toLowerCase();
  const html = chats().filter(c => !q || nomeChat(c.jid).toLowerCase().includes(q) || c.jid.includes(q)).map(c => {
    const novos = S.msgs.filter(x => x.chat === c.jid && x.seq > (S.lidos[c.jid] || 0)).length;
    const prev = c.ultimo ? (c.ultimo.fromMe ? '🤖 ' : '') + String(c.ultimo.texto || (c.ultimo.imagem ? '📷 imagem' : '')).split('\n')[0] : '';
    return `<div class="chat ${c.jid === S.chat ? 'atual' : ''} t-${tipoChat(c.jid)}" data-jid="${esc(c.jid)}"><div class="nome">${esc(nomeChat(c.jid))}</div>
      <div class="prev">${esc(prev).slice(0, 80)}</div>${novos && c.jid !== S.chat ? `<span class="bolha">${novos}</span>` : ''}</div>`;
  }).join('');
  $('#listaChats').innerHTML = html || '<p class="vazio">Nenhuma conversa. Confira a leitura do banco (↻ Reler banco).</p>';
}

// ---------- conversa ----------
function desenharConversa() {
  const box = $('#mensagens');
  if (!S.chat) { box.innerHTML = '<p class="vazio">Escolha um grupo à esquerda.</p>'; return; }
  $('#tituloChat').textContent = nomeChat(S.chat);
  $('#subChat').textContent = S.chat;
  $('#limparChat').hidden = false;
  const lista = S.msgs.filter(m => m.chat === S.chat);
  const porId = Object.fromEntries(lista.map(m => [m.id, m]));
  const embaixo = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.innerHTML = lista.map(m => {
    const q = m.reply_to && porId[m.reply_to];
    const quem = m.fromMe ? (m.usuario ? 'Bot (enviada por você)' : '🤖 Bot') : (m.nome || m.de);
    return `<div class="msg ${m.fromMe ? 'eu' : 'ele'}" data-id="${esc(m.id)}">
      <div class="autor">${esc(quem)}${m.mentions && m.mentions.length ? ` <span class="ment" title="${esc(m.mentions.join(', '))}">🔔 ${m.mentions.length} marcado(s)</span>` : ''}</div>
      ${q ? `<div class="citado"><b>${esc(q.fromMe ? 'Bot' : (q.nome || q.de))}</b><br>${esc(String(q.texto).slice(0, 160))}</div>` : (m.reply_to ? '<div class="citado">(respondendo a uma mensagem)</div>' : '')}
      ${m.imagem ? `<img class="img" src="${esc(m.imagem)}" alt="imagem">` : ''}
      <div class="texto">${formatar(m)}</div>
      <div class="meta">${m.n8n_erro ? `<span class="erro" title="${esc(m.n8n_erro)}">⚠ n8n: ${esc(m.n8n_erro).slice(0, 90)}</span> ` : ''}${hora(m.t)} ${m.fromMe ? '' : `<a href="#" class="responder" data-id="${esc(m.id)}">responder</a>`}</div></div>`;
  }).join('') || '<p class="vazio">Sem mensagens ainda. Escreva abaixo.</p>';
  if (embaixo || S.rolar) { box.scrollTop = box.scrollHeight; S.rolar = false; }
  const ult = lista.length ? lista[lista.length - 1].seq : 0;
  S.lidos[S.chat] = Math.max(S.lidos[S.chat] || 0, ult);
}
function abrirChat(jid) { S.chat = jid; S.resp = null; $('#respondendo').hidden = true; S.rolar = true; desenharChats(); desenharConversa(); $('#texto').focus(); }

// ---------- quem escreve ----------
function desenharQuem() {
  const sel = $('#comoQuem'), atual = sel.value;
  const ops = ['<option value="eu|5541900000001|Você (teste)">Você (teste)</option>'];
  const vistos = new Set();
  for (const t of (S.cad ? S.cad.tecnicos : [])) {
    const f = digitos(t.fone); if (!f || vistos.has(f)) continue; vistos.add(f);
    ops.push(`<option value="p|${esc(f)}|${esc(t.nome)}">${esc(t.nome)} (${esc(f.slice(-4))})</option>`);
  }
  ops.push(`<option value="bot|${esc(S.cad ? S.cad.bot.fone : '')}|Bot">O próprio número do bot (o bot ignora)</option>`);
  sel.innerHTML = ops.join(''); if (atual) sel.value = atual;
}

// ---------- IXC ----------
function opcoes(lista, val, rot, vazio) { return (vazio ? `<option value="${esc(vazio[0])}">${esc(vazio[1])}</option>` : '') + lista.map(x => `<option value="${esc(x[val])}">${esc(rot(x))}</option>`).join(''); }
function tecnicosDe(emp) {
  const e = S.cad.empresas.find(x => x.id === emp) || {};
  const lst = S.cad.tecnicos.filter(t => t.empresa === emp).map(t => ({ id: t.id, nome: t.nome + (t.fone ? '' : ' (sem fone)') }));
  if (e.dono_id && !lst.find(t => t.id === String(e.dono_id))) lst.unshift({ id: String(e.dono_id), nome: 'Dono do número (id ' + e.dono_id + ')' });
  for (const f of S.cad.funcionarios.filter(f => f.empresa === emp)) if (!lst.find(t => t.id === f.id)) lst.push({ id: f.id, nome: f.nome + ' (funcionário)' });
  return lst;
}
function desenharFormChamado() {
  if (!S.cad) return;
  const se = $('#ch_empresa'), emp = se.value || (S.cad.empresas[0] || {}).id;
  se.innerHTML = opcoes(S.cad.empresas.filter(e => e.ativo), 'id', e => e.id + ' — ' + e.nome); se.value = emp;
  trocarEmpresa();
}
function trocarEmpresa() {
  const emp = $('#ch_empresa').value;
  $('#ch_local').innerHTML = opcoes(S.cad.locais.filter(l => l.empresa === emp), 'id', l => l.nome, ['0', 'Sem shopping (local não identificado)']);
  $('#ch_assunto').innerHTML = opcoes(S.cad.assuntos[emp] || [], 'id', a => a.assunto);
  $('#ch_tecnico').innerHTML = opcoes(tecnicosDe(emp), 'id', t => t.nome, ['0', '— sem técnico —']);
}
function desenharChamados() {
  if (!S.cad) return;
  const linhas = [];
  for (const [emp, v] of Object.entries(S.ixc)) for (const c of v.chamados) linhas.push(Object.assign({ emp }, c));
  linhas.sort((a, b) => +b.id - +a.id);
  $('#listaChamados').innerHTML = linhas.map(c => {
    const tec = opcoes(tecnicosDe(c.emp), 'id', t => t.nome);
    const ag = c.data_agenda && !c.data_agenda.startsWith('0000') ? `📅 visita ${esc(c.data_agenda.slice(11, 16))} (${esc(c.data_agenda.slice(8, 10) + '/' + c.data_agenda.slice(5, 7))})` : '';
    return `<div class="chamado ${c.status === 'F' ? 'fechado' : ''}" data-emp="${esc(c.emp)}" data-id="${esc(c.id)}">
      <div><b>#${esc(c.protocolo)}</b> · ${esc(c.emp)} · ${esc(c.shopping)} ${c.status === 'F' ? '<span class="tag">fechado</span>' : ''}</div>
      <div class="sub">${esc(c.assunto)} · aberto ${esc(c.data_abertura.slice(11, 16))} · técnico: <b>${esc(c.tecnico)}</b> ${ag}</div>
      <div class="acoes"><select class="tec">${tec}</select><button data-a="assumir">Assumir</button><button data-a="transferir">Transferir</button></div>
      <div class="acoes"><button data-a="agendar" data-min="55" title="Lembrete de 1 h (janela 40–60 min)">Agendar +55 min</button><button data-a="agendar" data-min="8" title="Lembrete de 10 min (janela 3–10 min)">+8 min</button>
        <button data-a="envelhecer" data-min="12" title="Abertura 12 min atrás: 1º aviso sem técnico">Abertura −12 min</button><button data-a="envelhecer" data-min="185" title="Abertura 3 h atrás (re-alerta: depende de realerta_min)">−3h</button><button data-a="envelhecer" data-min="300" title="Abertura 5 h atrás (re-alerta escalado: depende de realerta_min)">−5h</button></div>
      <div class="acoes"><button data-a="mensagem" title="Mensagem no chamado (ex.: pedido de infra)">Mensagem…</button>${c.status === 'F' ? '<button data-a="reabrir">Reabrir</button>' : '<button data-a="fechar">Fechar</button>'}${ag ? '<button data-a="desagendar">Tirar agenda</button>' : ''}</div></div>`;
  }).join('') || '<p class="vazio">Nenhum chamado simulado.</p>';
}
function desenharLog(log) {
  $('#log').innerHTML = log.slice().reverse().map(l => `<div class="l-${esc(l.tipo)}"><span>${hora(l.t)}</span> <b>${esc(l.tipo)}</b> ${esc(l.txt)}</div>`).join('') || '<p class="vazio">Nada ainda.</p>';
}
function desenharStatus(st) {
  const c = st.cad || {}, p = c.param || {};
  const partes = [];
  if (!c.ok) partes.push(`<span class="ruim">banco: ${esc(c.erro || '?')}</span>`);
  else {
    partes.push(p.envio === 'REAL' ? '<span class="bom">envio REAL → grupos simulados</span>' : `<span class="medio" title="Com envio=${esc(p.envio)} tudo vai para o particular ${esc(p.envio_teste_para)}">envio ${esc(p.envio || '?')}</span>`);
    if (!p.base_ok) partes.push('<span class="medio" title="ixc.empresas.base_url não aponta para o simulador (os workflows [SIM] usam o simulador mesmo assim)">base_url ≠ simulador</span>');
  }
  partes.push('<span>' + esc(st.agora.slice(11, 16)) + ' BRT</span>');
  $('#status').innerHTML = partes.join(' · ');
  $('#wahaFora').checked = !!st.wahaFora;
}

// ---------- ciclo ----------
async function carregarCad(recarregar) {
  try { S.cad = await api('/sim/cadastro' + (recarregar ? '?recarregar=1' : '')); desenharQuem(); desenharFormChamado(); desenharChats(); if (recarregar) toast('Banco relido: ' + S.cad.locais.length + ' shoppings, ' + S.cad.tecnicos.length + ' técnicos.'); }
  catch (e) { toast('Não li o banco de teste: ' + e.message, true); }
}
async function ciclo() {
  try {
    const st = await api('/sim/estado?desde=' + S.seq);
    if (st.seq < S.seq) { S.msgs = []; S.seq = 0; return ciclo(); }  // limpou
    if (st.msgs.length) { S.msgs = S.msgs.concat(st.msgs); S.seq = st.seq; }
    const ixcNovo = JSON.stringify(st.ixc);
    if (ixcNovo !== S.ixcJson) { S.ixcJson = ixcNovo; S.ixc = st.ixc; desenharChamados(); }
    desenharStatus(st); desenharLog(st.log);
    if (st.msgs.length || !S.desenhou) { S.desenhou = true; desenharChats(); desenharConversa(); }
  } catch (e) { $('#status').innerHTML = '<span class="ruim">simulador sem resposta</span>'; }
  setTimeout(ciclo, 1500);
}

// ---------- eventos ----------
document.addEventListener('click', async ev => {
  const ch = ev.target.closest('.chat'); if (ch) return abrirChat(ch.dataset.jid);
  const r = ev.target.closest('.responder');
  if (r) { ev.preventDefault(); const m = S.msgs.find(x => x.id === r.dataset.id); S.resp = r.dataset.id; const b = $('#respondendo'); b.hidden = false; b.innerHTML = 'Respondendo: ' + esc(String(m ? m.texto : '').slice(0, 80)) + ' <a href="#" id="cancResp">✕</a>'; return; }
  if (ev.target.id === 'cancResp') { ev.preventDefault(); S.resp = null; $('#respondendo').hidden = true; return; }
  const ab = ev.target.closest('[data-aba]');
  if (ab) { document.querySelectorAll('[data-aba]').forEach(b => b.classList.toggle('ativa', b === ab)); document.querySelectorAll('.aba').forEach(a => { a.hidden = a.id !== 'aba-' + ab.dataset.aba; }); return; }
  const ro = ev.target.closest('[data-rodar]');
  if (ro) { ro.disabled = true; try { const x = await api('/sim/rodar', { wf: ro.dataset.rodar }); toast(x.status === 200 ? `WF ${ro.dataset.rodar} disparado. As mensagens aparecem em alguns segundos.` : `WF ${ro.dataset.rodar}: HTTP ${x.status || '—'} ${x.status === 404 ? '(o workflow [SIM] não está publicado)' : x.txt}`, x.status !== 200); } catch (e) { toast(e.message, true); } ro.disabled = false; return; }
  const ac = ev.target.closest('.chamado [data-a]');
  if (ac) {
    const box = ac.closest('.chamado'), a = ac.dataset.a;
    const d = { empresa: box.dataset.emp, id: box.dataset.id, acao: a, id_tecnico: box.querySelector('.tec').value, minutos: +ac.dataset.min || 0 };
    if (a === 'mensagem') { const t = prompt('Texto da mensagem no chamado (ex.: "precisa de infra: passar cabo até a loja")'); if (!t) return; d.texto = t; }
    try { await api('/sim/acao', d); toast('Chamado ' + a + ': feito. Agora ▶ ' + (a === 'agendar' ? 'Lembretes (02)' : 'Avisos (01)') + '.'); } catch (e) { toast(e.message, true); }
    return;
  }
  if (ev.target.id === 'recarregarCad') return carregarCad(true);
  if (ev.target.id === 'limparConversas') { if (confirm('Apagar todas as conversas do simulador?')) { await api('/sim/limpar', { o: 'conversas' }); S.msgs = []; S.seq = 0; desenharChats(); desenharConversa(); } return; }
  if (ev.target.id === 'limparChat') { if (confirm('Apagar as mensagens desta conversa?')) { await api('/sim/limpar', { o: 'chat', chat: S.chat }); S.msgs = S.msgs.filter(m => m.chat !== S.chat); desenharConversa(); } return; }
  if (ev.target.id === 'limparIxc') { if (confirm('Apagar todos os chamados simulados?')) await api('/sim/limpar', { o: 'ixc' }); return; }
});
$('#wahaFora').addEventListener('change', e => api('/sim/opcoes', { wahaFora: e.target.checked }).then(x => toast(x.wahaFora ? 'WAHA simulado FORA do ar: os envios do bot vão falhar.' : 'WAHA simulado de volta.')));
$('#buscaChat').addEventListener('input', e => { S.busca = e.target.value; desenharChats(); });
$('#ch_empresa').addEventListener('change', trocarEmpresa);
$('#formEnviar').addEventListener('submit', async ev => {
  ev.preventDefault();
  const t = $('#texto').value; if (!S.chat) return toast('Escolha uma conversa à esquerda.', true); if (!t.trim()) return;
  const [tipo, fone, nome] = $('#comoQuem').value.split('|');
  $('#texto').value = '';
  try { const m = await api('/sim/enviar', { chat: S.chat, texto: t, fone, nome, fromMe: tipo === 'bot', reply_to: S.resp }); S.resp = null; $('#respondendo').hidden = true; S.rolar = true; if (m.n8n_erro) toast('n8n: ' + m.n8n_erro, true); }
  catch (e) { toast(e.message, true); $('#texto').value = t; }
});
$('#texto').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#formEnviar').requestSubmit(); } });
$('#formChamado').addEventListener('submit', async ev => {
  ev.preventDefault();
  const d = Object.fromEntries(new FormData(ev.target));
  try { const c = await api('/sim/chamado', d); toast('Chamado #' + c.protocolo + ' aberto. Clique ▶ Avisos (01).'); ev.target.querySelector('[name=mensagem]').value = ''; } catch (e) { toast(e.message, true); }
});
carregarCad(false).then(ciclo);
