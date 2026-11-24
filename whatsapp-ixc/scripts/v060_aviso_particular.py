#!/usr/bin/env python3
"""whatsapp-ixc 0.6.0 — avisos de chamado (WF 01) so no PARTICULAR do tecnico atribuido; nada mais vai para grupo.

Pedido de 24/11/2026 (evitar spam nos grupos):
  - chamado com tecnico atribuido (aberto, transferido, assumido) -> particular do tecnico (chatId <tecnicos.fone>@c.us),
    sem @ e sem copia no grupo. A planta da loja continua indo junto (Ativacao/Vistoria).
  - "chamado assumido" -> nao sai (o tecnico seria avisado do que ele mesmo fez). Aberto e transferido saem.
  - chamado SEM tecnico atribuido -> nao notifica (os avisos "sem tecnico", "segue sem tecnico" e "escalado" nao saem).
  - pedido de infra escrito na O.S. (ia para o grupo do responsavel pela infra) -> particular do responsavel pela infra,
    parametro ixc.parametros.infra_fone (55 + DDD + numero). Sem infra_fone valido -> nao sai.
  - atribuido ao dono do numero, pessoa fora de ixc.tecnicos ou tecnico sem telefone (< 12 digitos) -> nao sai.
  - tecnico de folga: nao marca mais o plantao (o aviso vai so para quem esta atribuido, sem a linha de folga).
  - reenvio (Pendentes): falha antiga com destino em grupo (@g.us) nao e reenviada.
  Tudo que nao sai fica em ixc.eventos como 'ignorado', com o motivo (relatorio e "Ultimos envios" mostram).
  Parametro ixc.parametros.aviso_privado: 'nao' volta ao comportamento anterior (grupos). Ausente = 'sim'.

Aplica no lugar, sobre o WF 01 de qualquer versao a partir da 0.2.0 (producao 0.2.x ou a linha 0.5.0):
  python3 scripts/v060_aviso_particular.py <pasta com n8n/ e fontes/ | /opt/ixc-simulador | pasta do zip de producao>
  python3 scripts/v060_aviso_particular.py <arquivo .json do WF 01 exportado do n8n>
Falha alto (AssertionError) se o codigo nao for o esperado; so grava depois que todas as trocas deram certo.
"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v030_mensagens_perguntas import troca, no
from v042_vinculo_renomeado import achar, ler, gravar, W01

MARCA = "aviso_privado"

# ---------- Rotear ----------
INI_VELHO = "const C = carregarConfig();\nconst agoraMs = paraData(agoraBRT());\nconst items = $input.all();\nconst porChamado = new Map();"
INI_NOVO = ("const C = carregarConfig();\n"
            "// 0.6.0 (24/11/2026): avisos so no particular do tecnico atribuido; nada em grupo. aviso_privado = 'nao' volta aos grupos.\n"
            "const PRIVADO_ = String(C.param.aviso_privado || 'sim').trim().toLowerCase() !== 'nao';\n"
            "const agoraMs = paraData(agoraBRT());\nconst items = $input.all();\nconst porChamado = new Map();")

# pessoa atribuida sem shopping e sem grupo: no particular ainda da para avisar
PES_VELHO = "    rota = rotaPessoa(C, emp, loc, pid);\n    if (!rota) {"
PES_NOVO = ("    rota = rotaPessoa(C, emp, loc, pid);\n"
            "    if (!rota && PRIVADO_) rota = { grupo: null, marcar: [], nome: nomePessoa(C, emp, pid), shopping: null };  // 0.6.0\n"
            "    if (!rota) {")

FIM_VELHO = "  out.push({ pairedItem: { item: e.i }, json: Object.assign(base, {\n    ignorado: false, chamado, cliente,"
FIM_NOVO = """  // 0.6.0: so particular: tecnico atribuido (aberto/transferido) ou responsavel pela infra (infra_fone). Assumido, sem tecnico,
  // dono do numero, fora do cadastro ou sem telefone = nao sai (fica como ignorado)
  if (PRIVADO_) {
    const pidP = (ev === 'INFRA' || ev === 'SEMTEC') ? null : (tecEvento || tecChamado);
    const tP = pidP ? C.tec[emp + ':' + pidP] : null;
    const foneP = tP ? String(tP.fone || '').replace(/\\D/g, '') : '';
    let motivoP = null;
    const foneI = String(C.param.infra_fone || '').replace(/\\D/g, '');
    if (ev === 'SEMTEC') motivoP = 'sem técnico atribuído (avisos só no particular do técnico)';
    else if (ev === 'INFRA') { if (foneI.length < 12) motivoP = 'pedido de infra: infra_fone não cadastrado'; }
    else if (label === 'Chamado assumido') motivoP = 'chamado assumido (não notifica)';
    else if (!pidP) motivoP = 'sem técnico atribuído (avisos só no particular do técnico)';
    else if (E.dono_id && pidP === String(E.dono_id)) motivoP = 'atribuído ao dono do número (avisos só no particular do técnico)';
    else if (!tP) motivoP = 'pessoa fora do cadastro de técnicos (' + nomePessoa(C, emp, pidP) + ')';
    else if (foneP.length < 12) motivoP = 'técnico sem telefone cadastrado (' + tP.nome + ')';
    if (motivoP) { out.push({ pairedItem: { item: e.i }, json: Object.assign(base, { ignorado: true, motivo: motivoP }) }); continue; }
    rota = ev === 'INFRA' ? { grupo: foneI + '@c.us', marcar: [], nome: null, shopping: loc ? loc.nome : 'Local não identificado' }
      : { grupo: foneP + '@c.us', marcar: [], nome: null, shopping: loc ? loc.nome : null };
    semTec = false; folga = null;__FOLGAV__
  }
