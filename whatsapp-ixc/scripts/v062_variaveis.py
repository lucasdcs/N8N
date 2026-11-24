#!/usr/bin/env python3
"""whatsapp-ixc 0.6.2 — variaveis e {shopping} nas mensagens novas do Painel do Bot 0.4.1.

Aplica sobre a 0.6.1 (saida do v061_trava_antigos.py; tambem funciona direto sobre a 0.5.0), no lugar.
(Entregue antes como 0.5.1 / v051; renumerada porque a 0.6.0 e a 0.6.1 entraram antes no GitHub.)
Acha os JSON em qualquer subpasta, com ou sem "SIM_":
  python3 scripts/v062_variaveis.py <pasta com n8n/ e fontes/ | /opt/ixc-simulador | pasta do zip de producao>

Regras (decisoes de 24/11):
  - Variaveis criadas no painel (aba Variaveis): ixc.mensagens com chave var.<nome>, valor em texto_padrao. No texto
    da mensagem nova, {nome} vira o valor; variavel desativada = vazio (linha so com ela some, como no M()).
  - {shopping} na frase: as palavras antes/depois na ordem; o que fica no lugar e procurado nos nomes e apelidos dos
    shoppings (mesma busca do "quem esta no ..."). {shopping} no texto = nome do shopping. Varios shoppings citados
    (ex.: apelido de cidade) = uma resposta por shopping. **Nenhum shopping reconhecido = responde para todos os
    shoppings** (pedido de 24/11), em ordem de nome.
  - O mapa de mensagens do bot (M()) nao leva mais as chaves var.* e resp.*: variavel/mensagem nova desativada nao
    liga o modo "alguma desativada" das respostas do bot.
  - Consultas com to_jsonb e LIKE: banco sem variaveis = lista vazia.
"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v030_mensagens_perguntas import troca, no
from v042_vinculo_renomeado import achar, ler, gravar, W01, W03
from v050_mensagens_novas import W02, W04, Q_NOVO as Q_050, CONFIGS

Q_051 = Q_050.replace("WHERE m.texto IS NOT NULL OR (to_jsonb(m)->>'ativo') = 'false')",
                      "WHERE m.chave NOT LIKE 'var.%' AND m.chave NOT LIKE 'resp.%' AND (m.texto IS NOT NULL OR (to_jsonb(m)->>'ativo') = 'false'))")
assert Q_051 != Q_050

P_VELHO = """          FROM ixc.mensagens m WHERE (to_jsonb(m)->>'criada_painel') = 'true' AND coalesce(to_jsonb(m)->>'ativo', 'true') = 'true') AS respostas
FROM ixc.parametros"""
P_NOVO = """          FROM ixc.mensagens m WHERE m.chave LIKE 'resp.%' AND (to_jsonb(m)->>'criada_painel') = 'true' AND coalesce(to_jsonb(m)->>'ativo', 'true') = 'true') AS respostas,
       -- 0.6.2: variaveis das mensagens novas ({nome} = valor; desativada = vazio)
       (SELECT coalesce(json_object_agg(substr(m.chave, 5), CASE WHEN coalesce(to_jsonb(m)->>'ativo', 'true') = 'true' THEN m.texto_padrao ELSE '' END), '{}'::json)::text
          FROM ixc.mensagens m WHERE m.chave LIKE 'var.%') AS variaveis
