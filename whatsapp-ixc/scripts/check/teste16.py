#!/usr/bin/env python3
"""whatsapp-ixc 0.6.5 — confere o v065 ("Rodar agora" do painel + trava de rodada).

  python3 scripts/check/teste16.py <pasta n8n 0.6.4> [psql de teste, ex.: "psql -h /tmp/pg -p 5499 -U ixc -d ixc"]

1) aplica o v065 numa copia da 0.6.4 de producao e numa copia [SIM] (gerar_sim.py), confere o desenho dos fluxos;
2) roda de novo: tem que recusar;
3) com o psql: a consulta da trava (sem e com chave) num banco com ixc.parametros.
"""
import copy, json, os, shutil, subprocess, sys, tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))
import v065_rodar_agora as V

ok = 0
falhas = []


def check(nome, cond, extra=""):
    global ok
    if cond:
        ok += 1
    else:
        falhas.append(nome)
        print("  ✘", nome, extra)


def destinos(wf, nome, saida=0):
    m = wf["connections"].get(nome, {}).get("main", [])
    return [d["node"] for d in (m[saida] if len(m) > saida else [])]


def conferir(rot, pasta, sim, antes):
    for arq, (k, alvo, minutos) in V.ALVOS.items():
        f = os.path.join(pasta, ("SIM_" if sim else "") + arq)
        wf = json.load(open(f, encoding="utf-8"))
        a = antes[arq]
        trig = [n for n in wf["nodes"] if n["type"].endswith("scheduleTrigger")][0]["name"]
        nomes = {n["name"]: n for n in wf["nodes"]}
        check(rot + k + " +4 nós", len(wf["nodes"]) == len(a["nodes"]) + 4)
        check(rot + k + " horário → trava → se → " + alvo, destinos(wf, trig) == [V.TRAVA] and destinos(wf, V.TRAVA) == [V.SE] and destinos(wf, V.SE) == [alvo])
        check(rot + k + " falso não faz nada", destinos(wf, V.SE, 1) == [])
        check(rot + k + " webhook → trava do painel → se", destinos(wf, V.WEBHOOK) == [V.TRAVA_P] and destinos(wf, V.TRAVA_P) == [V.SE])
        w = nomes[V.WEBHOOK]["parameters"]
        check(rot + k + " caminho do webhook", w["path"] == ("sim-" if sim else "") + "painelbot-rodar-" + k and w["httpMethod"] == "POST", w)
        tp = nomes[V.TRAVA_P]["parameters"]
        check(rot + k + " chave por parâmetro ($1), nunca no texto", "$1" in tp["query"] and "x-painelbot-chave" in tp["options"]["queryReplacement"] and "{{" not in tp["query"])
        check(rot + k + " minutos da trava", "interval '%d minutes'" % minutos in nomes[V.TRAVA]["parameters"]["query"])
        cred = [n for n in a["nodes"] if n["name"] == ("Carregar Trocas" if k == "04" else "Carregar Config")][0]["credentials"]
        check(rot + k + " mesma credencial do Postgres", nomes[V.TRAVA]["credentials"] == cred and nomes[V.TRAVA_P]["credentials"] == cred)
        # o resto do fluxo não mudou (só posição)
        tira = lambda l: sorted((json.dumps({x: n[x] for x in n if x != "position"}, sort_keys=True) for n in l), key=str)
        velhos = tira(a["nodes"])
        novos = tira([n for n in wf["nodes"] if n["name"] not in (V.WEBHOOK, V.TRAVA, V.TRAVA_P, V.SE)])
        check(rot + k + " nós antigos iguais", velhos == novos)
        con_a = {x: y for x, y in a["connections"].items() if x != trig}
        con_n = {x: y for x, y in wf["connections"].items() if x not in (trig, V.WEBHOOK, V.TRAVA, V.TRAVA_P, V.SE)}
        check(rot + k + " ligações antigas iguais", con_a == con_n)
        if sim:
            check(rot + k + " botão do simulador sem trava", destinos(wf, "Rodar agora (simulador)") == [alvo])
            check(rot + k + " todo webhook com sim-", all(n["parameters"]["path"].startswith("sim-") for n in wf["nodes"] if n["type"].endswith("webhook")))


