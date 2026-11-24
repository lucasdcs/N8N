#!/usr/bin/env python3
"""whatsapp-ixc 0.6.3 — variavel por shopping e variaveis do bot desativaveis (Painel do Bot 0.4.2).

Aplica sobre a 0.6.2 (saida do v062_variaveis.py), no lugar. Acha os JSON em qualquer subpasta, com ou sem "SIM_":
  python3 scripts/v063_variaveis_shopping.py <pasta com n8n/ e fontes/ | /opt/ixc-simulador | pasta do zip de producao>

Regras (pedido de 24/11):
  - Variavel criada "por shopping" (ixc.mensagens var.<nome> com texto = JSON {"EMPRESA:ID": valor}, texto_padrao =
    valor padrao): na mensagem nova com {shopping}, {nome} = valor do shopping perguntado; shopping sem valor = padrao.
    Sem {shopping} na frase = padrao. Variavel fixa continua igual. Desativada = vazio.
  - Variavel do bot desativada no painel (linha vsys.<nome> com ativo = false; o mapa de mensagens ja traz null):
    M() troca o valor dela por vazio em TODAS as mensagens do catalogo (regra do M: linha so com variavel vazia some).
  - Consulta das variaveis: {nome: {p: padrao, s: {...}}}. A 0.6.2 lia {nome: valor}; o Montar Resposta aceita os dois.
"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v030_mensagens_perguntas import troca, no
from v042_vinculo_renomeado import achar, ler, gravar, W01, W03
from v050_mensagens_novas import W02, COM_M

Q_VELHO = """       (SELECT coalesce(json_object_agg(substr(m.chave, 5), CASE WHEN coalesce(to_jsonb(m)->>'ativo', 'true') = 'true' THEN m.texto_padrao ELSE '' END), '{}'::json)::text
          FROM ixc.mensagens m WHERE m.chave LIKE 'var.%') AS variaveis"""
Q_NOVO = """       (SELECT coalesce(json_object_agg(substr(m.chave, 5), json_build_object(
                 'p', CASE WHEN coalesce(to_jsonb(m)->>'ativo', 'true') = 'true' THEN m.texto_padrao ELSE '' END,
                 -- 0.6.3: variavel por shopping (texto = JSON {"EMPRESA:ID": valor}); fixa = {}
                 's', CASE WHEN coalesce(to_jsonb(m)->>'ativo', 'true') = 'true' AND m.texto ~ '^\\s*\\{' THEN m.texto::json ELSE '{}'::json END)), '{}'::json)::text
          FROM ixc.mensagens m WHERE m.chave LIKE 'var.%') AS variaveis"""

MR_VELHO = """  const VR_ = Object.assign({}, P0.resposta_vars || {});
  let corpo_;
  if (P0.resposta_shopping === undefined || P0.resposta_shopping === null) corpo_ = M('__resp__', corpo0_, VR_);"""
MR_NOVO = """  // 0.6.3: variavel por shopping {p: padrao, s: {"EMPRESA:ID": valor}}; a 0.6.2 mandava so o valor (texto)
  const VRAW_ = P0.resposta_vars || {};
  const varsDe_ = l => { const o = {}; for (const [k, d] of Object.entries(VRAW_)) {
    if (d && typeof d === 'object') { const s = d.s || {}, ch = l ? l.empresa + ':' + l.id_condominio : null; o[k] = String(ch && s[ch] !== undefined ? s[ch] : (d.p || '')); }
    else o[k] = String(d === null || d === undefined ? '' : d); } return o; };
  const VR_ = varsDe_(null);
  let corpo_;
  if (P0.resposta_shopping === undefined || P0.resposta_shopping === null) corpo_ = M('__resp__', corpo0_, VR_);"""
MR2_VELHO = """    const partes_ = locs_.map(l => M('__resp__', corpo0_, Object.assign({}, VR_, { shopping: l.nome }))).filter(x => x.trim());"""
MR2_NOVO = """    const partes_ = locs_.map(l => M('__resp__', corpo0_, Object.assign(varsDe_(l), { shopping: l.nome }))).filter(x => x.trim());"""

M_VELHO = "  if (MSG_[chave] === null) return '';  // 0.5.0: desativada no Painel do Bot\n"
M_NOVO = (M_VELHO + "  // 0.6.3: variavel do bot desativada no painel (vsys.<nome>) = vazia em todas as mensagens\n"
          "  if (v) { const v2_ = {}; for (const k of Object.keys(v)) v2_[k] = MSG_['vsys.' + k] === null ? '' : v[k]; v = v2_; }\n")


def main():
    raiz = sys.argv[1]
    P = {w: achar(raiz, w) for w in (W01, W02, W03)}
    WF = {w: ler(p) for w, p in P.items()}
    c3 = no(WF[W03], "Escala: Montar Resposta")["parameters"]["jsCode"]
    assert "resposta_vars" in c3, "WF 03 ainda nao esta na 0.6.2 (rode o v062 antes)"
    assert "varsDe_" not in c3, "WF 03 ja esta na 0.6.3"
    n = no(WF[W03], "Carregar Parametros"); n["parameters"]["query"] = troca(n["parameters"]["query"], Q_VELHO, Q_NOVO, "Carregar Parametros")
    n = no(WF[W03], "Escala: Montar Resposta")
    c = troca(n["parameters"]["jsCode"], MR_VELHO, MR_NOVO, "Montar Resposta")
    n["parameters"]["jsCode"] = troca(c, MR2_VELHO, MR2_NOVO, "Montar Resposta")
    for w, nome in COM_M:
        n = no(WF[w], nome)
        n["parameters"]["jsCode"] = troca(n["parameters"]["jsCode"], M_VELHO, M_NOVO, nome)
    for w in (W01, W02, W03):
        gravar(raiz, P[w], WF[w])
    print("ok -> 0.6.3 (variavel por shopping; variaveis do bot desativaveis)")


if __name__ == "__main__":
    main()
