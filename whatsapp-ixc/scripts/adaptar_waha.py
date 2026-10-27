#!/usr/bin/env python3
"""
Adapta os workflows 01-04 da "Automacao IXC -> WhatsApp" (Evolution API) para o WAHA.

Uso:  python3 adaptar_waha.py <pasta Exportacao_Automacao_IXC> <pasta de saida> [valores.json]

valores.json (padrao: ao lado deste script; modelo em valores.exemplo.json) traz os valores do ambiente que entram no
02_configuracao_atual.sql: sessao do WAHA, JID do grupo de automacao, numero de teste, nomes do supervisor/coordenador.

Saida:
  n8n/01..04_*.json   workflows adaptados (importaveis)
  banco/01_estrutura_schema_ixc.sql   (sem \\restrict)
  banco/02_configuracao_atual.sql     (parametros waha_*, sem evolution_*/hermes_token)
  fontes/<workflow>/<no>.js|.sql      codigo de cada no, extraido dos JSON adaptados
  RELATORIO.txt                        o que foi trocado em cada arquivo

Regra do autor original, mantida: alterar so os nos de envio/recebimento; roteamento, filtros e banco iguais.
"""
import json
import os
import re
import sys
import unicodedata

CRED_WAHA = {"httpHeaderAuth": {"id": "wahaApiKey01", "name": "WAHA API"}}
CFGX = ("(typeof $('Carregar Config').first().json.cfg === 'string' ? "
        "JSON.parse($('Carregar Config').first().json.cfg) : $('Carregar Config').first().json.cfg)")
PX = "$('Carregar Parametros').first().json"
MENTIONS_JS = "$json.mentioned.map(f => String(f).replace(/\\D/g, '') + '@c.us')"
SQL_PARAMS = ("-- Parametros do WAHA e do grupo de automacao, em colunas de texto (sem depender do parse de json pelo no Postgres)\n"
              "SELECT max(CASE WHEN chave = 'waha_url' THEN valor END) AS waha_url,\n"
              "       max(CASE WHEN chave = 'waha_session' THEN valor END) AS waha_session,\n"
              "       max(CASE WHEN chave = 'grupo_automacao' THEN valor END) AS grupo_automacao\n"
              "FROM ixc.parametros")

relatorio = []
VAL = {}


def carregar_valores(caminho):
    if not os.path.exists(caminho):
        raise SystemExit(f"valores nao encontrados: {caminho} (copie valores.exemplo.json para valores.json e preencha)")
    v = json.load(open(caminho, encoding="utf-8"))
    for k in ("waha_session", "grupo_automacao", "envio_teste_para", "supervisor_nome", "coordenador_nome"):
        if not v.get(k):
            raise SystemExit(f"valores.json: falta '{k}'")
    return v


def log(arq, msg):
    relatorio.append(f"{arq}: {msg}")


def waha_http(node, url_expr, body_expr, method="POST"):
    """Transforma um no HTTP da Evolution em chamada WAHA com a credencial 'WAHA API' (X-Api-Key)."""
    p = node["parameters"]
    p["method"] = method
    p["url"] = url_expr
    p["authentication"] = "genericCredentialType"
    p["genericAuthType"] = "httpHeaderAuth"
    p["sendHeaders"] = True
    p["headerParameters"] = {"parameters": [{"name": "Content-Type", "value": "application/json"}]}
    if body_expr is None:
        p.pop("sendBody", None); p.pop("specifyBody", None); p.pop("jsonBody", None)
    else:
        p["sendBody"] = True
        p["specifyBody"] = "json"
        p["jsonBody"] = body_expr
    opts = p.setdefault("options", {})
    opts.setdefault("timeout", 30000)
    node["credentials"] = dict(CRED_WAHA)


def by_name(wf):
    return {n["name"]: n for n in wf["nodes"]}


def sub_once(code, old, new, arq, no):
    if old not in code:
        raise SystemExit(f"[{arq}] no '{no}': trecho nao encontrado:\n{old}")
    if code.count(old) != 1:
        raise SystemExit(f"[{arq}] no '{no}': trecho aparece {code.count(old)}x:\n{old}")
    return code.replace(old, new)


