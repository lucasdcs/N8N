#!/usr/bin/env python3
"""whatsapp-ixc 0.4.3 — o 1o nome sozinho nao liga a planilha a um tecnico cujo 2o nome nao bate.

Aplica sobre a 0.4.2 (saida do v042_vinculo_renomeado.py), no lugar. Acha os JSON em qualquer subpasta, com ou sem
o prefixo "SIM_":
  python3 scripts/v043_segundo_nome.py <pasta com n8n/ e fontes/ | /opt/ixc-simulador | pasta do zip de producao>

Bug (24/11): no Jockey (12x36) a planilha diz "Joao Soares" (ID 32). No painel o Joao Soares foi renomeado; sobrou
so um "joao" na Cacta (Joao Henrique, ID 31) e a regra do 1o nome (0.4.1) aceitava esse unico candidato sem olhar o
2o nome: a resposta mostrava "Joao Henrique — @Joao Henrique". O telefone da Equipe (foneDe) tinha o mesmo vicio
(pegava a 1a linha da Equipe que comeca com "joao").
Agora:
  - regra do 1o nome: o candidato so vale se o 2o nome nao contradiz ("Joao Soares" x "Joao Henrique" = nao;
    "Joao" x "Joao Henrique" ou "Joao Soares" x "Joao" = sim). Contradiz -> segue para as regras 3 e 4 da 0.4.2;
  - foneDe (WF 03): linha da Equipe com o nome inteiro; senao a que tem o 2o nome; senao so se for a unica com o
    1o nome. Cadastro: idem (1o nome + 2o nome compativel, unico). Assim o @ e a regra 4 acham o Joao Soares
    renomeado pelo telefone dele;
  - WF 01 "Rotear" (plantao/folga): mesma conferencia do 2o nome; o "esta de folga" deixa de achar que o
    Joao Henrique esta de plantao so porque a planilha tem "joao".
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v030_mensagens_perguntas import troca, no
from v042_vinculo_renomeado import achar, ler, gravar, W01, W03

# ---------- WF 03 (Montar Resposta e IXC Cmd: Interpretar) ----------
F_VELHO = """function foneDe(nome, loc, b) {
  const n = norm(nome);
  const m = String((b && b.tecnicos) || '').split(';').map(x => x.trim()).find(x => norm(x).startsWith(n.split(' ')[0]));
  const f = m && m.match(/\\(\\d{2}\\)\\s*[\\d-]+/);
  if (f) return f[0];
  const t = TEC.find(t => t.empresa === loc.empresa && norm(t.nome).split(' ')[0] === n.split(' ')[0]);
  return t && t.fone ? fmtFone(t.fone) : '';
}"""
F_NOVO = """// 2o nome "compativel": algum dos dois nao tem 2o nome, ou o 2o de um aparece no outro (0.4.3)
const palN = s => norm(s).replace(/\\(\\d{2}\\).*$/, '').replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\\s+/).filter(Boolean);
const compat = (a, k) => !a[1] || !k[1] || a.includes(k[1]) || k.includes(a[1]);
function foneDe(nome, loc, b) {  // 0.4.3: nome inteiro > 2o nome > unico com o 1o nome (antes: 1a linha com o 1o nome)
  const w = palN(nome); if (!w.length) return '';
  const eq = String((b && b.tecnicos) || '').split(';').map(x => x.trim()).filter(x => palN(x)[0] === w[0]);
  const ok = eq.filter(x => compat(w, palN(x)));
  const m = eq.find(x => palN(x).join(' ') === w.join(' ')) || (w[1] && ok.find(x => palN(x).includes(w[1]))) || (ok.length === 1 ? ok[0] : null);
  const f = m && m.match(/\\(\\d{2}\\)\\s*[\\d-]+/);
  if (f) return f[0];
  const ts = TEC.filter(t => t.empresa === loc.empresa && palN(t.nome)[0] === w[0] && compat(w, palN(t.nome)));
  return ts.length === 1 && ts[0].fone ? fmtFone(ts[0].fone) : '';
}"""
T_VELHO = """  const c = da.filter(t => pal(t.nome_planilha || t.nome)[0] === w[0]);
  if (c.length === 1) return c[0];"""
T_NOVO = """  const c = da.filter(t => pal(t.nome_planilha || t.nome)[0] === w[0]);
  if (c.length === 1 && compat(w, pal(c[0].nome_planilha || c[0].nome))) return c[0];  // 0.4.3: 2o nome nao pode contradizer
  if (c.length === 1) return contido_(da, w);  // 0.4.3: "Joao Soares" nao e o "Joao Henrique" que sobrou"""