""" + FIM_VELHO

# ---------- Pendentes ----------
PEN_VELHO = "return C.pendentes.filter(p => p.tentativas < max).map("
PEN_NOVO = ("// 0.6.0: com aviso_privado (padrao) falha antiga que era para grupo nao e reenviada\n"
            "const PRIV_ = String(C.param.aviso_privado || 'sim').trim().toLowerCase() !== 'nao';\n"
            "return C.pendentes.filter(p => p.tentativas < max && !(PRIV_ && /@g\\.us$/.test(String(p.grupo || '')))).map(")


def aplicar(wf):
    n = no(wf, "Rotear")
    c = n["parameters"]["jsCode"]
    assert "plantaoHoje" in c and "rotaPessoa" in c, "Rotear: nao parece o WF 01 do whatsapp-ixc"
    assert MARCA not in c, "WF 01 ja esta na 0.6.0"
    c = troca(c, INI_VELHO, INI_NOVO, "Rotear")
    c = troca(c, PES_VELHO, PES_NOVO, "Rotear")
    c = troca(c, FIM_VELHO, FIM_NOVO.replace("__FOLGAV__", " folgaV = null;" if "folgaV" in c else ""), "Rotear")
    n["parameters"]["jsCode"] = c
    p = no(wf, "Pendentes")
    p["parameters"]["jsCode"] = troca(p["parameters"]["jsCode"], PEN_VELHO, PEN_NOVO, "Pendentes")


def main():
    alvo = sys.argv[1]
    if alvo.endswith(".json") and os.path.isfile(alvo):
        raiz, p = os.path.dirname(os.path.abspath(alvo)), alvo
    else:
        raiz, p = alvo, achar(alvo, W01)
    wf = ler(p)
    aplicar(wf)
    if alvo.endswith(".json"):  # arquivo solto: nao mexe em fontes/
        import json
        with open(p, "w", encoding="utf-8") as f:
            json.dump(wf, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("  gravado:", p)
    else:
        gravar(raiz, p, wf)
    print("ok", os.path.basename(p), "-> 0.6.0 (avisos so no particular do tecnico)")


if __name__ == "__main__":
    main()