OK_OLD = "const ok = !!(r.key && r.key.id);"
OK_NEW = ("// WAHA: sucesso = objeto de mensagem (id) sem 'error'; erro HTTP vem como { error } (continueRegularOutput)\n"
          "  const ok = !!r && !r.error && !!(r.id || (r.key && r.key.id) || r._data);")
SIM_02_OLD = "  const erro = ok ? null : String("
SIM_02_NEW = "  const erro = ok ? (d.simulado ? 'SIMULADO' : null) : String("


def limpar_comentarios(code):
    """Nomes de pessoas em comentarios/rotulos -> papel (repo publico). Os pares vem de valores.json ("comentarios")."""
    for old, new in VAL.get("comentarios", []):
        code = code.replace(old, new)
    # "(Nome 27/09/2026)", "— Nome 28/09", ", Nome 29/09/2026)" (autor da regra, nos comentarios) -> "regra de <data>"
    code = re.sub(r"\(([A-Z][a-z]+) (\d{2}/\d{2}(?:/\d{4})?)", r"(regra de \2", code)
    code = re.sub(r"— ([A-Z][a-z]+) (\d{2}/\d{2}(?:/\d{4})?)", r"— regra de \2", code)
    code = re.sub(r", ([A-Z][a-z]+) (\d{2}/\d{2}/\d{4})\)", r", regra de \2)", code)
    code = re.sub(r"regras do [A-Z][a-z]+\b", "regras da coordenação", code)
    code = re.sub(r"ixc numero [A-Za-zÀ-ÿ]+(?: [A-Za-zÀ-ÿ]+)? 41 3216-\d{4}", "ixc numero Fulano 41 99999-0000", code)  # exemplo da ajuda sem numero real
    return code


