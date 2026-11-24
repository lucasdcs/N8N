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
// 0.5.0 (Painel do Bot 0.4.0): MENSAGENS NOVAS criadas no painel = resposta fixa quando a mensagem tem uma das frases.
// Mesma regra das perguntas (palavras inteiras, na ordem, ate 200 caracteres); prioridade sobre setores e escala.
if (n.length <= 200) {
  let RS_ = [];
  try { RS_ = JSON.parse(String($('Carregar Parametros').first().json.respostas || '[]')); } catch (e) { RS_ = []; }
  if (Array.isArray(RS_) && RS_.length) {
    const recados_ = String($('Carregar Parametros').first().json.setores_grupo || '');
    // a mensagem tambem e comparada sem hifen: frase "wifi" vale para "wifi", "Wi-Fi" e "wi-fi"
    const nn_ = ' ' + n.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    const nh_ = ' ' + n.replace(/-/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    // 0.6.2: frase com {shopping}: palavras antes/depois na ordem; o que sobra no lugar vai para a busca de shopping
    const bate_ = (h, f) => {
      if (f.indexOf('{shopping}') < 0) return h.includes(' ' + f + ' ') ? { sh: null } : null;
      const [a, b] = f.split('{shopping}').map(x => x.trim());
      let resto = h;
      if (a) { const k = h.indexOf(' ' + a + ' '); if (k < 0) return null; resto = h.slice(k + a.length + 1); }
      if (b) { const j = resto.indexOf(' ' + b + ' '); if (j < 0) return null; resto = resto.slice(0, j); }
      return { sh: resto.trim() };
    };
    let r_ = null, m_ = null;
    for (const r of RS_) {
      if (r.g === 'recados' && key.remoteJid !== recados_) continue;
      for (const f of (Array.isArray(r.f) ? r.f : [])) { if (!f) continue; m_ = bate_(nn_, f) || bate_(nh_, f); if (m_) break; }
      if (m_) { r_ = r; break; }
    }
    if (r_) {
      let VR_ = {};
      try { VR_ = JSON.parse(String($('Carregar Parametros').first().json.variaveis || '{}')) || {}; } catch (e) { VR_ = {}; }
      return [{ json: { grupo: key.remoteJid, texto, id: key.id, participant: key.participant || null, fromMe: !!key.fromMe, resposta_fixa: String(r_.t || ''), resposta_chave: r_.chave,
        resposta_shopping: m_.sh, resposta_vars: (VR_ && typeof VR_ === 'object' && !Array.isArray(VR_)) ? VR_ : {} } }];
    }
  }
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
// 0.3.0 (Painel do Bot, decisao de 23/11 "opcao a"): as frases de ixc.perguntas SOMAM ao reconhecimento acima.
// Frase ligada do setor aciona; frase desligada (e nenhuma ligada) cala o setor mesmo que a regex tenha achado.
// grupos = 'recados': so vale no grupo de Recados. Mensagem com mais de 200 caracteres nao aciona (igual a regex).
if (n.length <= 200) {
  let PQ = [];
  try { PQ = JSON.parse(String($('Carregar Parametros').first().json.perguntas || '[]')); } catch (e) { PQ = []; }
  if (!Array.isArray(PQ)) PQ = [];
  const recados = String($('Carregar Parametros').first().json.setores_grupo || '');
  const nn = ' ' + n.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const tem = p => nn.includes(' ' + String(p.frase_norm || '') + ' ');
  for (const s of ['n2', 'financeiro', 'comercial', 'compras', 'rh']) {
    const lig = PQ.filter(p => p.alvo === s && p.ativo && (p.grupos !== 'recados' || key.remoteJid === recados)).some(tem);
    const desl = PQ.filter(p => p.alvo === s && !p.ativo).some(tem);
    if (lig && !setores.includes(s)) setores.push(s);
    else if (!lig && desl && setores.includes(s)) setores.splice(setores.indexOf(s), 1);
  }
}
if (setores.length) return [{ json: { grupo: key.remoteJid, texto, id: key.id, participant: key.participant || null, fromMe: !!key.fromMe, setores } }];
if (!ehPergunta(n)) return [];
return [{ json: { grupo: key.remoteJid, texto, id: key.id, participant: key.participant || null, fromMe: !!key.fromMe } }];