def main():
    ent = sys.argv[1]
    psql = sys.argv[2] if len(sys.argv) > 2 else ""
    tmp = tempfile.mkdtemp()
    prod = os.path.join(tmp, "prod", "n8n")
    shutil.copytree(ent, prod)
    antes = {a: json.load(open(os.path.join(prod, a), encoding="utf-8")) for a in V.ALVOS}
    subprocess.run([sys.executable, os.path.join(AQUI, "..", "v065_rodar_agora.py"), os.path.join(tmp, "prod")], check=True, stdout=subprocess.DEVNULL)
    conferir("prod ", prod, False, antes)
    r = subprocess.run([sys.executable, os.path.join(AQUI, "..", "v065_rodar_agora.py"), os.path.join(tmp, "prod")], capture_output=True, text=True)
    check("segunda vez recusa", r.returncode != 0 and "ja esta na 0.6.5" in r.stderr)
    # [SIM] gerado da 0.6.4 e depois v065 (o caminho do /opt/ixc-simulador)
    sim = os.path.join(tmp, "sim", "n8n")
    subprocess.run([sys.executable, os.path.join(AQUI, "..", "..", "simulador", "gerar_sim.py"), ent, sim], check=True, stdout=subprocess.DEVNULL)
    antes_s = {a: json.load(open(os.path.join(sim, "SIM_" + a), encoding="utf-8")) for a in V.ALVOS}
    subprocess.run([sys.executable, os.path.join(AQUI, "..", "v065_rodar_agora.py"), os.path.join(tmp, "sim")], check=True, stdout=subprocess.DEVNULL)
    conferir("sim ", sim, True, antes_s)
    # [SIM] gerado da 0.6.5 de produção (gerar_sim renomeia o caminho)
    sim2 = os.path.join(tmp, "sim2")
    r = subprocess.run([sys.executable, os.path.join(AQUI, "..", "..", "simulador", "gerar_sim.py"), prod, sim2], capture_output=True, text=True)
    check("gerar_sim aceita a 0.6.5", r.returncode == 0, r.stderr[-300:])
    if r.returncode == 0:
        w1 = json.load(open(os.path.join(sim2, "SIM_01_IXC_Notificacoes_WhatsApp.json"), encoding="utf-8"))
        check("gerar_sim: sim-painelbot-rodar-01", any(n["parameters"].get("path") == "sim-painelbot-rodar-01" for n in w1["nodes"]))
        check("gerar_sim: botão do simulador sem trava", destinos(w1, "Rodar agora (simulador)") == ["Carregar Config"])

    if psql:
        sh = lambda q: subprocess.run(psql.split() + ["-At", "-v", "ON_ERROR_STOP=1"], input=q, capture_output=True, text=True)
        sh("DELETE FROM ixc.parametros WHERE chave IN ('rodada_wf01', 'painel_rodar_chave');")
        t = V.sql_trava("01", 2, False)
        r1, r2 = sh(t).stdout.strip(), sh(t).stdout.strip()
        check("sql: 1ª rodada roda, 2ª logo depois não", r1 == "t|horario" and r2 == "f|horario", r1 + " " + r2)
        sh("UPDATE ixc.parametros SET valor = '2020-01-01T00:00:00Z' WHERE chave = 'rodada_wf01';")
        check("sql: rodada velha libera", sh(t).stdout.strip() == "t|horario")
        sh("UPDATE ixc.parametros SET valor = 'lixo' WHERE chave = 'rodada_wf01';")
        check("sql: valor estranho não trava o bot", sh(t).stdout.strip() == "t|horario")
        tp = V.sql_trava("01", 2, True).split("\n", 1)[1]
        ex = lambda chave: sh("UPDATE ixc.parametros SET valor = '2020-01-01T00:00:00Z' WHERE chave = 'rodada_wf01';\nPREPARE x(text) AS " + tp + ";\nEXECUTE x('" + chave + "');").stdout.strip().split("\n")[-1]
        check("sql: sem chave cadastrada ninguém roda", ex("abc") == "f|painel")
        sh("INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('painel_rodar_chave', 'abc', 't');")
        check("sql: chave errada não roda", ex("xyz") == "f|painel")
        check("sql: chave certa roda", ex("abc") == "t|painel")
        sh("UPDATE ixc.parametros SET valor = '' WHERE chave = 'painel_rodar_chave';")
        check("sql: chave vazia ninguém roda", ex("") == "f|painel")
        sh("DELETE FROM ixc.parametros WHERE chave IN ('rodada_wf01', 'painel_rodar_chave');")
    shutil.rmtree(tmp)
    print("ok: %d falhas: %s" % (ok, json.dumps(falhas, ensure_ascii=False)))
    sys.exit(1 if falhas else 0)


if __name__ == "__main__":
    main()