FROM ixc.parametros"""

FP_VELHO = """    const r_ = RS_.find(r => (r.g !== 'recados' || key.remoteJid === recados_) && (Array.isArray(r.f) ? r.f : []).some(f => f && (nn_.includes(' ' + f + ' ') || nh_.includes(' ' + f + ' '))));
    if (r_) return [{ json: { grupo: key.remoteJid, texto, id: key.id, participant: key.participant || null, fromMe: !!key.fromMe, resposta_fixa: String(r_.t || ''), resposta_chave: r_.chave } }];"""
FP_NOVO = """    // 0.6.2: frase com {shopping}: palavras antes/depois na ordem; o que sobra no lugar vai para a busca de shopping
    const bate_ = (h, f) => {
      if (f.indexOf('{shopping}') < 0) return h.includes(' ' + f + ' ') ? { sh: null } : null;
      const [a, b] = f.split('{shopping}').map(x => x.trim());
      let resto = h;
      if (a) { const k = h.indexOf(' ' + a + ' '); if (k < 0) return null; resto = h.slice(k + a.length + 1); }
      if (b) { const j = resto.indexOf(' ' + b + ' '); if (j < 0) return null; resto = resto.slice(0, j); }
      return { sh: resto.trim() };
    };
    let r_ = null, m_ = null;
    for (const r of RS_) {
      if (r.g === 'recados' && key.remoteJid !== recados_) continue;
      for (const f of (Array.isArray(r.f) ? r.f : [])) { if (!f) continue; m_ = bate_(nn_, f) || bate_(nh_, f); if (m_) break; }
      if (m_) { r_ = r; break; }
    }
    if (r_) {
      let VR_ = {};
      try { VR_ = JSON.parse(String($('Carregar Parametros').first().json.variaveis || '{}')) || {}; } catch (e) { VR_ = {}; }
      return [{ json: { grupo: key.remoteJid, texto, id: key.id, participant: key.participant || null, fromMe: !!key.fromMe, resposta_fixa: String(r_.t || ''), resposta_chave: r_.chave,
        resposta_shopping: m_.sh, resposta_vars: (VR_ && typeof VR_ === 'object' && !Array.isArray(VR_)) ? VR_ : {} } }];
    }"""

MR_VELHO = """  const corpo_ = String(P0.resposta_fixa || '').trim();
  if (!corpo_) return [];
  const menc = [];
  const resp = marcarFones_(CAB_(M('escala.cabecalho', '🤖 *Resposta automática do bot de escalas*')) + corpo_, menc);"""
MR_NOVO = """  const corpo0_ = String(P0.resposta_fixa || '').trim();
  if (!corpo0_) return [];
  // 0.6.2: variaveis do painel ({nome} = valor) e {shopping}; M() com chave inexistente = o texto dado, com as variaveis
  const VR_ = Object.assign({}, P0.resposta_vars || {});
  let corpo_;
  if (P0.resposta_shopping === undefined || P0.resposta_shopping === null) corpo_ = M('__resp__', corpo0_, VR_);
  else {
    let t2 = ' ' + norm(P0.resposta_shopping).replace(/[^a-z0-9 ]/g, ' ').replace(/\\s+/g, ' ').trim() + ' ';
    const td = [];
    for (const [k, al] of Object.entries(ALIAS)) for (const a of al) td.push([a, k]);
    td.sort((a, b) => (GENERICOS.includes(a[0]) - GENERICOS.includes(b[0])) || b[0].length - a[0].length);
    const ach = [];
    for (const [a, k] of td) {
      if (GENERICOS.includes(a) && ach.length) continue;
      if (t2.includes(' ' + a + ' ')) { t2 = t2.replace(' ' + a + ' ', ' # '); for (const kk of k.split('|')) if (!ach.includes(kk)) ach.push(kk); }
    }
    let locs_ = ach.map(k => LOC.find(l => l.empresa + ':' + l.id_condominio === k)).filter(Boolean);
    if (!locs_.length) locs_ = LOC.slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));   // nenhum reconhecido: todos
    const partes_ = locs_.map(l => M('__resp__', corpo0_, Object.assign({}, VR_, { shopping: l.nome }))).filter(x => x.trim());
    corpo_ = partes_.join(corpo0_.includes('\\n') ? '\\n\\n' : '\\n');
  }
  if (!corpo_.trim()) return [];
  const menc = [];
  const resp = marcarFones_(CAB_(M('escala.cabecalho', '🤖 *Resposta automática do bot de escalas*')) + corpo_, menc);"""


def main():
    raiz = sys.argv[1]
    P = {w: achar(raiz, w) for w in (W01, W02, W03)}
    WF = {w: ler(p) for w, p in P.items()}
    c3 = no(WF[W03], "Escala: Montar Resposta")["parameters"]["jsCode"]
    assert "resposta_fixa" in c3, "WF 03 ainda nao esta na 0.5.0 (rode o v050 antes)"
    assert "resposta_vars" not in c3, "WF 03 ja esta na 0.6.2"
    for w, nome in CONFIGS:
        n = no(WF[w], nome)
        n["parameters"]["query"] = troca(n["parameters"]["query"], Q_050, Q_051, nome)
    n = no(WF[W03], "Carregar Parametros"); n["parameters"]["query"] = troca(n["parameters"]["query"], P_VELHO, P_NOVO, "Carregar Parametros")
    n = no(WF[W03], "Escala: Filtrar Pergunta"); n["parameters"]["jsCode"] = troca(n["parameters"]["jsCode"], FP_VELHO, FP_NOVO, "Filtrar Pergunta")
    n = no(WF[W03], "Escala: Montar Resposta"); n["parameters"]["jsCode"] = troca(n["parameters"]["jsCode"], MR_VELHO, MR_NOVO, "Montar Resposta")
    for w in (W01, W02, W03):
        gravar(raiz, P[w], WF[w])
    print("ok -> 0.6.2 (variaveis e {shopping} nas mensagens novas)")


if __name__ == "__main__":
    main()
