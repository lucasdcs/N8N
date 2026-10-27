// Workflow: WhatsApp - Comandos ixc e consulta de escala (WAHA)
// No: IXC Cmd: Filtrar

// Comandos "ixc ..." no grupo de automação: mudam tecnicos/shoppings/feriados das notificacoes IXC (regra de 27/09/2026).
// So interpreta aqui; a mudanca e registrada como pendente e so vale depois de "ixc ok".
const body = $('WAHA: Normalizar').first().json;
const data = body.data || {};
const key = data.key || {};
const GRUPO_AUTOMACAO = String(($('Carregar Parametros').first().json || {}).grupo_automacao || '');
if (!GRUPO_AUTOMACAO || key.remoteJid !== GRUPO_AUTOMACAO) return [];
const msg = data.message || {};
const texto = (msg.conversation || (msg.extendedTextMessage && msg.extendedTextMessage.text) || '').trim();
const m = texto.match(/^ixc\b[:,]?\s*([\s\S]*)$/i);
if (!m) return [];
return [{ json: { texto, args: m[1].trim(), autor: data.pushName || (key.fromMe ? 'dono do número' : (key.participant || '?')) } }];

