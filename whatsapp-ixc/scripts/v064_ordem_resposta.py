#!/usr/bin/env python3
"""whatsapp-ixc 0.6.4 — mensagem nova com {shopping} respondendo varios shoppings: linhas em ordem do TEXTO montado.

Aplica sobre a 0.6.3 (saida do v063_variaveis_shopping.py), no lugar. Acha os JSON em qualquer subpasta, com ou sem "SIM_":
  python3 scripts/v064_ordem_resposta.py <pasta com n8n/ e fontes/ | /opt/ixc-simulador | pasta do zip de producao>

Pedido de 25/11: "Holding do {shopping}" sem shopping reconhecido listava em ordem de nome do shopping; com o texto
"{holding} - {shopping}" o certo e agrupar pela holding. Regra: quando a resposta tem mais de um shopping (todos ou
apelido de cidade), as linhas/blocos sao ordenados pelo texto ja montado (pt-BR, sem diferenca de maiuscula/acento,
numeros em ordem natural). O que vem primeiro no texto agrupa: "{holding} - {shopping}" agrupa por holding e, dentro
dela, por shopping. So o WF 03 "Escala: Montar Resposta".
"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v030_mensagens_perguntas import troca, no
from v042_vinculo_renomeado import achar, ler, gravar, W03

VELHO = "    const partes_ = locs_.map(l => M('__resp__', corpo0_, Object.assign(varsDe_(l), { shopping: l.nome }))).filter(x => x.trim());"
NOVO = (VELHO[:-1] + "\n"
        "      // 0.6.4: ordem do texto montado (o que vem primeiro agrupa: \"{holding} - {shopping}\" = por holding)\n"
        "      .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true }));")


def main():
    raiz = sys.argv[1]
    p3 = achar(raiz, W03)
    wf = ler(p3)
    n = no(wf, "Escala: Montar Resposta")
    c = n["parameters"]["jsCode"]
    assert "varsDe_" in c, "WF 03 ainda nao esta na 0.6.3 (rode o v063 antes)"
    assert "0.6.4: ordem" not in c, "WF 03 ja esta na 0.6.4"
    n["parameters"]["jsCode"] = troca(c, VELHO, NOVO, "Montar Resposta")
    gravar(raiz, p3, wf)
    print("ok -> 0.6.4 (varios shoppings: ordem do texto montado)")


if __name__ == "__main__":
    main()
