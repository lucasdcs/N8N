#!/usr/bin/env python3
"""whatsapp-ixc 0.4.0 — apelidos de shopping editaveis pelo Painel do Bot (tabela ixc.apelidos).

Aplica sobre a 0.3.0 (saida do v030_mensagens_perguntas.py), no lugar:
  python3 scripts/v040_apelidos.py <pasta com n8n/ e fontes/>

WF 03, no "Escala: Montar Resposta": os apelidos ("quem esta no <apelido>?") passam a vir de ixc.apelidos
(carregados no "Escala: Buscar Dados"). Tabela vazia = os apelidos fixos de antes (o painelbot/sql/01 carrega
os mesmos na tabela, entao sem edicao a resposta e igual). Pelotas (sem contrato) continua fixo.
Exige a tabela ixc.apelidos (painelbot/sql/01-mensagens-perguntas.sql da 0.3.0 do painel).
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v021_lembrete_particular import extrair_fontes
from v030_mensagens_perguntas import troca, no

ARQ = "03_IXC_Comandos_e_Consulta_de_Escala.json"
GEN_VELHO = "const GENERICOS = ['curitiba'];  // so vale se nenhum shopping especifico foi citado"
GEN_NOVO = GEN_VELHO + """
// 0.4.0 (Painel do Bot): apelidos de ixc.apelidos, editados no painel. Banco sem apelidos = os fixos acima.
const AP_ = Array.isArray(cfg.apelidos) ? cfg.apelidos : [];
if (AP_.length) {
  for (const k of Object.keys(ALIAS)) if (k !== 'PELOTAS') delete ALIAS[k];
  GENERICOS.length = 0;
  for (const a of AP_) {
    const k = (Array.isArray(a.alvos) ? a.alvos : []).join('|'), ap = String(a.a || '').replace(/[^a-z0-9 ]/g, ' ').replace(/\\s+/g, ' ').trim();
    if (!k || !ap) continue;
    (ALIAS[k] = ALIAS[k] || []).push(ap);
    if (a.g) GENERICOS.push(ap);
  }
}"""
Q_VELHO = """,
 'mensagens', (SELECT coalesce(json_object_agg(m.chave, m.texto), '{}'::json) FROM ixc.mensagens m WHERE m.texto IS NOT NULL)
) AS cfg"""
Q_NOVO = """,
 'mensagens', (SELECT coalesce(json_object_agg(m.chave, m.texto), '{}'::json) FROM ixc.mensagens m WHERE m.texto IS NOT NULL),
 'apelidos', (SELECT coalesce(json_agg(json_build_object('a', a.apelido_norm, 'alvos', a.alvos, 'g', a.generico)), '[]'::json) FROM ixc.apelidos a)
) AS cfg"""


def main():
    raiz = sys.argv[1]
    p = os.path.join(raiz, "n8n", ARQ)
    wf = json.load(open(p, encoding="utf-8"))
    n = no(wf, 'Escala: Buscar Dados')
    n['parameters']['query'] = troca(n['parameters']['query'], Q_VELHO, Q_NOVO, 'Escala: Buscar Dados')
    n = no(wf, 'Escala: Montar Resposta')
    assert 'AP_' not in n['parameters']['jsCode'], 'WF 03 ja esta na 0.4.0'
    n['parameters']['jsCode'] = troca(n['parameters']['jsCode'], GEN_VELHO, GEN_NOVO, 'Escala: Montar Resposta')
    with open(p, "w", encoding="utf-8") as f:
        json.dump(wf, f, ensure_ascii=False, indent=1)
        f.write("\n")
    if os.path.isdir(os.path.join(raiz, "fontes")):
        extrair_fontes(wf, os.path.join(raiz, "fontes", ARQ[:-5]), wf["name"])
    print("ok", ARQ, "-> 0.4.0 (apelidos do painel)")


if __name__ == "__main__":
    main()
