#!/usr/bin/env python3
"""whatsapp-ixc 0.6.1 — trava de eventos antigos e ritmo de envio do WF 01 (anti-bloqueio).

Incidente de 24/11/2026: o WF 01 de producao estava despublicado; ao publicar a 0.6.0, o last_evento_id parado fez a
rodada ler o historico acumulado (ate 200 eventos por base a cada 3 min) e mandar chamados ja tratados no particular.

  - Processar Eventos: evento de O.S. (su_oss_chamado_mensagem.data) que NAO e de hoje (horario de Brasilia) ou que tem
    mais de aviso_max_idade_min minutos (padrao 60; 0 = so a regra do dia) e descartado — nao avisa nem gera pedido de
    infra. O last_evento_id avanca do mesmo jeito (Calcular Estado le a resposta bruta). Evento sem data valida passa.
  - Rotear: no maximo aviso_max_rodada avisos por rodada (padrao 10); o excedente fica em ixc.eventos como ignorado
    ("limite de N avisos por rodada"). So vale para o que ia ser enviado.
  - Pendentes: no maximo reenvio_max_rodada reenvios por rodada (padrao 5).
  - Enviar/Reenviar WhatsApp: 1 mensagem a cada 8 s (antes 1,5 s). 15 mensagens = 2 min, dentro da rodada de 3 min.

Aplica no lugar, sobre o WF 01 da 0.6.0 (producao ou linha 0.5.0 / simulador):
  python3 scripts/v061_trava_antigos.py <pasta com n8n/ | /opt/ixc-simulador | arquivo .json do WF 01>
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v030_mensagens_perguntas import troca, no
from v042_vinculo_renomeado import achar, ler, gravar, W01

MARCA = "aviso_max_idade_min"
INTERVALO_MS = 8000

PE_VELHO = "const out = [];\nemps.forEach((e, k) => {"
PE_NOVO = """// 0.6.1: so eventos de hoje (BRT) e com ate aviso_max_idade_min minutos (padrao 60; 0 = so o dia). Sem data valida passa.
const maxIdade_ = P.aviso_max_idade_min === undefined || P.aviso_max_idade_min === null || P.aviso_max_idade_min === '' ? 60 : +P.aviso_max_idade_min;
const hoje_ = agoraBRT().slice(0, 10);
function antigo_(m) {
  const d = String((m && m.data) || '').trim();
  if (!/^\\d{4}-\\d{2}-\\d{2} \\d{1,2}:\\d{2}/.test(d) || d.startsWith('0000')) return false;
  if (d.slice(0, 10) !== hoje_) return true;
  return maxIdade_ > 0 && (agoraMs - paraData(d)) / 60000 > maxIdade_;
}
const out = [];
emps.forEach((e, k) => {"""
LOOP_VELHO = "  for (const m of (r.registros || [])) {\n"
LOOP_NOVO = "  for (const m of (r.registros || [])) {\n    if (antigo_(m)) continue;  // 0.6.1: evento antigo (historico parado) nao avisa\n"

RO_VELHO = "  }) });\n}\nreturn out;"
RO_NOVO = """  }) });
}
// 0.6.1: no maximo aviso_max_rodada avisos por rodada (anti-bloqueio); o excedente fica registrado como ignorado
const MAXR_ = C.param.aviso_max_rodada === undefined || C.param.aviso_max_rodada === '' ? 10 : +C.param.aviso_max_rodada;
let envR_ = 0;
for (const o of out) {
  if (o.json.ignorado) continue;
  if (++envR_ > MAXR_) {
    const j = o.json;
    o.json = { empresa: j.empresa, id_chamado: j.id_chamado, protocolo: j.protocolo, evento: j.evento, ignorado: true, motivo: 'limite de ' + MAXR_ + ' avisos por rodada (anti-bloqueio)' };
  }
}
return out;"""

PEN_VELHO = "!(PRIV_ && /@g\\.us$/.test(String(p.grupo || '')))).map("
PEN_NOVO = ("!(PRIV_ && /@g\\.us$/.test(String(p.grupo || ''))))"
            ".slice(0, C.param.reenvio_max_rodada === undefined || C.param.reenvio_max_rodada === '' ? 5 : +C.param.reenvio_max_rodada).map(")  # 0.6.1


def aplicar(wf):
    pe = no(wf, "Processar Eventos")
    c = pe["parameters"]["jsCode"]
    assert MARCA not in c, "WF 01 ja esta na 0.6.1"
    ro = no(wf, "Rotear")
    assert "aviso_privado" in ro["parameters"]["jsCode"], "WF 01 ainda nao esta na 0.6.0 (rode o v060 antes)"
    c = troca(c, PE_VELHO, PE_NOVO, "Processar Eventos")
    c = troca(c, LOOP_VELHO, LOOP_NOVO, "Processar Eventos")
    pe["parameters"]["jsCode"] = c
    ro["parameters"]["jsCode"] = troca(ro["parameters"]["jsCode"], RO_VELHO, RO_NOVO, "Rotear")
    p = no(wf, "Pendentes")
    p["parameters"]["jsCode"] = troca(p["parameters"]["jsCode"], PEN_VELHO, PEN_NOVO, "Pendentes")
    for nome in ("Enviar WhatsApp", "Reenviar WhatsApp"):
        b = no(wf, nome)["parameters"]["options"]["batching"]["batch"]
        assert b.get("batchSize") == 1, nome + ": batchSize inesperado"
        b["batchInterval"] = INTERVALO_MS


def main():
    alvo = sys.argv[1]
    solto = alvo.endswith(".json") and os.path.isfile(alvo)
    raiz, p = (os.path.dirname(os.path.abspath(alvo)), alvo) if solto else (alvo, achar(alvo, W01))
    wf = ler(p)
    aplicar(wf)
    if solto:
        with open(p, "w", encoding="utf-8") as f:
            json.dump(wf, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("  gravado:", p)
    else:
        gravar(raiz, p, wf)
    print("ok", os.path.basename(p), "-> 0.6.1 (so eventos de hoje, limite por rodada, 8 s entre mensagens)")


if __name__ == "__main__":
    main()