# ----------------------------------------------------------------------------- 01
def adaptar_01(wf, arq):
    N = by_name(wf)
    # Anexar Planta: monta endpoint + corpo no formato WAHA (sendText / sendImage)
    c = N["Anexar Planta"]["parameters"]["jsCode"]
    ini = c.index("// Planta da loja: com imagem")
    c = c[:ini] + (
        "// Planta da loja: com imagem -> /api/sendImage (foto + mensagem na legenda); sem -> /api/sendText. WAHA, 27/10/2026.\n"
        "// Mencoes: WAHA quer 'mentions' como [telefone + '@c.us'] e o texto com '@' + telefone (ja vem assim do Montar Mensagem).\n"
        "const C = carregarConfig();\n"
        "const base = String(C.param.waha_url || 'http://waha:3000').replace(/\\/+$/, '');\n"
        "const sessao = C.param.waha_session;\n"
        "const paraMentions = (lst) => (lst || []).map(f => String(f).replace(/\\D/g, '') + '@c.us');\n"
        "// Modo de envio (ixc.parametros.envio): NENHUM = nao manda nada (o estado ja avancou: serve para consumir o historico na 1a ativacao);\n"
        "// SIMULAR = manda tudo para envio_teste_para, com o grupo de destino no cabecalho; REAL = manda para os grupos.\n"
        "const ENVIO = String(C.param.envio || 'NENHUM').trim().toUpperCase();\n"
        "const TESTE = String(C.param.envio_teste_para || '').replace(/\\D/g, '');\n"
        "if (ENVIO === 'NENHUM') return [];\n"
        "if (ENVIO !== 'REAL' && !TESTE) throw new Error('parametro envio=' + ENVIO + ' exige envio_teste_para');\n"
        "return $input.all().map((it, i) => {\n"
        "  const m = $('Montar Mensagem').itemMatching(i).json;\n"
        "  const p = unwrap(it.json) || {};\n"
        "  const com = !!(m.planta && p.ok && p.imagem);\n"
        "  const simular = ENVIO !== 'REAL';\n"
        "  const chatId = simular ? TESTE + '@c.us' : m.grupo_jid;\n"
        "  const texto = simular ? '🧪 SIMULAÇÃO → ' + m.grupo_jid + '\\n' + m.texto : m.texto;\n"
        "  const corpo = com\n"
        "    ? { session: sessao, chatId, file: { mimetype: 'image/png', filename: 'planta-loja.png', data: p.imagem }, caption: texto }\n"
        "    : { session: sessao, chatId, text: texto, linkPreview: false };\n"
        "  if (m.mentioned && m.mentioned.length) corpo.mentions = paraMentions(m.mentioned);\n"
        "  const info = !m.planta ? null : com ? 'com planta: ' + (p.piso || '') + ' loja ' + (p.lojas || []).join('/') : 'sem planta: ' + (p.motivo || (p.error && p.error.message) || 'erro ao gerar');\n"
        "  return { pairedItem: { item: i }, json: { endpoint: base + (com ? '/api/sendImage' : '/api/sendText'), corpo, planta_info: (simular ? 'SIMULADO' + (info ? ' · ' + info : '') : info), simulado: simular } };\n"
        "});\n")
    N["Anexar Planta"]["parameters"]["jsCode"] = c
    log(arq, "Anexar Planta: endpoint/corpo no formato WAHA (sendText/sendImage, mentions)")

    waha_http(N["Enviar WhatsApp"], "={{ $json.endpoint }}", "={{ JSON.stringify($json.corpo) }}")
    log(arq, "Enviar WhatsApp: credencial 'WAHA API' no lugar do header apikey")

    code = N["Pendentes"]["parameters"]["jsCode"]
    code = sub_once(code, "const max = +C.param.falha_max_tentativas || 5;",
                    "const max = +C.param.falha_max_tentativas || 5;\n"
                    "// Modo de envio (ver Anexar Planta): NENHUM nao reenvia; SIMULAR manda para envio_teste_para\n"
                    "const ENVIO = String(C.param.envio || 'NENHUM').trim().toUpperCase();\n"
                    "const TESTE = String(C.param.envio_teste_para || '').replace(/\\D/g, '');\n"
                    "if (ENVIO === 'NENHUM' || (ENVIO !== 'REAL' && !TESTE)) return [];", arq, "Pendentes")
    code = sub_once(code, "texto: p.texto, grupo_jid: p.grupo, mentioned: p.mentioned || [] } }));",
                    "texto: ENVIO === 'REAL' ? p.texto : '🧪 SIMULAÇÃO (reenvio) → ' + p.grupo + '\\n' + p.texto, grupo_jid: p.grupo, "
                    "chat_envio: ENVIO === 'REAL' ? p.grupo : TESTE + '@c.us', mentioned: p.mentioned || [] } }));", arq, "Pendentes")
    N["Pendentes"]["parameters"]["jsCode"] = code
    waha_http(N["Reenviar WhatsApp"], "={{ " + CFGX + ".param.waha_url }}/api/sendText",
              "={{ JSON.stringify(Object.assign({ session: " + CFGX + ".param.waha_session, chatId: $json.chat_envio || $json.grupo_jid, "
              "text: $json.texto, linkPreview: false }, ($json.mentioned && $json.mentioned.length) ? { mentions: "
              + MENTIONS_JS + " } : {})) }}")
    log(arq, "Reenviar WhatsApp: URL waha_url/api/sendText, corpo WAHA")

    for no in ("Resultado Envio", "Resultado Reenvio"):
        code = N[no]["parameters"]["jsCode"]
        N[no]["parameters"]["jsCode"] = sub_once(code, OK_OLD, OK_NEW, arq, no)
        log(arq, f"{no}: leitura do resultado no formato WAHA")

    # Buscar Planta: servico opcional; continua igual (planta_ativo='nao' desliga no banco)
    for n in wf["nodes"]:
        if n["type"].endswith(".code"):
            n["parameters"]["jsCode"] = limpar_comentarios(n["parameters"]["jsCode"])
    wf["name"] = "WhatsApp - Notificacoes de chamados IXC (WAHA)"
    return wf


