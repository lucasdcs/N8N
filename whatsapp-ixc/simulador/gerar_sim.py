#!/usr/bin/env python3
"""Gera as copias "[SIM]" dos 4 workflows do whatsapp-ixc para o n8n de TESTE, ligadas ao simulador.

  python3 gerar_sim.py <pasta com os 4 JSON de producao> <pasta de saida>

O que muda em relacao a producao (o resto do codigo e o mesmo, para testar de verdade):
  - nome "[SIM] ...", id fixo (reimportar substitui), inativo;
  - IXC: as URLs das empresas viram http://ixc-simulador:3999/ixc/<empresa> (fixo no no "Empresas");
  - WAHA: todo envio vai para http://ixc-simulador:3999 (fixo; o waha_url do banco nao e usado);
  - planta da loja: http://ixc-simulador:3999/planta (imagem de exemplo);
  - sem credencial do WAHA (o simulador nao pede chave); Postgres = credencial "Postgres SIMULADOR" (banco de teste);
  - webhook do WF 03 em /webhook/sim-ixc-whatsapp (nao conflita com o da producao/teste);
  - WF 01, 02 e 04 ganham um webhook "Rodar agora (simulador)" (/webhook/sim-rodar-0N), alem do horario normal
    (vai direto ao "Carregar Config"/"Baixar aba HOJE": os botoes do simulador nao passam pela trava de rodada da 0.6.5);
  - 0.6.5: o "Rodar agora (painel)" vira /webhook/sim-painelbot-rodar-0N.
No fim confere que NENHUM no HTTP aponta para fora do simulador (exceto a planilha do Google no WF 04, so leitura).
"""
import json, os, re, sys

SIM = "http://ixc-simulador:3999"
CRED_PG = {"id": "SimIxcPostgres01", "name": "Postgres SIMULADOR"}
IDS = {"01": "SimIxcWf01Avisos", "02": "SimIxcWf02Lembre", "03": "SimIxcWf03Comand", "04": "SimIxcWf04Escala"}


def troca(txt, velho, novo, onde, minimo=1):
    n = txt.count(velho)
    assert n >= minimo, "%s: trecho nao encontrado: %r" % (onde, velho[:90])
    return txt.replace(velho, novo)


def no(wf, nome):
    for n in wf["nodes"]:
        if n["name"] == nome:
            return n
    raise AssertionError("no nao encontrado: " + nome)


def gatilho_rodar(wf, k, alvo, pos):
    nome = "Rodar agora (simulador)"
    wf["nodes"].append({"parameters": {"httpMethod": "POST", "path": "sim-rodar-" + k, "responseMode": "onReceived", "options": {}},
                        "name": nome, "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": pos, "webhookId": "sim-rodar-" + k})
    wf["connections"][nome] = {"main": [[{"node": alvo, "type": "main", "index": 0}]]}


