#!/usr/bin/env python3
"""whatsapp-ixc 0.2.0 — lembretes de visita (WF 02) com a planta da loja.

Aplica sobre a saida do adaptar_waha.py (0.1.x), no lugar:
  python3 scripts/v020_lembrete_planta.py <pasta com n8n/ e fontes/>

O que muda no WF 02 "Lembretes de visita":
  - 1h antes (40-60 min): aviso completo + recorte da planta com a loja marcada (servico planta-loja,
    mesmo do WF 01). Sem planta (shopping sem planta, loja nao achada/repetida, servico fora,
    planta_ativo='nao') sai so o texto, como antes.
  - "15 minutos" vira "10 minutos" (3-10 min), so um texto curto, sem imagem:
      Não esqueça: visita na *Loja X* (Shopping, Loja 102) daqui 10 minutos, às 14:00.
  - nos novos "Buscar Planta" e "Anexar Planta" entre "Montar Lembrete" e "Enviar WhatsApp";
    "Enviar WhatsApp" passa a usar $json.endpoint/$json.corpo (sendImage ou sendText), como o WF 01.
  - "Resultado" grava em ixc.eventos.motivo se foi com planta ou por que nao.
Falha alto (AssertionError) se o JSON de entrada nao for o esperado.
"""
import json, os, re, sys, unicodedata

ARQ = "02_IXC_Lembretes_de_Visita.json"


def troca(txt, velho, novo, no):
    assert txt.count(velho) == 1, f"{no}: trecho esperado nao encontrado (ou repetido): {velho[:60]!r}"
    return txt.replace(velho, novo)


FILTRAR_VELHO = """// Visitas agendadas: lembrete "em 1 hora" (faltando 40-60 min) e "em 15 minutos" (3-15 min)."""
FILTRAR_NOVO = """// Visitas agendadas: lembrete "em 1 hora" (faltando 40-60 min, com a planta da loja) e lembrete curto
// "daqui 10 minutos" (3-10 min, so texto). Regra de 28/10/2026 (0.2.0); antes era "em 15 minutos" (3-15 min)."""
JANELAS_VELHO = """  { tipo: 'lembrete_15min', de: 3, ate: 15 },"""
JANELAS_NOVO = """  { tipo: 'lembrete_10min', de: 3, ate: 10 },"""
TITULO_VELHO = """    const titulo = jan.tipo === 'lembrete_1h' ? (faltam > 50 ? 'em 1 hora' : 'em ' + Math.round(faltam) + ' minutos')
                                               : (faltam > 10 ? 'em 15 minutos' : 'em ' + Math.round(faltam) + ' minutos');
    out.push({ pairedItem: { item: k }, json: { empresa: h.empresa, tipo: jan.tipo, janela: titulo, chamado: c } });"""
TITULO_NOVO = """    const titulo = jan.tipo === 'lembrete_1h' ? (faltam > 50 ? 'em 1 hora' : 'em ' + Math.round(faltam) + ' minutos')
                                               : 'em ' + Math.max(1, Math.round(faltam)) + ' minutos';
    out.push({ pairedItem: { item: k }, json: { empresa: h.empresa, tipo: jan.tipo, janela: titulo, faltam: Math.max(1, Math.round(faltam)), chamado: c } });"""

MONTAR_VELHO = """  let texto = '⏰ *Lembrete de visita — ' + d.janela + '*' + (quem ? ' — ' + quem : '');"""
MONTAR_NOVO = """  // Lembrete curto (10 min antes): uma linha, sem planta (a planta ja foi no de 1h). Regra de 28/10/2026 (0.2.0).
  if (d.tipo === 'lembrete_10min') {
    const quemVisita = nomeLoja || nomeCliente;
    const onde = [d.shopping, numLoja].filter(Boolean).join(', ');
    const n = d.faltam || 10;
    let curto = '⏰ Não esqueça: visita' + (quemVisita ? ' na *' + quemVisita + '*' : ' do chamado #' + c.protocolo) + (onde ? ' (' + onde + ')' : '')
      + ' daqui ' + n + (n === 1 ? ' minuto' : ' minutos') + ', às ' + hora + '.';
    if (quem) curto += '\\n' + quem + (d.sem_tecnico ? ' · sem técnico atribuído' : '');
    out.push({ pairedItem: { item: i }, json: { empresa: d.empresa, tipo: d.tipo, id_chamado: c.id, protocolo: c.protocolo, evento: c.data_agenda,
      texto: curto, grupo_jid: d.grupo_jid, mentioned: marcar, planta: null } });
    continue;
  }
  // Lembrete de 1h: pede a planta (servico planta-loja) quando ha numero de loja e shopping; desligar: planta_ativo = 'nao'
  const idCond = String(c.id_condominio || '0') !== '0' ? String(c.id_condominio) : String(cli.id_condominio || '0');
  const planta = (PLANTA_ATIVA && /\\d/.test(numLoja) && idCond !== '0')
    ? { empresa: d.empresa, id_condominio: idCond, loja: numLoja.replace(/^Loja\\s+/i, ''), nome: nomeLoja || nomeCliente }
    : null;
  let texto = '⏰ *Lembrete de visita — ' + d.janela + '*' + (quem ? ' — ' + quem : '');"""
MONTAR_LOOP_VELHO = """const items = $input.all();
const out = [];
for (let i = 0; i < items.length; i++) {
  const d = $('Rotear Lembrete').itemMatching(i).json;"""