# ----------------------------------------------------------------------------- 02
def adaptar_02(wf, arq):
    N = by_name(wf)
    code = N["Montar Lembrete"]["parameters"]["jsCode"]
    assert code.rstrip().endswith("return out;"), "Montar Lembrete: fim inesperado"
    code = code.rstrip()[:-len("return out;")] + (
        "// Modo de envio (ixc.parametros.envio): NENHUM = nao manda (e nao grava: o lembrete sai quando o modo mudar, se ainda estiver na janela);\n"
        "// SIMULAR = manda para envio_teste_para com o grupo de destino no cabecalho; REAL = manda para os grupos.\n"
        "const PARAM = carregarConfig().param || {};\n"
        "const ENVIO = String(PARAM.envio || 'NENHUM').trim().toUpperCase();\n"
        "const TESTE = String(PARAM.envio_teste_para || '').replace(/\\D/g, '');\n"
        "if (ENVIO === 'NENHUM') return [];\n"
        "if (ENVIO !== 'REAL' && !TESTE) throw new Error('parametro envio=' + ENVIO + ' exige envio_teste_para');\n"
        "if (ENVIO !== 'REAL') for (const o of out) { o.json.chat_envio = TESTE + '@c.us'; o.json.texto = '🧪 SIMULAÇÃO → ' + o.json.grupo_jid + '\\n' + o.json.texto; o.json.simulado = true; }\n"
        "return out;\n")
    N["Montar Lembrete"]["parameters"]["jsCode"] = code
    log(arq, "Montar Lembrete: modos NENHUM/SIMULAR/REAL (parametros envio / envio_teste_para)")
    waha_http(N["Enviar WhatsApp"], "={{ " + CFGX + ".param.waha_url }}/api/sendText",
              "={{ JSON.stringify(Object.assign({ session: " + CFGX + ".param.waha_session, chatId: $json.chat_envio || $json.grupo_jid, "
              "text: $json.texto, linkPreview: false }, ($json.mentioned && $json.mentioned.length) ? { mentions: "
              + MENTIONS_JS + " } : {})) }}")
    log(arq, "Enviar WhatsApp: URL waha_url/api/sendText, corpo WAHA, credencial 'WAHA API'")
    code = N["Resultado"]["parameters"]["jsCode"]
    code = sub_once(code, OK_OLD, OK_NEW, arq, "Resultado")
    code = sub_once(code, SIM_02_OLD, SIM_02_NEW, arq, "Resultado")
    N["Resultado"]["parameters"]["jsCode"] = code
    log(arq, "Resultado: leitura do resultado no formato WAHA")
    for n in wf["nodes"]:
        if n["type"].endswith(".code"):
            n["parameters"]["jsCode"] = limpar_comentarios(n["parameters"]["jsCode"])
    wf["name"] = "WhatsApp - Lembretes de visita IXC (WAHA)"
    return wf


# ----------------------------------------------------------------------------- 03
NORMALIZAR_JS = r"""// WAHA -> formato interno (27/10/2026)
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
"""


