#!/usr/bin/env python3
"""whatsapp-ixc 0.4.1 — nome do tecnico editado no Painel do Bot vale tambem nos shoppings 12x36 (planilha ESCALAS).

Aplica sobre a 0.4.0 (saida do v040_apelidos.py), no lugar:
  python3 scripts/v041_nome_planilha.py <pasta com n8n/ e fontes/>

Antes: nos 12x36 a resposta mostrava o nome como esta na planilha (ixc.escala_dia) e o "esta de folga" do aviso
comparava o 1o nome do cadastro com a planilha. Renomear o tecnico no painel nao mudava a resposta (e, se mudasse o
1o nome, o aviso achava que ele estava de folga).
Agora: coluna nova ixc.tecnicos.nome_planilha (painelbot 0.3.1, "Nome na planilha"; vazio = nome). A planilha e
ligada ao cadastro por ela (nome inteiro; senao 1o nome, empate pelo 2o) e a resposta/aviso mostram o NOME DO CADASTRO
e o telefone do cadastro. Sem ligacao, fica como antes (nome da planilha).
  - WF 01 "Rotear": plantao do dia usa nome_planilha; nomes do plantao saem como no cadastro.
  - WF 03 "Escala: Buscar Dados" e "IXC Cmd: Carregar": tecnicos com nome_planilha (to_jsonb: funciona sem a coluna).
  - WF 03 "Escala: Montar Resposta" e "IXC Cmd: Interpretar" (ixc quem): tecDaPlanilha(); "quem <tecnico>" acha
    tambem pelo nome do cadastro.
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v021_lembrete_particular import extrair_fontes
from v030_mensagens_perguntas import troca, no

W01 = "01_IXC_Notificacoes_WhatsApp.json"
W03 = "03_IXC_Comandos_e_Consulta_de_Escala.json"

R_P = "const [p1, p2] = normTxt(t.nome).split(/\\s+/);"
R_P_N = "const [p1, p2] = normTxt(t.nome_planilha || t.nome).split(/\\s+/);  // 0.4.1: nome na planilha (Painel do Bot); vazio = nome"
R_RET = "  return { nomes, texto, tecs, tem };"
R_RET_N = """  // 0.4.1: o plantao sai com o nome do cadastro (editado no painel) quando o tecnico da planilha foi identificado
  const pal_ = s => normTxt(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const exibe = nomes.map(n => {
    const w = pal_(n), c = tecs.filter(t => pal_(t.nome_planilha || t.nome)[0] === w[0]);
    const t = c.length === 1 ? c[0] : c.find(t => { const k = pal_(t.nome_planilha || t.nome); return k[1] && w.includes(k[1]); });
    return t ? t.nome : n;
  });
  return { nomes: exibe, texto, tecs, tem };"""
R_FOLGA = "!pl.tem(normTxt(tAtrib.nome).split(/\\s+/)[0])"
R_FOLGA_N = "!pl.tem(normTxt(tAtrib.nome_planilha || tAtrib.nome).split(/\\s+/)[0])"

Q_VELHO = "'tecnicos', (SELECT coalesce(json_agg(json_build_object('empresa', t.empresa, 'id_func', t.id_func, 'nome', t.nome, 'fone', t.fone)), '[]'::json) FROM ixc.tecnicos t),"
Q_NOVO = "'tecnicos', (SELECT coalesce(json_agg(json_build_object('empresa', t.empresa, 'id_func', t.id_func, 'nome', t.nome, 'fone', t.fone, 'nome_planilha', to_jsonb(t)->>'nome_planilha')), '[]'::json) FROM ixc.tecnicos t),"

M_FUNC = "function quemNoDia(loc, iso) {"
M_FUNC_N = """// 0.4.1 (Painel do Bot): nome da planilha ESCALAS -> tecnico cadastrado ("nome na planilha"; vazio = nome).
// Nome inteiro igual; senao 1o nome (empate desfeito pelo 2o). Achou: a resposta usa o nome e o telefone do cadastro.
function tecDaPlanilha(emp, nome) {
  const pal = s => norm(s).replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\\s+/).filter(Boolean);
  const w = pal(nome); if (!w.length) return null;
  const da = TEC.filter(t => t.empresa === emp);
  const ex = da.filter(t => pal(t.nome_planilha || t.nome).join(' ') === w.join(' '));
  if (ex.length === 1) return ex[0];
  const c = da.filter(t => pal(t.nome_planilha || t.nome)[0] === w[0]);
  if (c.length === 1) return c[0];
  const d = c.filter(t => { const k = pal(t.nome_planilha || t.nome); return k[1] && w.includes(k[1]); });
  return d.length === 1 ? d[0] : null;
}
function quemNoDia(loc, iso) {"""
M_NS = "    if (ns.length) return ns.map(n => n + ' ' + foneDe(n, loc, b)).join(' / ').trim();"
M_NS_N = "    if (ns.length) return ns.map(n => { const t = tecDaPlanilha(loc.empresa, n); return t ? t.nome + (t.fone ? ' ' + fmtFone(t.fone) : '') : n + ' ' + foneDe(n, loc, b); }).join(' / ').trim();  // 0.4.1"
M_QUEM = ".map(d => d.tecnico));\n    return nomes.some("
M_QUEM_N = (".map(d => d.tecnico))\n      .concat(ED.filter(d => d.empresa === l.empresa && d.id_condominio === l.id_condominio).map(d => (tecDaPlanilha(l.empresa, d.tecnico) || {}).nome || ''));  // 0.4.1\n"
            "    return nomes.some(")


def gravar(raiz, arq, wf):
    p = os.path.join(raiz, "n8n", arq)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(wf, f, ensure_ascii=False, indent=1)
        f.write("\n")
    if os.path.isdir(os.path.join(raiz, "fontes")):
        extrair_fontes(wf, os.path.join(raiz, "fontes", arq[:-5]), wf["name"])


def main():
    raiz = sys.argv[1]
    wf = json.load(open(os.path.join(raiz, "n8n", W01), encoding="utf-8"))
    n = no(wf, "Rotear")
    c = n["parameters"]["jsCode"]
    assert "nome_planilha" not in c, "WF 01 ja esta na 0.4.1"
    c = troca(c, R_P, R_P_N, "Rotear")
    c = troca(c, R_RET, R_RET_N, "Rotear")
    c = troca(c, R_FOLGA, R_FOLGA_N, "Rotear")
    n["parameters"]["jsCode"] = c
    gravar(raiz, W01, wf)

    wf = json.load(open(os.path.join(raiz, "n8n", W03), encoding="utf-8"))
    for q, js in (("Escala: Buscar Dados", "Escala: Montar Resposta"), ("IXC Cmd: Carregar", "IXC Cmd: Interpretar")):
        n = no(wf, q)
        n["parameters"]["query"] = troca(n["parameters"]["query"], Q_VELHO, Q_NOVO, q)
        n = no(wf, js)
        c = n["parameters"]["jsCode"]
        assert "tecDaPlanilha" not in c, "WF 03 ja esta na 0.4.1"
        c = troca(c, M_FUNC, M_FUNC_N, js)
        c = troca(c, M_NS, M_NS_N, js)
        c = troca(c, M_QUEM, M_QUEM_N, js)
        n["parameters"]["jsCode"] = c
    gravar(raiz, W03, wf)
    print("ok", W01, W03, "-> 0.4.1 (nome na planilha)")


if __name__ == "__main__":
    main()
