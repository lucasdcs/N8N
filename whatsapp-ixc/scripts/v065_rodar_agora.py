#!/usr/bin/env python3
"""whatsapp-ixc 0.6.5 — "Rodar agora" pelo Painel do Bot (painelbot 0.5.1) + trava de rodada nos WF 01, 02 e 04.

Aplica sobre a 0.6.4, no lugar. Acha os JSON em qualquer subpasta, com ou sem "SIM_":
  python3 scripts/v065_rodar_agora.py <pasta com n8n/ e fontes/ | /opt/ixc-simulador | pasta do zip de producao>

O que muda em cada um dos WF 01, 02 e 04 (o WF 03 ja e por webhook e nao muda):
  - webhook novo "Rodar agora (painel)" em /webhook/painelbot-rodar-0N (nas copias [SIM]: sim-painelbot-rodar-0N).
    So roda se o cabecalho x-painelbot-chave for igual ao parametro painel_rodar_chave (criado pelo painelbot/sql/01;
    vazio = ninguem roda). O painel le a chave do banco e chama o webhook a partir do servidor do GLPI.
  - trava de rodada: antes de "Carregar Config" (01, 02) ou "Baixar aba HOJE" (04), uma consulta grava a hora da rodada
    em ixc.parametros (chave rodada_wf0N) e so segue se a rodada anterior comecou ha mais de N minutos
    (01: 2 min, 02: 4 min, 04: 5 min). Vale para o horario normal e para o "Rodar agora": nunca duas rodadas juntas
    (sem aviso em dobro). Uma rodada agendada que cai logo depois de um "Rodar agora" e pulada; a seguinte roda.
  - usa so a tabela ixc.parametros que ja existe (INSERT ... ON CONFLICT): nao depende de migracao para nao parar o bot.
O webhook "Rodar agora (simulador)" das copias [SIM] (botoes do simulador) continua indo direto, sem a trava.
"""
import os, sys, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v030_mensagens_perguntas import no
from v042_vinculo_renomeado import achar, ler, gravar

ALVOS = {   # arquivo -> (k, no que hoje vem depois do gatilho, minutos da trava)
    "01_IXC_Notificacoes_WhatsApp.json": ("01", "Carregar Config", 2),
    "02_IXC_Lembretes_de_Visita.json": ("02", "Carregar Config", 4),
    "04_Escalas_Sync_Planilha.json": ("04", "Baixar aba HOJE", 5),
}
WEBHOOK = "Rodar agora (painel)"
TRAVA = "Trava da rodada"
TRAVA_P = "Trava da rodada (painel)"
SE = "Pode rodar?"


def sql_trava(k, minutos, com_chave):
    """Uma linha sempre (ok true/false), para o IF decidir. Hora gravada em texto ISO; valor estranho conta como livre."""
    chave = ("\n  WHERE EXISTS (SELECT 1 FROM ixc.parametros WHERE chave = 'painel_rodar_chave' AND valor <> '' AND valor = $1)"
             if com_chave else "")
    return ("-- 0.6.5: trava de rodada (nunca duas juntas) " + ("+ chave do painel" if com_chave else "") + "\n"
            "WITH t AS (\n"
            "  INSERT INTO ixc.parametros (chave, valor, descricao)\n"
            "  SELECT 'rodada_wf" + k + "', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "'0.6.5: inicio da ultima rodada do WF " + k + " (trava; nao editar)'" + chave + "\n"
            "  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor\n"
            "  WHERE CASE WHEN ixc.parametros.valor ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN ixc.parametros.valor::timestamptz ELSE '-infinity'::timestamptz END\n"
            "        < now() - interval '" + str(minutos) + " minutes'\n"
            "  RETURNING 1\n"
            ")\n"
            "SELECT (SELECT count(*) FROM t) > 0 AS ok, '" + ("painel" if com_chave else "horario") + "' AS origem")


def aplicar(wf, k, alvo, minutos, sim):
    nomes = {n["name"] for n in wf["nodes"]}
    assert WEBHOOK not in nomes and TRAVA not in nomes, "ja esta na 0.6.5"
    trig = [n for n in wf["nodes"] if n["type"].endswith("scheduleTrigger")]
    assert len(trig) == 1, "esperava 1 gatilho de horario"
    trig = trig[0]
    destinos = wf["connections"][trig["name"]]["main"][0]
    assert [d["node"] for d in destinos] == [alvo], "gatilho nao vai so para " + alvo + ": " + str(destinos)
    cfg = no(wf, "Carregar Config") if k != "04" else no(wf, "Carregar Trocas")   # mesma credencial do Postgres do bot
    cred = cfg["credentials"]
    x, y = trig["position"]
    path = ("sim-" if sim else "") + "painelbot-rodar-" + k

    def pg(nome, query, pos, extra=None):
        p = {"operation": "executeQuery", "query": query, "options": extra or {}}
        return {"parameters": p, "name": nome, "type": "n8n-nodes-base.postgres", "typeVersion": cfg["typeVersion"],
                "position": pos, "credentials": dict(cred), "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "whatsapp-ixc/0.6.5/" + k + "/" + nome))}

    wf["nodes"] += [
        {"parameters": {"httpMethod": "POST", "path": path, "responseMode": "onReceived", "options": {}},
         "name": WEBHOOK, "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [x, y - 200], "webhookId": path,
         "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "whatsapp-ixc/0.6.5/" + k + "/webhook"))},
        pg(TRAVA, sql_trava(k, minutos, False), [x + 200, y]),
        pg(TRAVA_P, sql_trava(k, minutos, True), [x + 200, y - 200],
           {"queryReplacement": "={{ String(($json.headers || {})['x-painelbot-chave'] || '-') }}"}),
        {"parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
                                       "conditions": [{"id": str(uuid.uuid5(uuid.NAMESPACE_URL, "whatsapp-ixc/0.6.5/" + k + "/se")),
                                                       "leftValue": "={{ $json.ok }}", "rightValue": "",
                                                       "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
                                       "combinator": "and"}, "options": {}},
         "name": SE, "type": "n8n-nodes-base.if", "typeVersion": 2, "position": [x + 400, y - 100],
         "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "whatsapp-ixc/0.6.5/" + k + "/if"))},
    ]
    liga = lambda n: {"main": [[{"node": n, "type": "main", "index": 0}]]}
    wf["connections"][trig["name"]] = liga(TRAVA)
    wf["connections"][WEBHOOK] = liga(TRAVA_P)
    wf["connections"][TRAVA] = liga(SE)
    wf["connections"][TRAVA_P] = liga(SE)
    wf["connections"][SE] = {"main": [[{"node": alvo, "type": "main", "index": 0}], []]}   # falso = nao faz nada
    # empurra o resto do fluxo para a direita, para os nos novos nao ficarem por cima
    for n in wf["nodes"]:
        if n["name"] not in (trig["name"], WEBHOOK, TRAVA, TRAVA_P, SE) and n["position"][0] >= x + 150:
            n["position"] = [n["position"][0] + 450, n["position"][1]]


def main():
    raiz = sys.argv[1]
    for arq, (k, alvo, minutos) in ALVOS.items():
        p = achar(raiz, arq)
        wf = ler(p)
        sim = os.path.basename(p).startswith("SIM_") or wf["name"].startswith("[SIM]")
        aplicar(wf, k, alvo, minutos, sim)
        gravar(raiz, p, wf)
    print("ok -> 0.6.5 (Rodar agora pelo painel + trava de rodada nos WF 01, 02 e 04)")


if __name__ == "__main__":
    main()
