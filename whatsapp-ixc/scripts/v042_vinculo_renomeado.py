#!/usr/bin/env python3
"""whatsapp-ixc 0.4.2 — tecnico renomeado no Painel do Bot continua ligado a planilha ESCALAS (12x36) sem precisar
preencher o "Nome na planilha".

Aplica sobre a 0.4.1 (saida do v041_nome_planilha.py), no lugar:
  python3 scripts/v042_vinculo_renomeado.py <pasta com n8n/ e fontes/>
Acha os JSON em qualquer subpasta, com ou sem o prefixo "SIM_" (copias do simulador): serve tambem para
  python3 scripts/v042_vinculo_renomeado.py /opt/ixc-simulador        (workflows [SIM] do teste)
  python3 scripts/v042_vinculo_renomeado.py <pasta do zip de producao 0.4.1>

Bug (24/11): no painel o tecnico "Juliano" virou "Testinho - Juliano" sem preencher o "Nome na planilha". A 0.4.1 so
ligava pelo nome inteiro ou pelo 1o nome ("testinho" != "juliano"), entao a resposta do grupo mostrava
"Juliano — @Testinho - Juliano" (nome da planilha, @ do cadastro pelo telefone da Equipe) e o aviso de chamado do WF 01
dizia que o Juliano estava "de folga" no dia do plantao dele.
Agora, depois das regras da 0.4.1 (sem mudar o que elas ja ligavam):
  3. nome da planilha contido no nome do cadastro (todas as palavras, >= 3 letras), so para quem esta com o
     "Nome na planilha" vazio e so se for um unico tecnico da empresa ("Juliano" -> "Testinho - Juliano");
  4. (WF 03) telefone da Equipe do shopping (escala_base.tecnicos) igual ao telefone de um unico tecnico da empresa.
     E o mesmo telefone que ja virava o @, entao nome e @ passam a concordar.
  - WF 01 "Rotear": plantao do dia e "esta de folga" usam a regra 3.
  - WF 03 "Escala: Montar Resposta" e "IXC Cmd: Interpretar": regras 3 e 4 (resposta, ixc quem <shopping>/<tecnico>).
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v021_lembrete_particular import extrair_fontes
from v030_mensagens_perguntas import troca, no

W01 = "01_IXC_Notificacoes_WhatsApp.json"
W03 = "03_IXC_Comandos_e_Consulta_de_Escala.json"

# ---------- WF 01 Rotear ----------
R_TECS = """  const tecs = [];
  for (const cands of Object.values(porPrimeiro)) {
    if (cands.length === 1) tecs.push(cands[0].t);
    else { const f = cands.filter(c => tem(c.p2)); if (f.length === 1) tecs.push(f[0].t); }
  }"""
R_TECS_N = R_TECS + """
  // 0.4.2: renomeado no painel sem "Nome na planilha" ("Juliano" -> "Testinho - Juliano"): o nome da planilha esta
  // dentro do nome do cadastro (todas as palavras, >= 3 letras) e so um tecnico da empresa bate
  const palR = s => normTxt(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const daEmp = Object.values(C.tec).filter(t => t.empresa === emp);
  const contido = n => { const w = palR(n); if (!w.length || w.some(p => p.length < 3)) return null;
    const r = daEmp.filter(t => !t.nome_planilha && w.every(p => palR(t.nome).includes(p))); return r.length === 1 ? r[0] : null; };
  const extra = {};
  for (const n of nomes) {
    const w = palR(n);
    if (tecs.some(t => palR(t.nome_planilha || t.nome)[0] === w[0])) continue;  // ja ligado pela regra da 0.4.1
    const t = contido(n);
    if (t && !tecs.includes(t)) { tecs.push(t); extra[n] = t; }
  }"""
R_EXIBE = "    return t ? t.nome : n;\n  });"
R_EXIBE_N = "    return t ? t.nome : (extra[n] ? extra[n].nome : n);  // 0.4.2: extra = regra do nome contido\n  });"
R_FOLGA = "!pl.tem(normTxt(tAtrib.nome_planilha || tAtrib.nome).split(/\\s+/)[0])"
R_FOLGA_N = "!pl.tecs.includes(tAtrib) && !pl.tem(normTxt(tAtrib.nome_planilha || tAtrib.nome).split(/\\s+/)[0])"  # 0.4.2

# ---------- WF 03 (Montar Resposta e IXC Cmd: Interpretar) ----------
M_FIM = """  const d = c.filter(t => { const k = pal(t.nome_planilha || t.nome); return k[1] && w.includes(k[1]); });
  return d.length === 1 ? d[0] : null;
}"""
M_FIM_N = """  const d = c.filter(t => { const k = pal(t.nome_planilha || t.nome); return k[1] && w.includes(k[1]); });
  if (d.length === 1) return d[0];
  if (c.length) return null;  // 1o nome bate com mais de um e o 2o nao desempatou: como na 0.4.1
  // 0.4.2: renomeado no painel sem "Nome na planilha" ("Juliano" -> "Testinho - Juliano")
  if (w.some(p => p.length < 3)) return null;
  const r = da.filter(t => !t.nome_planilha && w.every(p => pal(t.nome).includes(p)));
  return r.length === 1 ? r[0] : null;
}
// 0.4.2: tecnico do dia no 12x36 = regras acima; senao o telefone da Equipe do shopping (o mesmo que vira o @)
function tecDoDia(loc, nome) {
  const t = tecDaPlanilha(loc.empresa, nome);
  if (t) return t;
  const b = EB[loc.empresa + ':' + loc.id_condominio] || {};
  const f = String(foneDe(nome, loc, b) || '').replace(/\\D/g, '');
  if (f.length < 10) return null;
  const r = TEC.filter(x => x.empresa === loc.empresa && String(x.fone || '').replace(/\\D/g, '').slice(-10) === f.slice(-10));
  return r.length === 1 ? r[0] : null;
}"""
M_NS = "const t = tecDaPlanilha(loc.empresa, n); return t ?"
M_NS_N = "const t = tecDoDia(loc, n); return t ?"  # 0.4.2
M_QUEM = "(tecDaPlanilha(l.empresa, d.tecnico) || {}).nome || ''));  // 0.4.1"
M_QUEM_N = "(tecDoDia(l, d.tecnico) || {}).nome || ''));  // 0.4.1 / 0.4.2"


def achar(raiz, arq):
    """Caminho do JSON (arq ou SIM_arq) em qualquer subpasta de raiz; tem que ser exatamente 1."""
    ach = [os.path.join(d, f) for d, _, fs in os.walk(raiz) for f in fs if f in (arq, "SIM_" + arq) and "fontes" not in d.split(os.sep)]
    assert len(ach) == 1, f"{arq}: esperado 1 arquivo em {raiz}, achei {ach}"
    return ach[0]


def ler(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def gravar(raiz, p, wf):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(wf, f, ensure_ascii=False, indent=1)
        f.write("\n")
    arq = os.path.basename(p)
    if os.path.isdir(os.path.join(raiz, "fontes")) and not arq.startswith("SIM_"):
        extrair_fontes(wf, os.path.join(raiz, "fontes", arq[:-5]), wf["name"])
    print("  gravado:", p)


def main():
    raiz = sys.argv[1]
    p1, p3 = achar(raiz, W01), achar(raiz, W03)
    wf = ler(p1)
    n = no(wf, "Rotear")
    c = n["parameters"]["jsCode"]
    assert "nome_planilha" in c, "WF 01 ainda nao esta na 0.4.1 (rode o v041 antes)"
    assert "0.4.2" not in c, "WF 01 ja esta na 0.4.2"
    c = troca(c, R_TECS, R_TECS_N, "Rotear")
    c = troca(c, R_EXIBE, R_EXIBE_N, "Rotear")
    c = troca(c, R_FOLGA, R_FOLGA_N, "Rotear")
    n["parameters"]["jsCode"] = c
    wf3 = ler(p3)
    for js in ("Escala: Montar Resposta", "IXC Cmd: Interpretar"):
        n3 = no(wf3, js)
        c3 = n3["parameters"]["jsCode"]
        assert "tecDaPlanilha" in c3, "WF 03 ainda nao esta na 0.4.1 (rode o v041 antes)"
        assert "tecDoDia" not in c3, "WF 03 ja esta na 0.4.2"
        c3 = troca(c3, M_FIM, M_FIM_N, js)
        c3 = troca(c3, M_NS, M_NS_N, js)
        c3 = troca(c3, M_QUEM, M_QUEM_N, js)
        n3["parameters"]["jsCode"] = c3
    # grava so depois que as duas trocas deram certo (nada fica pela metade)
    gravar(raiz, p1, wf)
    gravar(raiz, p3, wf3)
    print("ok", W01, W03, "-> 0.4.2 (vinculo do tecnico renomeado)")


if __name__ == "__main__":
    main()