def adaptar_03(wf, arq):
    N = by_name(wf)
    wh = N["Webhook Evolution (mensagens dos grupos)"]
    wh["name"] = "Webhook WAHA (mensagens dos grupos)"
    log(arq, "Webhook: renomeado (path /webhook/ixc-whatsapp mantido)")

    pos_wh = wh.get("position", [0, 0])
    norm = {"parameters": {"jsCode": NORMALIZAR_JS}, "name": "WAHA: Normalizar", "type": "n8n-nodes-base.code",
            "typeVersion": 2, "position": [pos_wh[0] + 220, pos_wh[1]]}
    par = {"parameters": {"operation": "executeQuery", "query": SQL_PARAMS, "options": {}}, "name": "Carregar Parametros",
           "type": "n8n-nodes-base.postgres", "typeVersion": 2.6, "position": [pos_wh[0] + 440, pos_wh[1]],
           "alwaysOutputData": True, "credentials": {"postgres": {"name": "Postgres IXC State"}}}
    wf["nodes"].extend([norm, par])
    conn = wf["connections"]
    antigos = conn.pop("Webhook Evolution (mensagens dos grupos)")
    conn["Webhook WAHA (mensagens dos grupos)"] = {"main": [[{"node": "WAHA: Normalizar", "type": "main", "index": 0}]]}
    conn["WAHA: Normalizar"] = {"main": [[{"node": "Carregar Parametros", "type": "main", "index": 0}]]}
    conn["Carregar Parametros"] = antigos
    log(arq, "novos nos: 'WAHA: Normalizar' (payload WAHA -> interno) e 'Carregar Parametros' (waha_url, waha_session, grupo_automacao)")

    # Filtros passam a ler a mensagem normalizada (o item de entrada agora e o do Postgres)
    for no in ("IXC Cmd: Filtrar", "Escala: Filtrar Pergunta"):
        c = N[no]["parameters"]["jsCode"]
        c = sub_once(c, "const body = $json.body || $json;", "const body = $('WAHA: Normalizar').first().json;", arq, no)
        N[no]["parameters"]["jsCode"] = c
    c = N["IXC Cmd: Filtrar"]["parameters"]["jsCode"]
    m = re.search(r"if \(key\.remoteJid !== '[^']+@g\.us'\) return \[\];", c)
    if not m:
        raise SystemExit(f"[{arq}] IXC Cmd: Filtrar: linha do JID fixo nao encontrada")
    c = c.replace(m.group(0), "const GRUPO_AUTOMACAO = String((" + PX + " || {}).grupo_automacao || '');\n"
                  "if (!GRUPO_AUTOMACAO || key.remoteJid !== GRUPO_AUTOMACAO) return [];")
    c = re.sub(r"\(key\.fromMe \? '[^']*' : \(key\.participant \|\| '\?'\)\)", "(key.fromMe ? 'dono do número' : (key.participant || '?'))", c)
    N["IXC Cmd: Filtrar"]["parameters"]["jsCode"] = c
    log(arq, "IXC Cmd: Filtrar: grupo dos comandos vem do parametro grupo_automacao")

    # Validar numero: WAHA GET /api/contacts/check-exists?phone=&session=
    vn = N["IXC Cmd: Validar Numero"]
    waha_http(vn, "={{ " + PX + ".waha_url }}/api/contacts/check-exists", None, method="GET")
    vn["parameters"]["sendQuery"] = True
    vn["parameters"]["queryParameters"] = {"parameters": [
        {"name": "phone", "value": "={{ $json.fone_validar || '5500000000000' }}"},
        {"name": "session", "value": "={{ " + PX + ".waha_session }}"}]}
    log(arq, "IXC Cmd: Validar Numero: GET /api/contacts/check-exists")
    c = N["IXC Cmd: Finalizar"]["parameters"]["jsCode"]
    c = sub_once(c, "// Confere na Evolution se o numero tem WhatsApp (usa o JID real, que resolve o 9o digito) e monta o SQL.",
                 "// Confere no WAHA (/api/contacts/check-exists) se o numero tem WhatsApp (usa o chatId real, que resolve o 9o digito) e monta o SQL.",
                 arq, "IXC Cmd: Finalizar")
    c = sub_once(c, "    if (r.exists === false) {",
                 "    const existe = (r.numberExists !== undefined) ? r.numberExists : r.exists; // WAHA: numberExists/chatId; Evolution: exists/jid\n"
                 "    const jidRaw = r.chatId || r.jid || '';\n"
                 "    if (existe === false) {", arq, "IXC Cmd: Finalizar")
    c = sub_once(c, "    const jid = String(r.jid || '').split('@')[0];\n    if (r.exists && /^\\d+$/.test(jid))",
                 "    const jid = String(jidRaw).split('@')[0];\n    if (existe && /^\\d+$/.test(jid))", arq, "IXC Cmd: Finalizar")
    N["IXC Cmd: Finalizar"]["parameters"]["jsCode"] = c
    log(arq, "IXC Cmd: Finalizar: resposta numberExists/chatId")

    waha_http(N["IXC Cmd: Responder"], "={{ " + PX + ".waha_url }}/api/sendText",
              "={{ JSON.stringify({ session: " + PX + ".waha_session, chatId: " + PX + ".grupo_automacao, "
              "text: $('IXC Cmd: Finalizar').first().json.resposta || String($json.msg || 'Feito.'), linkPreview: false }) }}")
    log(arq, "IXC Cmd: Responder: sendText WAHA no grupo_automacao")

    waha_http(N["Escala: Responder"], "={{ " + PX + ".waha_url }}/api/sendText",
              "={{ JSON.stringify(Object.assign({ session: " + PX + ".waha_session, chatId: $json.grupo, text: $json.resposta, linkPreview: false }, "
              "($json.quoted && $json.quoted.key && $json.quoted.key.id) ? { reply_to: $json.quoted.key.id } : {}, "
              "($json.mentioned || []).length ? { mentions: " + MENTIONS_JS + " } : {})) }}")
    log(arq, "Escala: Responder: sendText WAHA com reply_to (citacao) e mentions")

    # Nomes fixos de supervisor/coordenador -> parametros supervisor_nome / coordenador_nome (por regex: o codigo original traz os nomes)
    RX_NOMES = re.compile(r"  if \(fone === P\.supervisor_fone\) return '[^']+ \(supervisor\)';\n  if \(fone === P\.coordenador_fone\) return '[^']+ \(coordenador\)';")
    RX_INCLUIR = re.compile(r"    if \(/\^[a-z]+/\.test\(q\)\) \{ fone = P\.supervisor_fone; nome = '[^']+ \(supervisor\)'; \}\n"
                            r"    else if \(/\^[a-z]+/\.test\(q\)\) \{ fone = P\.coordenador_fone; nome = '[^']+ \(coordenador\)'; \}")
    for no in ("IXC Cmd: Interpretar", "Escala: Montar Resposta"):
        c = N[no]["parameters"]["jsCode"]
        if len(RX_NOMES.findall(c)) != 1:
            raise SystemExit(f"[{arq}] {no}: bloco dos nomes fixos nao encontrado")
        c = RX_NOMES.sub(lambda m: "  if (fone === P.supervisor_fone) return (P.supervisor_nome || 'Supervisor') + ' (supervisor)';\n"
                         "  if (fone === P.coordenador_fone) return (P.coordenador_nome || 'Coordenador') + ' (coordenador)';", c)
        N[no]["parameters"]["jsCode"] = c
    c = N["IXC Cmd: Interpretar"]["parameters"]["jsCode"]
    if len(RX_INCLUIR.findall(c)) != 1:
        raise SystemExit(f"[{arq}] IXC Cmd: Interpretar: bloco 'incluir <nome>' nao encontrado")
    c = RX_INCLUIR.sub(lambda m: "    const primeiro = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').split(/\\s+/)[0];\n"
                       "    if (P.supervisor_nome && q.startsWith(primeiro(P.supervisor_nome))) { fone = P.supervisor_fone; nome = P.supervisor_nome + ' (supervisor)'; }\n"
                       "    else if (P.coordenador_nome && q.startsWith(primeiro(P.coordenador_nome))) { fone = P.coordenador_fone; nome = P.coordenador_nome + ' (coordenador)'; }", c)
    N["IXC Cmd: Interpretar"]["parameters"]["jsCode"] = c
    for no in ("IXC Cmd: Carregar", "Escala: Buscar Dados"):
        q = N[no]["parameters"]["query"]
        q = sub_once(q, "'supervisor_fone', 'coordenador_fone', 'escala_grupos'",
                     "'supervisor_fone', 'coordenador_fone', 'supervisor_nome', 'coordenador_nome', 'escala_grupos'", arq, no)
        N[no]["parameters"]["query"] = q
    log(arq, "supervisor/coordenador: nomes vem dos parametros supervisor_nome/coordenador_nome (antes fixos no codigo)")

    for n in wf["nodes"]:
        if n["type"].endswith(".code"):
            n["parameters"]["jsCode"] = limpar_comentarios(n["parameters"]["jsCode"])
    wf["name"] = "WhatsApp - Comandos ixc e consulta de escala (WAHA)"
    return wf


