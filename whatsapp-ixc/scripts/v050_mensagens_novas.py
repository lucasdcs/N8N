#!/usr/bin/env python3
"""whatsapp-ixc 0.5.0 — mensagens do Painel do Bot 0.4.0: desativar qualquer mensagem e mensagens NOVAS (resposta fixa
no grupo a frases escolhidas no painel).

Aplica sobre a 0.4.3 (saida do v043_segundo_nome.py), no lugar. Acha os JSON em qualquer subpasta, com ou sem "SIM_":
  python3 scripts/v050_mensagens_novas.py <pasta com n8n/ e fontes/ | /opt/ixc-simulador | pasta do zip de producao>

Banco: painelbot/sql/01-mensagens-perguntas.sql da 0.4.0 (colunas ativo, criada_painel, frases, frases_norm, grupos em
ixc.mensagens). As consultas usam to_jsonb(m): banco sem essas colunas = tudo igual a 0.4.3 (o bot nunca fica mudo).

Regras (decisoes de 24/11):
  - Desativada: o bot recebe null para a chave e M() devolve '' (o trecho some). Sem nada desativado, a saida e
    identica a da 0.4.3 (as limpezas de linha em branco so rodam quando ha alguma desativada).
  - Mensagem inteira vazia nao e enviada: resposta do grupo (WF 03), comando ixc (WF 03), lembrete (WF 02), aviso (WF 01).
  - WF 01: tipo de aviso desativado (aviso.novo, aviso.transferido, aviso.assumido, aviso.sem_tecnico,
    aviso.segue_sem_tecnico, aviso.escalado) = o aviso nao sai e e registrado como ignorado ("aviso desativado no
    Painel do Bot"). aviso.corpo / aviso.folga / aviso.sem_tecnico_linha desativados = so o trecho some.
  - WF 04: alerta.planilha desativado = nao avisa no grupo de automacao (a contagem de falhas continua).
  - WF 03 mensagens novas (chave resp.N, ativas): mensagem do grupo (ate 200 caracteres) que contem uma das frases
    (palavras inteiras, na ordem; acento/maiuscula/pontuacao nao importam; a mensagem tambem vale sem hifen) recebe o texto da mensagem, com o cabecalho
    do bot e telefone (dd) nnnnn-nnnn virando @. Tem prioridade sobre setores e escala. grupos = 'recados' so no Recados.
    Responde so nos grupos de escala_grupos (como as outras respostas).
"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v030_mensagens_perguntas import troca, no
from v042_vinculo_renomeado import achar, ler, gravar, W01, W03

W02 = "02_IXC_Lembretes_de_Visita.json"
W04 = "04_Escalas_Sync_Planilha.json"

# ---------- config: desativada vem null ----------
Q_VELHO = "'mensagens', (SELECT coalesce(json_object_agg(m.chave, m.texto), '{}'::json) FROM ixc.mensagens m WHERE m.texto IS NOT NULL)"
Q_NOVO = ("'mensagens', (SELECT coalesce(json_object_agg(m.chave, CASE WHEN (to_jsonb(m)->>'ativo') = 'false' THEN NULL ELSE m.texto END), '{}'::json) "
          "FROM ixc.mensagens m WHERE m.texto IS NOT NULL OR (to_jsonb(m)->>'ativo') = 'false')")
CONFIGS = [(W01, "Carregar Config"), (W02, "Carregar Config"), (W03, "IXC Cmd: Carregar"), (W03, "Escala: Buscar Dados")]

# ---------- M(): desativada = '' ----------
M_VELHO = "function M(chave, padrao, v) {\n  const t = typeof MSG_[chave] === 'string'"
M_NOVO = ("function M(chave, padrao, v) {\n  if (MSG_[chave] === null) return '';  // 0.5.0: desativada no Painel do Bot\n"
          "  const t = typeof MSG_[chave] === 'string'")
COM_M = [(W01, "Montar Mensagem"), (W01, "Anexar Planta"), (W02, "Montar Lembrete"),
         (W03, "IXC Cmd: Interpretar"), (W03, "IXC Cmd: Finalizar"), (W03, "Escala: Montar Resposta")]
OFF = "const OFF_ = Object.keys(MSG_).some(k => MSG_[k] === null);  // 0.5.0: alguma mensagem desativada no Painel do Bot\n"

# ---------- WF 01 ----------
R_VELHO = """  out.push({ pairedItem: { item: e.i }, json: Object.assign(base, {
    ignorado: false, chamado, cliente,"""
R_NOVO = """  // 0.5.0: tipo de aviso desativado no Painel do Bot -> nao envia, registra como ignorado
  const MSG_OFF_ = (() => { try { let c = $('Carregar Config').first().json.cfg; if (typeof c === 'string') c = JSON.parse(c); return (c && c.mensagens) || {}; } catch (x) { return {}; } })();
  if (chave && MSG_OFF_[chave] === null) { out.push({ pairedItem: { item: e.i }, json: Object.assign(base, { ignorado: true, motivo: 'aviso desativado no Painel do Bot (' + chave + ')' }) }); continue; }
  out.push({ pairedItem: { item: e.i }, json: Object.assign(base, {
    ignorado: false, chamado, cliente,"""
MM_VELHO = "  out.push({ pairedItem: { item: i }, json: { empresa: d.empresa, id_chamado: d.id_chamado, protocolo: d.chamado.protocolo, evento: d.evento, texto, grupo_jid: d.grupo_jid, mentioned: marcar, planta } });"
MM_NOVO = ("  if (OFF_) texto = texto.split('\\n').filter(l => l.trim()).join('\\n');  // 0.5.0: trecho desativado nao deixa linha em branco\n" + MM_VELHO)
AP1_VELHO = """  const texto = simular ? M('envio.simulacao', '🧪 SIMULAÇÃO → {grupo}', { grupo: m.grupo_jid }) + '\\n' + m.texto : m.texto;"""
AP1_NOVO = """  if (!String(m.texto || '').trim()) return null;  // 0.5.0: mensagem inteira desativada no Painel do Bot: nao envia
  const cabSim = simular ? M('envio.simulacao', '🧪 SIMULAÇÃO → {grupo}', { grupo: m.grupo_jid }) : '';
  const texto = simular ? (cabSim ? cabSim + '\\n' : '') + m.texto : m.texto;"""
AP1_FIM_VELHO = """  return { pairedItem: { item: i }, json: { endpoint: base + (com ? '/api/sendImage' : '/api/sendText'), corpo, planta_info: (simular ? 'SIMULADO' + (info ? ' · ' + info : '') : info), simulado: simular } };
});"""
AP1_FIM_NOVO = """  return { pairedItem: { item: i }, json: { endpoint: base + (com ? '/api/sendImage' : '/api/sendText'), corpo, planta_info: (simular ? 'SIMULADO' + (info ? ' · ' + info : '') : info), simulado: simular } };
}).filter(Boolean);"""

# ---------- WF 02 ----------
L_VELHO = "if (ENVIO !== 'REAL') for (const o of out) { o.json.chat_envio = TESTE + '@c.us'; o.json.texto = M('envio.simulacao', '🧪 SIMULAÇÃO → {grupo}', { grupo: o.json.grupo_jid }) + '\\n' + o.json.texto; o.json.simulado = true; }\nreturn out;"
L_NOVO = ("// 0.5.0: lembrete desativado no Painel do Bot (texto vazio) nao sai; trecho desativado nao deixa linha em branco\n"
          "for (let k = out.length - 1; k >= 0; k--) { if (OFF_) out[k].json.texto = String(out[k].json.texto || '').split('\\n').filter(l => l.trim()).join('\\n'); if (!String(out[k].json.texto || '').trim()) out.splice(k, 1); }\n"
          "if (ENVIO !== 'REAL') for (const o of out) { const cs = M('envio.simulacao', '🧪 SIMULAÇÃO → {grupo}', { grupo: o.json.grupo_jid }); o.json.chat_envio = TESTE + '@c.us'; o.json.texto = (cs ? cs + '\\n' : '') + o.json.texto; o.json.simulado = true; }\nreturn out;")

# ---------- WF 03 ----------
P_VELHO = """       (SELECT coalesce(json_agg(json_build_object('alvo', p.alvo, 'frase_norm', p.frase_norm, 'grupos', p.grupos, 'ativo', p.ativo)), '[]'::json)::text FROM ixc.perguntas p) AS perguntas
FROM ixc.parametros"""
P_NOVO = """       (SELECT coalesce(json_agg(json_build_object('alvo', p.alvo, 'frase_norm', p.frase_norm, 'grupos', p.grupos, 'ativo', p.ativo)), '[]'::json)::text FROM ixc.perguntas p) AS perguntas,
       -- 0.5.0: mensagens novas do Painel do Bot 0.4.0 (resp.N ativas); to_jsonb: banco sem as colunas = lista vazia
       (SELECT coalesce(json_agg(json_build_object('chave', m.chave, 'f', to_jsonb(m)->'frases_norm', 'g', coalesce(to_jsonb(m)->>'grupos', 'todos'), 't', m.texto_padrao) ORDER BY m.chave), '[]'::json)::text
          FROM ixc.mensagens m WHERE (to_jsonb(m)->>'criada_painel') = 'true' AND coalesce(to_jsonb(m)->>'ativo', 'true') = 'true') AS respostas
FROM ixc.parametros"""
FP_VELHO = """// SETORES (04/10): "alguem do financeiro?\""""
FP_NOVO = """// 0.5.0 (Painel do Bot 0.4.0): MENSAGENS NOVAS criadas no painel = resposta fixa quando a mensagem tem uma das frases.
// Mesma regra das perguntas (palavras inteiras, na ordem, ate 200 caracteres); prioridade sobre setores e escala.
if (n.length <= 200) {
  let RS_ = [];
  try { RS_ = JSON.parse(String($('Carregar Parametros').first().json.respostas || '[]')); } catch (e) { RS_ = []; }
  if (Array.isArray(RS_) && RS_.length) {
    const recados_ = String($('Carregar Parametros').first().json.setores_grupo || '');
    // a mensagem tambem e comparada sem hifen: frase "wifi" vale para "wifi", "Wi-Fi" e "wi-fi"
    const nn_ = ' ' + n.replace(/[^a-z0-9 ]/g, ' ').replace(/\\s+/g, ' ').trim() + ' ';
    const nh_ = ' ' + n.replace(/-/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\\s+/g, ' ').trim() + ' ';
    const r_ = RS_.find(r => (r.g !== 'recados' || key.remoteJid === recados_) && (Array.isArray(r.f) ? r.f : []).some(f => f && (nn_.includes(' ' + f + ' ') || nh_.includes(' ' + f + ' '))));
    if (r_) return [{ json: { grupo: key.remoteJid, texto, id: key.id, participant: key.participant || null, fromMe: !!key.fromMe, resposta_fixa: String(r_.t || ''), resposta_chave: r_.chave } }];
  }
}
// SETORES (04/10): "alguem do financeiro?\""""
MR_GRUPOS_VELHO = """if (!grupos.includes(P0.grupo)) return [];
"""
MR_GRUPOS_NOVO = """if (!grupos.includes(P0.grupo)) return [];
const CAB_ = c => (c ? c + '\\n\\n' : '');  // 0.5.0: cabecalho desativado nao deixa linha em branco no topo
const marcarFones_ = (r, menc) => r.replace(/()\\((\\d{2})\\)\\s*(\\d{4,5})-(\\d{4})/g, (x, pre, dd, p1, p2) => { const num = '55' + dd + p1 + p2; if (!menc.includes(num)) menc.push(num); return pre + '@' + num; });
// 0.5.0: MENSAGEM NOVA do Painel do Bot (resposta fixa): cabecalho + texto; telefone (dd) nnnnn-nnnn vira @
if (P0.resposta_fixa !== undefined) {
  const corpo_ = String(P0.resposta_fixa || '').trim();
  if (!corpo_) return [];
  const menc = [];
  const resp = marcarFones_(CAB_(M('escala.cabecalho', '🤖 *Resposta automática do bot de escalas*')) + corpo_, menc);
  return [{ json: { grupo: P0.grupo, resposta: resp, mentioned: menc, resposta_chave: P0.resposta_chave, quoted: { key: { id: P0.id, remoteJid: P0.grupo, fromMe: P0.fromMe, participant: P0.participant }, message: { conversation: P0.texto } } } }];
}
"""
MR_SET_VELHO = """  let resp = M('escala.cabecalho', '🤖 *Resposta automática do bot de escalas*') + '\\n\\n' + blocos.join('\\n\\n');"""
MR_SET_NOVO = """  const corpoSet_ = (OFF_ ? blocos.filter(b => b.trim()) : blocos).join('\\n\\n');
  if (OFF_ && !corpoSet_.trim()) return [];  // 0.5.0: tudo desativado (so sobraria o cabecalho): nao responde
  let resp = CAB_(M('escala.cabecalho', '🤖 *Resposta automática do bot de escalas*')) + corpoSet_;
  if (OFF_) resp = resp.replace(/\\n{3,}/g, '\\n\\n').trim();"""
MR_SETL_VELHO = "    blocos.push(L.join('\\n'));"
MR_SETL_NOVO = "    blocos.push((OFF_ ? L.filter(x => String(x).trim()) : L).join('\\n'));"
MR_ESC_VELHO = """resposta = M('escala.cabecalho', '🤖 *Resposta automática do bot de escalas*') + '\\n\\n' + resposta;  // legenda do bot (regra de 04/10)"""
MR_ESC_NOVO = """if (OFF_ && !String(resposta || '').trim()) return [];  // 0.5.0: tudo desativado (so sobraria o cabecalho): nao responde
resposta = CAB_(M('escala.cabecalho', '🤖 *Resposta automática do bot de escalas*')) + resposta;  // legenda do bot (regra de 04/10)
if (OFF_) resposta = resposta.replace(/\\n{3,}/g, '\\n\\n').trim();  // 0.5.0: trechos desativados"""
CF_VELHO = "return [{ json: { sql, resposta } }];"
CF_NOVO = ("if (typeof resposta === 'string' && !resposta.trim() && sql === 'SELECT NULL::text AS msg') return [];  // 0.5.0: resposta desativada no Painel do Bot\n"
           "return [{ json: { sql, resposta } }];")

# ---------- WF 04 ----------
T_VELHO = """       (SELECT m.texto FROM ixc.mensagens m WHERE m.chave = 'alerta.planilha') AS msg_alerta_planilha
FROM ixc.parametros"""
T_NOVO = """       (SELECT m.texto FROM ixc.mensagens m WHERE m.chave = 'alerta.planilha') AS msg_alerta_planilha,
       -- 0.5.0: alerta desativado no Painel do Bot (to_jsonb: banco sem a coluna = ativo)
       coalesce((SELECT (to_jsonb(m)->>'ativo') = 'false' FROM ixc.mensagens m WHERE m.chave = 'alerta.planilha'), false) AS alerta_planilha_off
FROM ixc.parametros"""
E_VELHO = "    alerta: st.falhas === 3 ? String("
E_NOVO = "    alerta: st.falhas === 3 && !((($('Carregar Trocas').first() || {}).json || {}).alerta_planilha_off) ? String("  # 0.5.0


def main():
    raiz = sys.argv[1]
    P = {w: achar(raiz, w) for w in (W01, W02, W03, W04)}
    WF = {w: ler(p) for w, p in P.items()}
    for w, wf in WF.items():
        for n in wf["nodes"]:
            assert "0.5.0: desativada" not in n["parameters"].get("jsCode", ""), w + " ja esta na 0.5.0"
    assert "tecDoDia" in no(WF[W03], "Escala: Montar Resposta")["parameters"]["jsCode"], "WF 03 ainda nao esta na 0.4.2/0.4.3"
    assert "contido_" in no(WF[W03], "Escala: Montar Resposta")["parameters"]["jsCode"], "WF 03 ainda nao esta na 0.4.3 (rode o v043 antes)"
    for w, nome in CONFIGS:
        n = no(WF[w], nome)
        n["parameters"]["query"] = troca(n["parameters"]["query"], Q_VELHO, Q_NOVO, nome)
    for w, nome in COM_M:
        n = no(WF[w], nome)
        c = troca(n["parameters"]["jsCode"], M_VELHO, M_NOVO, nome)
        i = c.index("function M(chave")
        n["parameters"]["jsCode"] = c[:i] + OFF + c[i:]
    # WF 01
    n = no(WF[W01], "Rotear"); n["parameters"]["jsCode"] = troca(n["parameters"]["jsCode"], R_VELHO, R_NOVO, "Rotear")
    n = no(WF[W01], "Montar Mensagem"); n["parameters"]["jsCode"] = troca(n["parameters"]["jsCode"], MM_VELHO, MM_NOVO, "Montar Mensagem")
    n = no(WF[W01], "Anexar Planta")
    c = troca(n["parameters"]["jsCode"], AP1_VELHO, AP1_NOVO, "Anexar Planta (01)")
    n["parameters"]["jsCode"] = troca(c, AP1_FIM_VELHO, AP1_FIM_NOVO, "Anexar Planta (01)")
    # WF 02
    n = no(WF[W02], "Montar Lembrete"); n["parameters"]["jsCode"] = troca(n["parameters"]["jsCode"], L_VELHO, L_NOVO, "Montar Lembrete")
    # WF 03
    n = no(WF[W03], "Carregar Parametros"); n["parameters"]["query"] = troca(n["parameters"]["query"], P_VELHO, P_NOVO, "Carregar Parametros")
    n = no(WF[W03], "Escala: Filtrar Pergunta"); n["parameters"]["jsCode"] = troca(n["parameters"]["jsCode"], FP_VELHO, FP_NOVO, "Filtrar Pergunta")
    n = no(WF[W03], "Escala: Montar Resposta")
    c = n["parameters"]["jsCode"]
    for a, b in ((MR_GRUPOS_VELHO, MR_GRUPOS_NOVO), (MR_SET_VELHO, MR_SET_NOVO), (MR_SETL_VELHO, MR_SETL_NOVO), (MR_ESC_VELHO, MR_ESC_NOVO)):
        c = troca(c, a, b, "Montar Resposta")
    n["parameters"]["jsCode"] = c
    n = no(WF[W03], "IXC Cmd: Finalizar"); n["parameters"]["jsCode"] = troca(n["parameters"]["jsCode"], CF_VELHO, CF_NOVO, "IXC Cmd: Finalizar")
    # WF 04
    n = no(WF[W04], "Carregar Trocas"); n["parameters"]["query"] = troca(n["parameters"]["query"], T_VELHO, T_NOVO, "Carregar Trocas")
    n = no(WF[W04], "Montar Escala"); n["parameters"]["jsCode"] = troca(n["parameters"]["jsCode"], E_VELHO, E_NOVO, "Montar Escala")
    for w in (W01, W02, W03, W04):
        gravar(raiz, P[w], WF[w])
    print("ok -> 0.5.0 (mensagens desativadas e mensagens novas do Painel do Bot 0.4.0)")


if __name__ == "__main__":
    main()