MONTAR_LOOP_NOVO = """const PLANTA_ATIVA = String(carregarConfig().param.planta_ativo || 'nao').trim().toLowerCase() !== 'nao';
const items = $input.all();
const out = [];
for (let i = 0; i < items.length; i++) {
  const d = $('Rotear Lembrete').itemMatching(i).json;"""
MONTAR_PUSH_VELHO = """    texto, grupo_jid: d.grupo_jid, mentioned: marcar } });"""
MONTAR_PUSH_NOVO = """    texto, grupo_jid: d.grupo_jid, mentioned: marcar, planta } });"""

ANEXAR = r"""// Planta da loja no lembrete de 1h (0.2.0, 28/10/2026): com imagem -> /api/sendImage (foto + lembrete na legenda,
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
});"""

RESULT_VELHO = """  const erro = ok ? (d.simulado ? 'SIMULADO' : null) : String((r.error && (r.error.message || r.error)) || r.message || JSON.stringify(r)).slice(0, 300);"""
RESULT_NOVO = """  const pi = $('Anexar Planta').itemMatching(i).json.planta_info; // 0.2.0: com/sem planta (lembrete de 1h)
  const erro = ok ? ([d.simulado ? 'SIMULADO' : null, pi].filter(Boolean).join(' · ') || null)
                  : String((r.error && (r.error.message || r.error)) || r.message || JSON.stringify(r)).slice(0, 300);"""


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_")


def extrair_fontes(wf, pasta, titulo):  # so os nos Code (.js), como a pasta fontes/ do repositorio
    os.makedirs(pasta, exist_ok=True)
    for n in wf["nodes"]:
        p = n.get("parameters", {})
        if "jsCode" in p:
            with open(os.path.join(pasta, slug(n["name"]) + ".js"), "w") as f:
                f.write(f"// Workflow: {titulo}\n// No: {n['name']}\n\n{p['jsCode']}\n")


def main():
    raiz = sys.argv[1]
    caminho = os.path.join(raiz, "n8n", ARQ)
    wf = json.load(open(caminho, encoding="utf-8"))
    nos = {n["name"]: n for n in wf["nodes"]}
    assert "Anexar Planta" not in nos, "WF 02 ja esta na 0.2.0"

    p = nos["Filtrar Janela"]["parameters"]
    js = troca(p["jsCode"], FILTRAR_VELHO, FILTRAR_NOVO, "Filtrar Janela")
    js = troca(js, JANELAS_VELHO, JANELAS_NOVO, "Filtrar Janela")
    p["jsCode"] = troca(js, TITULO_VELHO, TITULO_NOVO, "Filtrar Janela")

    p = nos["Montar Lembrete"]["parameters"]
    js = troca(p["jsCode"], MONTAR_LOOP_VELHO, MONTAR_LOOP_NOVO, "Montar Lembrete")
    js = troca(js, MONTAR_VELHO, MONTAR_NOVO, "Montar Lembrete")
    p["jsCode"] = troca(js, MONTAR_PUSH_VELHO, MONTAR_PUSH_NOVO, "Montar Lembrete")

    p = nos["Resultado"]["parameters"]
    p["jsCode"] = troca(p["jsCode"], RESULT_VELHO, RESULT_NOVO, "Resultado")

    env = nos["Enviar WhatsApp"]
    env["parameters"]["url"] = "={{ $json.endpoint }}"
    env["parameters"]["jsonBody"] = "={{ JSON.stringify($json.corpo) }}"

    # empurra os nos depois de Montar Lembrete 400 px para a direita
    xm = nos["Montar Lembrete"]["position"][0]
    for n in wf["nodes"]:
        if n["position"][0] > xm:
            n["position"] = [n["position"][0] + 400, n["position"][1]]
    y = nos["Montar Lembrete"]["position"][1]
    wf["nodes"] += [
        {"parameters": {"method": "POST", "url": "http://planta-loja:3100/planta", "sendBody": True, "specifyBody": "json",
                        "jsonBody": "={{ JSON.stringify($json.planta || {}) }}", "options": {"timeout": 20000}},
         "name": "Buscar Planta", "type": "n8n-nodes-base.httpRequest",
         "typeVersion": 4.2, "alwaysOutputData": True, "onError": "continueRegularOutput", "position": [xm + 200, y]},
        {"parameters": {"jsCode": ANEXAR}, "name": "Anexar Planta",
         "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [xm + 400, y]},
    ]
    con = wf["connections"]
    assert con["Montar Lembrete"]["main"][0][0]["node"] == "Enviar WhatsApp"
    con["Montar Lembrete"] = {"main": [[{"node": "Buscar Planta", "type": "main", "index": 0}]]}
    con["Buscar Planta"] = {"main": [[{"node": "Anexar Planta", "type": "main", "index": 0}]]}
    con["Anexar Planta"] = {"main": [[{"node": "Enviar WhatsApp", "type": "main", "index": 0}]]}

    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(wf, f, ensure_ascii=False, indent=1)
        f.write("\n")
    pasta = os.path.join(raiz, "fontes", ARQ[:-5])
    extrair_fontes(wf, pasta, wf["name"])
    print("WF 02 -> 0.2.0: lembrete 1h com planta, lembrete curto 10 min; nos Buscar Planta + Anexar Planta")


if __name__ == "__main__":
    main()
