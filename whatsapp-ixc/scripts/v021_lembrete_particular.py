#!/usr/bin/env python3
"""whatsapp-ixc 0.2.1 — lembretes de visita (WF 02) no particular do tecnico.

Aplica sobre o WF 02 da 0.2.0 (saida do v020_lembrete_planta.py), no lugar:
  python3 scripts/v021_lembrete_particular.py <pasta com n8n/ e fontes/>

Regra (29/10/2026):
  - visita com tecnico atribuido e com telefone em ixc.tecnicos -> lembretes de 1 h (com planta) e de 10 min
    vao para o PARTICULAR dele (chatId <fone>@c.us), sem @ e sem copia no grupo;
  - sem tecnico atribuido, tecnico sem telefone ou "dono do numero" -> grupo do shopping, como antes;
  - parametro ixc.parametros.lembrete_privado: 'nao' volta tudo para o grupo (ausente = 'sim').
O WF 01 (avisos de chamado) nao muda: continua no grupo.
Falha alto (AssertionError) se o JSON de entrada nao for o esperado.
"""
import json, os, re, sys, unicodedata

ARQ = "02_IXC_Lembretes_de_Visita.json"


def troca(txt, velho, novo, no):
    assert txt.count(velho) == 1, f"{no}: trecho esperado nao encontrado (ou repetido): {velho[:70]!r}"
    return txt.replace(velho, novo)


ROTEAR_VELHO = """  const rota = pid ? rotaPessoa(C, emp, loc, pid) : rotaSemTecnico(C, emp, loc, false);
  if (!rota) continue;
  out.push({ pairedItem: { item: i }, json: Object.assign({}, d, { cliente, grupo_jid: rota.grupo, marcar: rota.marcar, nome: rota.nome || null,
    shopping: rota.shopping, sem_tecnico: !pid }) });"""
ROTEAR_NOVO = """  // 0.2.1 (29/10/2026): com tecnico atribuido e telefone cadastrado -> particular dele (sem @, sem copia no grupo).
  // Sem tecnico, sem telefone ou dono do numero -> grupo do shopping, como antes. Desligar: lembrete_privado = 'nao'.
  const E = C.empresas[emp] || {};
  const tec = pid ? C.tec[emp + ':' + pid] : null;
  const foneTec = tec ? String(tec.fone || '').replace(/\\D/g, '') : '';
  const dono = !!(pid && E.dono_id && pid === String(E.dono_id));
  if (PRIVADO && pid && !dono && foneTec.length >= 12) {
    out.push({ pairedItem: { item: i }, json: Object.assign({}, d, { cliente, grupo_jid: foneTec + '@c.us', marcar: [], nome: null,
      shopping: loc ? loc.nome : null, sem_tecnico: false, privado: true, tecnico: tec.nome || null }) });
    continue;
  }
  const rota = pid ? rotaPessoa(C, emp, loc, pid) : rotaSemTecnico(C, emp, loc, false);
  if (!rota) continue;
  out.push({ pairedItem: { item: i }, json: Object.assign({}, d, { cliente, grupo_jid: rota.grupo, marcar: rota.marcar, nome: rota.nome || null,
    shopping: rota.shopping, sem_tecnico: !pid, privado: false }) });"""
ROTEAR_INI_VELHO = """const C = carregarConfig();
const items = $input.all();
const out = [];
for (let i = 0; i < items.length; i++) {
  const d = $('Filtrar Janela').itemMatching(i).json;"""
ROTEAR_INI_NOVO = """const C = carregarConfig();
const PRIVADO = String(C.param.lembrete_privado || 'sim').trim().toLowerCase() !== 'nao';
const items = $input.all();
const out = [];
for (let i = 0; i < items.length; i++) {
  const d = $('Filtrar Janela').itemMatching(i).json;"""

MONTAR = [
    ("""      texto: curto, grupo_jid: d.grupo_jid, mentioned: marcar, planta: null } });""",
     """      texto: curto, grupo_jid: d.grupo_jid, mentioned: marcar, planta: null, privado: !!d.privado } });"""),
    ("""    texto, grupo_jid: d.grupo_jid, mentioned: marcar, planta } });""",
     """    texto, grupo_jid: d.grupo_jid, mentioned: marcar, planta, privado: !!d.privado } });"""),
]
RESULT_VELHO = """  const erro = ok ? ([d.simulado ? 'SIMULADO' : null, pi].filter(Boolean).join(' · ') || null)"""
RESULT_NOVO = """  const erro = ok ? ([d.simulado ? 'SIMULADO' : null, d.privado ? 'particular' : null, pi].filter(Boolean).join(' · ') || null)"""


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_")


def extrair_fontes(wf, pasta, titulo):  # so os nos Code (.js), como a pasta fontes/ do repositorio
    os.makedirs(pasta, exist_ok=True)
    for n in wf["nodes"]:
        p = n.get("parameters", {})
        if "jsCode" in p:
            with open(os.path.join(pasta, slug(n["name"]) + ".js"), "w") as f:
                f.write(f"// Workflow: {titulo}\n// No: {n['name']}\n\n{p['jsCode']}\n")


def main():
    raiz = sys.argv[1]
    caminho = os.path.join(raiz, "n8n", ARQ)
    wf = json.load(open(caminho, encoding="utf-8"))
    nos = {n["name"]: n for n in wf["nodes"]}
    assert "Anexar Planta" in nos, "WF 02 precisa estar na 0.2.0 (rode antes o v020_lembrete_planta.py)"
    p = nos["Rotear Lembrete"]["parameters"]
    assert "lembrete_privado" not in p["jsCode"], "WF 02 ja esta na 0.2.1"
    js = troca(p["jsCode"], ROTEAR_INI_VELHO, ROTEAR_INI_NOVO, "Rotear Lembrete")
    p["jsCode"] = troca(js, ROTEAR_VELHO, ROTEAR_NOVO, "Rotear Lembrete")
    p = nos["Montar Lembrete"]["parameters"]
    for v, n in MONTAR:
        p["jsCode"] = troca(p["jsCode"], v, n, "Montar Lembrete")
    p = nos["Resultado"]["parameters"]
    p["jsCode"] = troca(p["jsCode"], RESULT_VELHO, RESULT_NOVO, "Resultado")
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(wf, f, ensure_ascii=False, indent=1)
        f.write("\n")
    extrair_fontes(wf, os.path.join(raiz, "fontes", ARQ[:-5]), wf["name"])
    print("WF 02 -> 0.2.1: lembretes no particular do tecnico (lembrete_privado)")


if __name__ == "__main__":
    main()