C_VELHO = """  if (w.some(p => p.length < 3)) return null;
  const r = da.filter(t => !t.nome_planilha && w.every(p => pal(t.nome).includes(p)));
  return r.length === 1 ? r[0] : null;
}"""
C_NOVO = """  return contido_(da, w);
}
function contido_(da, w) {  // 0.4.2: nome da planilha dentro do nome do cadastro (so com "Nome na planilha" vazio)
  if (w.some(p => p.length < 3)) return null;
  const r = da.filter(t => !t.nome_planilha && w.every(p => palN(t.nome).includes(p)));
  return r.length === 1 ? r[0] : null;
}"""

# ---------- WF 01 Rotear ----------
R_VELHO = "    if (cands.length === 1) tecs.push(cands[0].t);"
R_NOVO = """    if (cands.length === 1) {  // 0.4.3: 2o nome da planilha nao pode contradizer ("Joao Soares" x "Joao Henrique")
      const p = cands[0], ns = nomes.map(n => normTxt(n).replace(/[^a-z0-9]+/g, ' ').trim().split(' ')).filter(w => w[0] === normTxt(p.t.nome_planilha || p.t.nome).split(/\\s+/)[0]);
      if (!ns.length || ns.some(w => !w[1] || !p.p2 || w.includes(p.p2))) tecs.push(p.t);
    }"""
R_EXTRA_VELHO = "    if (tecs.some(t => palR(t.nome_planilha || t.nome)[0] === w[0])) continue;  // ja ligado pela regra da 0.4.1"
R_EXTRA_NOVO = ("    if (tecs.some(t => { const k = palR(t.nome_planilha || t.nome); return k[0] === w[0] && (!w[1] || !k[1] || w.includes(k[1])); })) continue;"
                "  // ja ligado pela regra da 0.4.1 (0.4.3: com o 2o nome compativel)")
R_RET_VELHO = "  return { nomes: exibe, texto, tecs, tem };"
R_RET_NOVO = """  // 0.4.3: o tecnico atribuido "esta na planilha" se algum nome tem o 1o nome dele e o 2o nao contradiz
  const bate = t => { const k = palR(t.nome_planilha || t.nome); return nomes.some(n => { const w = palR(n); return w[0] === k[0] && (!w[1] || !k[1] || w.includes(k[1]) || k.includes(w[1])); }); };
  return { nomes: exibe, texto, tecs, tem, bate };"""
R_FOLGA_VELHO = "!pl.tecs.includes(tAtrib) && !pl.tem(normTxt(tAtrib.nome_planilha || tAtrib.nome).split(/\\s+/)[0])"
R_FOLGA_NOVO = "!pl.tecs.includes(tAtrib) && !pl.bate(tAtrib)"  # 0.4.3


def main():
    raiz = sys.argv[1]
    p1, p3 = achar(raiz, W01), achar(raiz, W03)
    wf1, wf3 = ler(p1), ler(p3)
    n = no(wf1, "Rotear")
    c = n["parameters"]["jsCode"]
    assert "0.4.2" in c, "WF 01 ainda nao esta na 0.4.2 (rode o v042 antes)"
    assert "0.4.3" not in c, "WF 01 ja esta na 0.4.3"
    c = troca(c, R_VELHO, R_NOVO, "Rotear")
    c = troca(c, R_EXTRA_VELHO, R_EXTRA_NOVO, "Rotear")
    c = troca(c, R_RET_VELHO, R_RET_NOVO, "Rotear")
    c = troca(c, R_FOLGA_VELHO, R_FOLGA_NOVO, "Rotear")
    n["parameters"]["jsCode"] = c
    for js in ("Escala: Montar Resposta", "IXC Cmd: Interpretar"):
        n = no(wf3, js)
        c = n["parameters"]["jsCode"]
        assert "tecDoDia" in c, "WF 03 ainda nao esta na 0.4.2 (rode o v042 antes)"
        assert "contido_" not in c, "WF 03 ja esta na 0.4.3"
        c = troca(c, F_VELHO, F_NOVO, js)
        c = troca(c, T_VELHO, T_NOVO, js)
        c = troca(c, C_VELHO, C_NOVO, js)
        n["parameters"]["jsCode"] = c
    gravar(raiz, p1, wf1)
    gravar(raiz, p3, wf3)
    print("ok", W01, W03, "-> 0.4.3 (2o nome no vinculo da planilha)")


if __name__ == "__main__":
    main()
