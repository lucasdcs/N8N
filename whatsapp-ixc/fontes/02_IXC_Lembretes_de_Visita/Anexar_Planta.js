// Workflow: WhatsApp - Lembretes de visita IXC (WAHA)
// No: Anexar Planta

// Planta da loja no lembrete de 1h (0.2.0, 28/10/2026): com imagem -> /api/sendImage (foto + lembrete na legenda,
// com a linha "🗺️ Planta: piso · loja N"); sem imagem -> /api/sendText (o lembrete nunca deixa de sair).
// O modo de envio (NENHUM/SIMULAR/REAL) ja foi aplicado no "Montar Lembrete" (chat_envio + cabecalho de simulacao).
let cfg = $('Carregar Config').first().json.cfg;
if (typeof cfg === 'string') cfg = JSON.parse(cfg);
const P = cfg.param || {};
const base = String(P.waha_url || 'http://waha:3000').replace(/\/+$/, '');
const sessao = P.waha_session;
const paraMentions = (lst) => (lst || []).map(f => String(f).replace(/\D/g, '') + '@c.us');
function unwrap(x) {
  if (x && typeof x === 'object' && typeof x.data === 'string') {
    try { return JSON.parse(x.data); } catch (e) { return x; }
  }
  return x || {};
}
return $input.all().map((it, i) => {
  const m = $('Montar Lembrete').itemMatching(i).json;
  const p = unwrap(it.json) || {};
  const com = !!(m.planta && p.ok && p.imagem);
  let texto = m.texto;
  if (com) {
    const linhas = texto.split('\n');
    const linha = '🗺️ Planta: ' + (p.piso || '') + ' · loja ' + (p.lojas || []).join('/');
    let k = linhas.findIndex(l => l.startsWith('🏬'));
    if (k < 0) k = linhas.findIndex(l => l.startsWith('🏢'));
    if (k < 0) linhas.push(linha); else linhas.splice(k + 1, 0, linha);
    texto = linhas.join('\n');
  }
  const chatId = m.chat_envio || m.grupo_jid;
  const corpo = com
    ? { session: sessao, chatId, file: { mimetype: 'image/png', filename: 'planta-loja.png', data: p.imagem }, caption: texto }
    : { session: sessao, chatId, text: texto, linkPreview: false };
  if (m.mentioned && m.mentioned.length) corpo.mentions = paraMentions(m.mentioned);
  const info = !m.planta ? null : com ? 'com planta: ' + (p.piso || '') + ' loja ' + (p.lojas || []).join('/')
    : 'sem planta: ' + (p.motivo || (p.error && (p.error.message || p.error)) || 'erro ao gerar');
  return { pairedItem: { item: i }, json: { endpoint: base + (com ? '/api/sendImage' : '/api/sendText'), corpo, planta_info: info } };
});