# ----------------------------------------------------------------------------- 04
def adaptar_04(wf, arq):
    N = by_name(wf)
    bx = N["Baixar aba HOJE"]
    bx["parameters"]["url"] = bx["parameters"]["url"].replace("ID_DA_PLANILHA_DE_ESCALAS", "__PLANILHA_ID__").replace("GID_DA_ABA_HOJE", "__GID_HOJE__")
    log(arq, "Baixar aba HOJE: marcadores __PLANILHA_ID__ / __GID_HOJE__ (mesma planilha ESCALAS do lembrete)")

    ta = N["Tem Alerta?"]
    pos = ta.get("position", [0, 0])
    par = {"parameters": {"operation": "executeQuery", "query": SQL_PARAMS, "options": {}}, "name": "Carregar Parametros",
           "type": "n8n-nodes-base.postgres", "typeVersion": 2.6, "position": [pos[0] + 220, pos[1]],
           "credentials": {"postgres": {"name": "Postgres IXC State"}}}
    wf["nodes"].append(par)
    conn = wf["connections"]
    conn["Tem Alerta?"] = {"main": [[{"node": "Carregar Parametros", "type": "main", "index": 0}]]}
    conn["Carregar Parametros"] = {"main": [[{"node": "Avisar Grupo", "type": "main", "index": 0}]]}
    waha_http(N["Avisar Grupo"], "={{ " + PX + ".waha_url }}/api/sendText",
              "={{ JSON.stringify({ session: " + PX + ".waha_session, chatId: " + PX + ".grupo_automacao, "
              "text: $('Tem Alerta?').first().json.texto, linkPreview: false }) }}")
    log(arq, "Avisar Grupo: sendText WAHA no grupo_automacao (parametros do banco)")

    c = N["Montar Escala"]["parameters"]["jsCode"]
    rx = re.compile(r"    // A fórmula da aba HOJE tem o nome \"[^\"]+\" fixo[^\n]*\n    // \([^\n]*\n    const t2 = t\.replace\(/[^/]+/gi, '[^']*'\);")
    if not rx.search(c):
        raise SystemExit(f"[{arq}] Montar Escala: bloco da troca fixa de nome nao encontrado")
    c = rx.sub(lambda m: "    // Formatos: \"X atende Porto Belo e Tijucas\" | \"X em/atende Porto Belo e Y em/atende Tijucas\" | \"Ninguém\".\n"
               "    // (A troca fixa de nome que existia aqui foi removida em 27/10/2026: a formula da aba HOJE foi corrigida em 03/10.)\n"
               "    const t2 = t;", c)
    N["Montar Escala"]["parameters"]["jsCode"] = c
    log(arq, "Montar Escala: removida a troca fixa de nome (regra morta)")
    for n in wf["nodes"]:
        if n["type"].endswith(".code"):
            n["parameters"]["jsCode"] = limpar_comentarios(n["parameters"]["jsCode"])
    wf["name"] = "Escalas - Sync planilha ESCALAS (aba HOJE) (WAHA)"
    return wf


