// Workflow: WhatsApp - Comandos ixc e consulta de escala (WAHA)
// No: Escala: Filtrar Pergunta

// Pergunta livre de escala nos grupos (ex.: "quem ta no jockey?") -> resposta fixa do banco, sem Hermes (regra de 27/09/2026).
// Aqui so o filtro barato: tem texto, tem palavra de pergunta, nao e comando nem resposta do proprio bot.
const body = $('WAHA: Normalizar').first().json;
const data = body.data || {};
const key = data.key || {};
if (!key.remoteJid || !key.remoteJid.endsWith('@g.us')) return [];
const msg = data.message || {};
const texto = (msg.conversation || (msg.extendedTextMessage && msg.extendedTextMessage.text) || '').trim();
if (!texto || texto.length > 300) return [];
if (/^(ixc|hermes|analisar|ia)\b/i.test(texto)) return [];
if (/^((hermes[,:]?\s+)?(me lembr|lembr[ae]r?[- ]me|me cobr|cobr[ae]r?[- ]me|lembrete|anot[ae]|nova demanda)|feit[oa]s?\b|adia|cancel|ignorar\b|demandas?\b|pend[eê]ncias\b|resumo\b)/i.test(texto)) return []; // assistente de demandas (29/09)
if (/\b(lembrete|lembretes|lembra|lembrar|lembre|cobran[cç]as?|demandas?)\b/i.test(texto)) return [];                 // comandos tem ramo proprio
if (/^[^\p{L}\p{N}]/u.test(texto) || /\*ixc|^n[aã]o (achei|entendi)/i.test(texto)) return []; // respostas do bot (comecam com emoji)
const n = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Gatilhos tirados do historico real do N1/N2 (27/07-26/09/2026). n = texto sem acento, minusculo.
function ehPergunta(n) {
  if (/\beu quem\b|\bsou eu\b/.test(n)) return false;                                          // "sou eu quem ta no patio"
  if (/\b(quem|qm)\s+(esta|ta|estaria|estara|vai estar|vai ta|e|eh|fica|ficara|atende|atendera|vai atender|trabalha|responde)\b/.test(n)) return true;          // quem esta/ta/e o tecnico/e o responsavel
  if (n.length > 90) return false;                                                               // o resto so em mensagem curta
  if (/\b(tem|temos|ha|hoje tem|amanha tem)\s+(alguem|algum tecnico|tecnico)\b/.test(n)) return true; // tem alguem no X
  if (/^\W*((bom dia|boa tarde|boa noite|opa|ola|oi)\W+)?(alguem|algum tecnico)\s+(no|na|em)\b/.test(n)) return true; // alguem no X hoje?
  if (/\btecnico\s+(do|da|de|em|no|na)\b/.test(n)) return true;                                 // tecnico do jockey / favor tecnico de cascavel
  if (/\brespons[a]vel\s+(do|da|pelo|pela|de)\b/.test(n)) return true;                          // responsavel pelo shopping X
  return false;
}
// SETORES (04/10): "alguem do financeiro?", "algum n2 disponivel?", "comercial na ativa?", "contato do rh" -> contatos + horario
const SET = { financeiro: 'financeiro|financeiron|faturamento|cobranca', comercial: 'comercial|vendas', rh: 'rh|recursos humanos', compras: 'compras', n2: 'n2' };
const setores = [];
if (n.length <= 200) for (const [s, re] of Object.entries(SET)) {
  const R = '(' + re + ')';
  if (new RegExp('\\b(alguem|algum|alguma|algúem|quem)\\s+(ai\\s+|la\\s+)?((do|da|de|no|na)\\s+)?((time|setor|equipe|pessoal)\\s+)?((do|da)\\s+)?' + R + '\\b').test(n)
   || new RegExp('\\bquem\\s+(esta|ta|e|fica)\\s+(de|no|na)\\s+' + R + '\\b').test(n)
   || new RegExp('^\\W*([a-z]+\\W+){0,4}' + R + '\\s+(disponivel|on|online|na ativa|ativo|agr|agora)\\b').test(n)
   || new RegExp('\\b(contato|numero|telefone|whats|whatsapp|ramal)\\s+(do|da|de)\\s+' + R + '\\b').test(n))
    setores.push(s);
}
if (setores.length) return [{ json: { grupo: key.remoteJid, texto, id: key.id, participant: key.participant || null, fromMe: !!key.fromMe, setores } }];
if (!ehPergunta(n)) return [];
return [{ json: { grupo: key.remoteJid, texto, id: key.id, participant: key.participant || null, fromMe: !!key.fromMe } }];