def converter(k, wf):
    wf["id"] = IDS[k]
    wf["name"] = "[SIM] " + wf["name"]
    wf["active"] = False
    for n in wf["nodes"]:
        p = n["parameters"]
        cred = n.get("credentials") or {}
        if "postgres" in cred:
            cred["postgres"] = dict(CRED_PG)
        if n["type"].endswith("httpRequest"):
            if "httpHeaderAuth" in cred:
                del cred["httpHeaderAuth"]
                p["authentication"] = "none"
                p.pop("genericAuthType", None)
            if not cred:
                n.pop("credentials", None)
            u = p.get("url", "")
            u = u.replace("$('Carregar Parametros').first().json.waha_url", "'" + SIM + "'")
            u = re.sub(r"=\{\{ \(typeof \$\('Carregar Config'\)\.first\(\)\.json\.cfg === 'string' \? JSON\.parse\(\$\('Carregar Config'\)\.first\(\)\.json\.cfg\) : \$\('Carregar Config'\)\.first\(\)\.json\.cfg\)\.param\.waha_url \}\}",
                       "=" + SIM, u)
            u = u.replace("http://planta-loja:3100", SIM)
            if u.startswith("={{ '" + SIM + "' }}"):
                u = "=" + SIM + u[len("={{ '" + SIM + "' }}"):]
            p["url"] = u
        if n["type"].endswith("webhook") and p.get("path", "").startswith("painelbot-rodar-"):   # whatsapp-ixc 0.6.5: "Rodar agora" do painel
            p["path"] = "sim-" + p["path"]
            n["webhookId"] = p["path"]
        if n["type"].endswith("webhook") and p.get("path") == "ixc-whatsapp":
            p["path"] = "sim-ixc-whatsapp"
            n["webhookId"] = "sim-ixc-whatsapp"
        c = p.get("jsCode")
        if c is not None:
            if n["name"] == "Empresas":
                c = troca(c, "base: e.base_url,", "base: '" + SIM + "/ixc/' + encodeURIComponent(e.id),", "Empresas")
                c = troca(c, "auth: e.auth,", "auth: 'Basic c2ltdWxhZG9y',", "Empresas")   # 'simulador': o token real nunca sai do banco
            c = c.replace("String(C.param.waha_url || 'http://waha:3000')", "String('" + SIM + "')")
            c = c.replace("String(P.waha_url || 'http://waha:3000')", "String('" + SIM + "')")
            p["jsCode"] = c
    trig = {"01": ("Carregar Config", [0, 480]), "02": ("Carregar Config", [0, 480]), "04": ("Baixar aba HOJE", [0, 200])}
    if k in trig:
        gatilho_rodar(wf, k, *trig[k])
    return wf


def conferir(k, wf):
    txt = json.dumps(wf, ensure_ascii=False)
    assert "wahaApiKey01" not in txt and "httpHeaderAuth" not in txt, k + ": sobrou credencial do WAHA"
    assert "Postgres IXC State" not in txt, k + ": sobrou credencial de producao"
    assert "waha:3000" not in txt and "planta-loja:3100" not in txt, k + ": sobrou endereco real"
    for n in wf["nodes"]:
        if n["type"].endswith("httpRequest"):
            u = n["parameters"]["url"]
            # Enviar WhatsApp: endpoint montado no "Anexar Planta" a partir do SIM fixo (conferido abaixo: nenhum Code le waha_url)
            ok = u == "={{ $json.endpoint }}" or u.startswith("=" + SIM) or u.startswith(SIM) or u.startswith("https://docs.google.com/spreadsheets/") \
                or (n["name"].startswith("Buscar") and "$('Empresas')" in u and u.endswith(tuple("/webservice/v1/" + t for t in ("su_oss_chamado_mensagem", "su_oss_chamado", "cliente", "su_oss_assunto"))))
            assert ok, "%s: URL fora do simulador em %s: %s" % (k, n["name"], u)
            assert "waha_url" not in u and "base_url" not in u, "%s: %s ainda usa o banco: %s" % (k, n["name"], u)
            if "docs.google.com" in u:
                assert n["parameters"].get("method", "GET") == "GET", k + ": planilha so pode ser leitura"
        if n["name"] == "Empresas":
            assert "e.base_url" not in n["parameters"]["jsCode"] and "e.auth" not in n["parameters"]["jsCode"], k + ": Empresas ainda le base_url/auth"
        c = n["parameters"].get("jsCode") or ""
        assert "waha_url" not in c, "%s: %s ainda le waha_url" % (k, n["name"])
        if n["type"].endswith("webhook"):
            assert n["parameters"]["path"].startswith("sim-"), k + ": webhook sem prefixo sim-"


def main():
    ent, sai = sys.argv[1], sys.argv[2]
    os.makedirs(sai, exist_ok=True)
    arqs = sorted(f for f in os.listdir(ent) if re.match(r"0[1-4]_.*\.json$", f))
    assert len(arqs) == 4, "esperava 4 workflows em " + ent + ": " + str(arqs)
    for f in arqs:
        k = f[:2]
        wf = converter(k, json.load(open(os.path.join(ent, f), encoding="utf-8")))
        conferir(k, wf)
        with open(os.path.join(sai, "SIM_" + f), "w", encoding="utf-8") as o:
            json.dump(wf, o, ensure_ascii=False, indent=1)
            o.write("\n")
        print("ok", "SIM_" + f, "->", wf["name"])


if __name__ == "__main__":
    main()