# ----------------------------------------------------------------------------- banco
def adaptar_sql_estrutura(txt):
    txt = re.sub(r"^\\(un)?restrict .*\n", "", txt, flags=re.M)
    for old, new in VAL.get("comentarios", []):
        txt = txt.replace(old, new)
    txt = re.sub(r"\(([A-Z][a-z]+) (\d{2}/\d{2}/\d{4})\)", r"(regra de \2)", txt)
    txt = re.sub(r"regras do [A-Z][a-z]+ (\d{2}/\d{2}/\d{4})", r"regras da coordenação, \1", txt)
    txt = txt.replace(' / Hermes', '')
    return txt


def adaptar_sql_config(txt):
    txt = re.sub(r"^\\(un)?restrict .*\n", "", txt, flags=re.M)
    cab_old = txt[:txt.index("-- Log (eventos)")]
    cab_new = ("-- Automacao IXC -> WhatsApp (WAHA): CONFIGURACAO (empresas/IXCs, shoppings e grupos, tecnicos, funcionarios,\n"
               "-- parametros, escala base por shopping, contatos por setor, feriados). Rodar depois do 01:  psql -d <BANCO> -f 02_configuracao_atual.sql\n"
               "-- Adaptado em 27/10/2026 a partir da configuracao de 05/10/2026 (Evolution API -> WAHA; sem Hermes).\n"
               "--\n"
               "-- ANTES DE RODAR, TROCAR:\n"
               "--   'Basic COLE_AQUI_O_BASE64_DE_IDUSUARIO:TOKEN'  -> em cada IXC (tabela empresas): base64 de \"<id usuario API>:<token>\"\n"
               "--   waha_session                                   -> nome da sessao do WAHA (a mesma do lembrete diario)\n"
               "--   grupo_automacao                                -> JID do grupo onde os comandos \"ixc\" e os avisos de sistema saem\n"
               "-- A chave do WAHA NAO fica no banco: esta na credencial 'WAHA API' do n8n.\n"
               "-- DEPOIS DE RODAR: atualizar empresas.last_evento_id para o maior id atual de su_oss_chamado_mensagem de cada IXC\n"
               "--   (senao a automacao reenvia eventos antigos). Ver o README.\n")
    txt = cab_new + txt[len(cab_old):]
    linhas = []
    for l in txt.splitlines(keepends=True):
        if re.match(r"INSERT INTO ixc\.parametros .*VALUES \('(evolution_apikey|evolution_url|hermes_token)'", l):
            continue
        linhas.append(l)
    txt = "".join(linhas)
    extra = (
        "INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('waha_url', 'http://waha:3000', 'Endereco do WAHA visto pelo n8n (mesma rede Docker)');\n"
        f"INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('waha_session', '{VAL['waha_session']}', 'Sessao do WAHA pareada com o numero remetente');\n"
        f"INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('grupo_automacao', '{VAL['grupo_automacao']}', 'Grupo (JID) dos comandos ixc e dos avisos do sistema');\n"
        f"INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('supervisor_nome', '{VAL['supervisor_nome']}', 'Nome exibido para supervisor_fone');\n"
        f"INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('coordenador_nome', '{VAL['coordenador_nome']}', 'Nome exibido para coordenador_fone');\n"
        "INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('planta_ativo', 'nao', 'sim = manda o recorte da planta (servico planta-loja no ar); nao = so texto');\n"
        "INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('envio', 'NENHUM', 'Modo dos workflows 01/02: NENHUM (so avanca o estado, nao manda), SIMULAR (manda tudo para envio_teste_para) ou REAL');\n"
        f"INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('envio_teste_para', '{VAL['envio_teste_para']}', 'Numero que recebe as mensagens no modo SIMULAR');\n"
    )
    marca = "INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('setores_grupo'"
    i = txt.index(marca)
    j = txt.index("\n", i) + 1
    txt = txt[:j] + extra + txt[j:]
    return txt


