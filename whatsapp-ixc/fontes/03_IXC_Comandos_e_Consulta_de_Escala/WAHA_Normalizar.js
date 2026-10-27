// Workflow: WhatsApp - Comandos ixc e consulta de escala (WAHA)
// No: WAHA: Normalizar

// WAHA -> formato interno (27/10/2026)
// O WAHA entrega os eventos 'message' / 'message.any' com payload { id, from, fromMe, participant, body, hasMedia, _data }.
// Este no converte para o formato que o resto do workflow ja entende (data.key / data.message, igual ao da Evolution),
// para que os filtros, o interpretador e o bot de escalas nao mudem.
// So mensagem de GRUPO segue. Outros eventos (session.status, message.ack, ...) e conversas privadas do numero sao descartados aqui.
const b = $json.body || $json;
const ev = String(b.event || '');
if (!/^message(\.any)?$/.test(ev)) return [];
const p = b.payload || {};
const jid = String(p.from || '');
if (!jid.endsWith('@g.us')) return [];
const d = p._data || {};
const info = d.Info || {};
const pushName = info.PushName || d.notifyName || d.pushName || d.PushName || '';
const texto = typeof p.body === 'string' ? p.body : '';
return [{ json: { event: 'messages.upsert', origem: 'waha', sessao: b.session || null, data: {
  key: { remoteJid: jid, fromMe: !!p.fromMe, id: String(p.id || ''), participant: p.participant || null },
  pushName,
  messageType: p.hasMedia ? 'media' : 'conversation',
  message: { conversation: texto },
  timestamp: p.timestamp || null,
} } }];

