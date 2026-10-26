#!/usr/bin/env python3
# Painel IXC — de onde vem o "Setor" do atendimento? (SÓ LEITURA no IXC; não mostra senhas)
# Uso: python3 descobrir_setor_atendimento.py <base> <protocolo ou id do atendimento> [mais ...]
#  ex.: python3 descobrir_setor_atendimento.py 4btelecom 202609815 202609839 20261014160358707136
# Hoje o painel usa su_ticket.id_ticket_setor (ou su_ticket.setor) e busca o nome em empresa_setor (a tabela de setores das O.S.).
# Este script mostra, para cada atendimento, todos os campos de setor/departamento e o nome de cada id em cada tabela candidata.
import base64, getpass, json, re, ssl, sys, urllib.request
URLS = {"resolutto": "https://ixc.resolutto.com.br", "4btelecom": "https://ixc.4btelecom.com.br",
        "ponto": "https://ixc.pontotelecom.com", "cacta": "https://ixc.cactatelecom.com.br",
        "buzz": "https://ixc.buzztelecom.com.br"}
if len(sys.argv) < 3 or sys.argv[1] not in URLS:
    sys.exit("uso: python3 descobrir_setor_atendimento.py <base> <protocolo|id> [...]")
BASE = URLS[sys.argv[1]]
AUTH = "Basic " + base64.b64encode(getpass.getpass("Token %s (id:hash): " % sys.argv[1]).strip().encode()).decode()
SEGREDO = re.compile(r"senha|password|pass|secret|token|hash|chave", re.I)
CAMPO_SETOR = re.compile(r"setor|depart|fila|grupo|equipe", re.I)
TABELAS_NOME = [("empresa_setor", ["setor", "descricao", "nome"]), ("su_ticket_setor", ["setor", "descricao", "nome"]),
                ("su_ticket_departamento", ["departamento", "descricao", "nome"]), ("departamento", ["departamento", "descricao", "nome"])]

def listar(tab, col, valor, oper="=", rp="20"):
    corpo = {"qtype": tab + "." + col, "query": str(valor), "oper": oper, "page": "1", "rp": rp,
             "sortname": tab + ".id", "sortorder": "desc"}
    req = urllib.request.Request("%s/webservice/v1/%s" % (BASE, tab), data=json.dumps(corpo).encode(), method="POST",
                                 headers={"Authorization": AUTH, "Content-Type": "application/json", "ixcsoft": "listar"})
    try:
        with urllib.request.urlopen(req, timeout=40, context=ssl.create_default_context()) as r:
            txt = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", r.read().decode("utf-8", "replace")).lstrip("﻿")
        return json.loads(txt)
    except Exception as e:
        return {"type": "error", "message": str(e)[:300]}

cache = {}
def nome_em(tab, campos, ident):
    if not ident or str(ident) in ("0", ""):
        return "-"
    k = (tab, str(ident))
    if k not in cache:
        r = listar(tab, "id", ident, rp="1")
        if r.get("type") == "error":
            cache[k] = "(tabela indisponível: %s)" % (r.get("message") or "")[:80]
        else:
            reg = (r.get("registros") or [None])[0]
            cache[k] = next((str(reg[c]) for c in campos if reg and reg.get(c)), "(id não existe)") if reg else "(id não existe)"
    return cache[k]

for alvo in sys.argv[2:]:
    print("\n" + "=" * 70)
    r = listar("su_ticket", "protocolo", alvo)
    regs = r.get("registros") or []
    if not regs and alvo.isdigit():
        r = listar("su_ticket", "id", alvo)
        regs = r.get("registros") or []
    if r.get("type") == "error" or not regs:
        print("Atendimento %s: não encontrado (%s)" % (alvo, r.get("message") or "sem registros"))
        continue
    t = regs[0]
    print("Atendimento id=%s protocolo=%s assunto=%s status=%s/%s" % (t.get("id"), t.get("protocolo"), t.get("id_assunto"), t.get("su_status"), t.get("status")))
    print("  campos de setor/departamento no su_ticket:")
    for k in sorted(t):
        if CAMPO_SETOR.search(k) and not SEGREDO.search(k):
            v = t.get(k)
            nomes = "  |  ".join("%s=%s" % (tab, nome_em(tab, c, v)) for tab, c in TABELAS_NOME) if str(v).isdigit() else ""
            print("    %-28s = %-6s %s" % (k, v, nomes))
    resp = t.get("id_responsavel_tecnico")
    if resp and str(resp) != "0":
        f = (listar("funcionarios", "id", resp, rp="1").get("registros") or [{}])[0]
        print("  responsável %s = %s" % (resp, f.get("funcionario")))
        for k in sorted(f):
            if CAMPO_SETOR.search(k) and not SEGREDO.search(k):
                print("    funcionarios.%-18s = %-6s empresa_setor=%s" % (k, f.get(k), nome_em("empresa_setor", ["setor"], f.get(k))))
    print("  O PAINEL MOSTRA: id_setor = %s → empresa_setor = %s" % (
        t.get("id_ticket_setor") or t.get("setor"), nome_em("empresa_setor", ["setor"], t.get("id_ticket_setor") or t.get("setor"))))
print("\nNada foi alterado no IXC.")