# ----------------------------------------------------------------------------- fontes
def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_")


def extrair_fontes(wf, pasta, titulo):
    os.makedirs(pasta, exist_ok=True)
    for n in wf["nodes"]:
        p = n.get("parameters", {})
        if "jsCode" in p:
            with open(os.path.join(pasta, slug(n["name"]) + ".js"), "w") as f:
                f.write(f"// Workflow: {titulo}\n// No: {n['name']}\n\n{p['jsCode']}\n")
        elif n["type"].endswith(".postgres") and p.get("query"):
            with open(os.path.join(pasta, slug(n["name"]) + ".sql"), "w") as f:
                f.write(f"-- Workflow: {titulo}\n-- No: {n['name']}\n\n{p['query']}\n")


def main():
    global VAL
    src, dst = sys.argv[1], sys.argv[2]
    VAL = carregar_valores(sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "valores.json"))
    os.makedirs(os.path.join(dst, "n8n"), exist_ok=True)
    os.makedirs(os.path.join(dst, "banco"), exist_ok=True)
    fn = {"01": adaptar_01, "02": adaptar_02, "03": adaptar_03, "04": adaptar_04}
    for arq in sorted(os.listdir(os.path.join(src, "n8n"))):
        k = arq[:2]
        if k not in fn:
            continue
        wf = json.load(open(os.path.join(src, "n8n", arq), encoding="utf-8"))
        wf = fn[k](wf, arq)
        wf["active"] = False
        wf.pop("pinData", None); wf.pop("staticData", None)
        with open(os.path.join(dst, "n8n", arq), "w", encoding="utf-8") as f:
            json.dump(wf, f, ensure_ascii=False, indent=1)
            f.write("\n")
        extrair_fontes(wf, os.path.join(dst, "fontes", arq[:-5]), wf["name"])
    e = open(os.path.join(src, "banco", "01_estrutura_schema_ixc.sql"), encoding="utf-8").read()
    open(os.path.join(dst, "banco", "01_estrutura_schema_ixc.sql"), "w", encoding="utf-8").write(adaptar_sql_estrutura(e))
    log("banco/01_estrutura_schema_ixc.sql", "sem \\restrict; comentarios sem nomes")
    c = open(os.path.join(src, "banco", "02_configuracao_atual.sql"), encoding="utf-8").read()
    open(os.path.join(dst, "banco", "02_configuracao_atual.sql"), "w", encoding="utf-8").write(adaptar_sql_config(c))
    log("banco/02_configuracao_atual.sql", "parametros waha_url/waha_session/grupo_automacao/supervisor_nome/coordenador_nome/planta_ativo; removidos evolution_*/hermes_token; sem \\restrict")
    with open(os.path.join(dst, "RELATORIO.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(relatorio) + "\n")
    print("\n".join(relatorio))


if __name__ == "__main__":
    main()
