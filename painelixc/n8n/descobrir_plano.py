#!/usr/bin/env python3
# Painel IXC — de onde vem o "Plano" do cliente? (SÓ LEITURA no IXC; não mostra senhas)
# Uso: python3 descobrir_plano.py <base> <id_cliente>      ex.: python3 descobrir_plano.py buzz 42237
import base64, getpass, json, re, ssl, sys, urllib.request
URLS = {"resolutto": "https://ixc.resolutto.com.br", "4btelecom": "https://ixc.4btelecom.com.br",
        "ponto": "https://ixc.pontotelecom.com", "cacta": "https://ixc.cactatelecom.com.br",
        "buzz": "https://ixc.buzztelecom.com.br"}
if len(sys.argv) < 3 or sys.argv[1] not in URLS or not sys.argv[2].isdigit():
    sys.exit("uso: python3 descobrir_plano.py <base> <id_cliente>")
BASE, CLI = URLS[sys.argv[1]], sys.argv[2]
AUTH = "Basic " + base64.b64encode(getpass.getpass("Token %s (id:hash): " % sys.argv[1]).strip().encode()).decode()

def listar(tab, col, valor, oper="="):
    corpo = {"qtype": tab + "." + col, "query": str(valor), "oper": oper, "page": "1", "rp": "50",
             "sortname": tab + ".id", "sortorder": "asc"}
    req = urllib.request.Request("%s/webservice/v1/%s" % (BASE, tab), data=json.dumps(corpo).encode(), method="POST",
                                 headers={"Authorization": AUTH, "Content-Type": "application/json", "ixcsoft": "listar"})
    try:
        with urllib.request.urlopen(req, timeout=40, context=ssl.create_default_context()) as r:
            txt = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", r.read().decode("utf-8", "replace")).lstrip("﻿")
        return json.loads(txt)
    except Exception as e:
        return {"erro": str(e)[:300]}

SEGREDO = re.compile(r"senha|password|pass|secret|token|hash|chave", re.I)
INTERESSE = re.compile(r"plano|grupo|contrato|velocidade|download|upload|banda|perfil|nome|descricao|login|ativo|status", re.I)

def mostra(titulo, r, campos):
    print("\n=== " + titulo)
    if "erro" in r or r.get("type") == "error":
        print("  ERRO:", r.get("erro") or r.get("message")); return []
    regs = r.get("registros") or []
    print("  total:", r.get("total"))
    for x in regs[:10]:
        print("  -", {k: x.get(k) for k in campos if k in x})
    if regs:
        print("  campos que parecem plano/grupo/contrato:",
              sorted(k for k in regs[0] if INTERESSE.search(k) and not SEGREDO.search(k)))
    return regs

logins = mostra("Logins do cliente %s (radusuarios)" % CLI, listar("radusuarios", "id_cliente", CLI),
                ["id", "login", "ativo", "id_contrato", "id_grupo", "id_plano", "plano"])
grupos = sorted({str(l.get("id_grupo")) for l in logins if str(l.get("id_grupo") or "0") != "0"})
for g in grupos:
    mostra("Grupo/plano %s (radgrupos)" % g, listar("radgrupos", "id", g), ["id", "grupo", "descricao", "nome", "download", "upload"])
mostra("Contratos do cliente %s (cliente_contrato)" % CLI, listar("cliente_contrato", "id_cliente", CLI),
       ["id", "contrato", "status", "id_vd_contrato", "descricao_aux_plano_venda"])
print("\nNada foi alterado no IXC.")
