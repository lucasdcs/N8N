#!/usr/bin/env python3
"""whatsapp-ixc 0.6.6 — pedido de infra pelo encaminhamento da O.S. (WF 01), com ou sem responsavel.

Ate a 0.6.5 o "pedido de infra" (particular de infra_fone) so saia quando uma mensagem da O.S. tinha uma frase de infra.
Problemas vistos em 27/11/2026:
  1. O.S. encaminhada ao responsavel pela infra (empresas.dono_id) ficava muda: desde a 0.6.0 o aviso do dono do numero
     e ignorado, e o pedido de infra pulava esse caso achando que o aviso normal cobria.
  2. O.S. de infra aberta sem responsavel so avisava se o texto tivesse frase de infra (o assunto nao contava).
  3. Falso positivo: citar outra O.S. ("replicar as informacoes da O.S de execucao de infra") disparava o pedido,
     mesmo com a O.S. ja finalizada.

O que muda (so no particular, aviso_privado = sim; o modo grupo fica como era, exceto o item d):
  a. Rotear: O.S. aberta ou transferida para o dono do numero (responsavel pela infra) -> "Pedido de infra" no
     particular de infra_fone, no lugar de nada. O registro "atribuido ao dono do numero" continua em ixc.eventos.
  b. Rotear: O.S. aberta com assunto em infra_assuntos, ou aberta/transferida estando num setor de infra_setores
     -> "Pedido de infra", com ou sem tecnico atribuido. O aviso normal do tecnico atribuido nao muda.
     Parametros 'EMPRESA:id' separados por virgula (ex.: '4B:15,BUZZ:33'); vazios = regra desligada.
  c. Processar Eventos: mensagem que so cita outra O.S. ("O.S de execucao/vistoria/avaliacao/pendencia de infra")
     nao conta como pedido.
  d. Rotear: O.S. ja finalizada (status F) quando o bot le nao gera pedido de infra (registra como ignorado).
Trava de 6 h por O.S. igual a do pedido escrito (mesma memoria do workflow): no maximo 1 pedido por O.S. a cada 6 h,
venha do texto, do dono, do assunto ou do setor.

Aplica no lugar, sobre o WF 01 0.6.1 ou posterior (producao, repositorio ou copia [SIM]). Grava so se as 4 trocas derem certo:
  python3 scripts/v066_infra_encaminhamento.py <pasta com n8n/ | /opt/ixc-simulador | arquivo .json do WF 01>
O arquivo solto pode ser o export do n8n (export:workflow --id=...): a lista de 1 workflow vira o objeto, pronto para
importar pela tela (Import from File) por cima do WF 01.
Teste: node scripts/check/teste17.js <WF 01 0.6.5> <WF 01 0.6.6>
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v030_mensagens_perguntas import troca, no
from v042_vinculo_renomeado import achar, ler, gravar, W01

MARCA = "infra_assuntos"

# ---------- Processar Eventos: citar outra O.S. de infra nao e pedido ----------
PE_VELHO = r"const RX_INFRA_NAO = /n[ãa]o\s+(?:necessita|precisa|iremos\s+encaminhar|vamos\s+encaminhar|h[aá]\s+necessidade)|^\s*Processo:/i;"
PE_NOVO = (r"const RX_INFRA_NAO = /n[ãa]o\s+(?:necessita|precisa|iremos\s+encaminhar|vamos\s+encaminhar|h[aá]\s+necessidade)|^\s*Processo:"
           r"|\bo\.?\s?s\.?\s+d[aeo]\s+(?:execu\S*|vistoria|avalia\S*|pend\S*)\s+d[aeo]\s+infra/i;"
           "  // 0.6.6: \"O.S de execucao de infra\" cita outra O.S., nao e pedido")

# ---------- Rotear ----------
R_DONO_VELHO = ("    if (tecChamado && tecChamado === String(E.dono_id)) continue; "
                "// ja esta com o responsável pela infra: o aviso normal cobre\n")
R_DONO_NOVO = ("    if (tecChamado && tecChamado === String(E.dono_id) && !PRIVADO_) continue; "
               "// ja esta com o responsável pela infra: o aviso normal (grupo dele) cobre; 0.6.6: no particular o aviso do dono nao sai, entao o pedido sai\n"
               "    if (String(chamado.status) === 'F') { out.push({ pairedItem: { item: e.i }, json: Object.assign(base, { ignorado: true, motivo: 'pedido de infra: O.S. já finalizada' }) }); continue; }  // 0.6.6\n")

R_LOOP_VELHO = "for (const e of porChamado.values()) {\n  const { msg, chamado, cliente, ev, emp } = e;\n"
R_LOOP_NOVO = """// 0.6.6: pedido de infra pelo encaminhamento, com ou sem responsavel (particular de infra_fone; so com aviso_privado):
//  - O.S. aberta ou transferida para o dono do numero (responsavel pela infra, empresas.dono_id);
//  - O.S. aberta com assunto de infra (infra_assuntos = 'EMPRESA:id,...');
//  - O.S. aberta ou transferida estando no setor de infra (infra_setores = 'EMPRESA:id,...').
// 1 pedido por O.S. a cada 6 h, a mesma trava do pedido escrito (Processar Eventos). O.S. ja finalizada nao avisa.
const listaEmp_ = s => new Set(String(s || '').split(',').map(x => x.replace(/\\s+/g, '')).filter(Boolean));
const INFRA_ASS_ = listaEmp_(C.param.infra_assuntos), INFRA_SET_ = listaEmp_(C.param.infra_setores);
const stI_ = $getWorkflowStaticData('global'); stI_.infra = stI_.infra || {};
function infraPeloChamado_(e, base, loc, pid) {
  const { chamado, emp, ev, msg } = e, E = C.empresas[emp] || {};
  if (!(e.novo || ev === '4')) return;  // so aberto ou transferido (assumido nao)
  const dono = !!(pid && E.dono_id && pid === String(E.dono_id));
  const porAssunto = e.novo && INFRA_ASS_.has(emp + ':' + chamado.id_assunto);
  const porSetor = INFRA_SET_.has(emp + ':' + chamado.setor);
  if (!dono && !porAssunto && !porSetor) return;
  const ki = emp + ':' + chamado.id;
  if (agoraMs - (stI_.infra[ki] || 0) < 6 * 3600000) return;  // ja avisado (texto, dono, assunto ou setor) nas ultimas 6 h
  const j = Object.assign({}, base, { evento: 'INFRA' });
  const foneI = String(C.param.infra_fone || '').replace(/\\D/g, '');
  if (String(chamado.status) === 'F') { out.push({ pairedItem: { item: e.i }, json: Object.assign(j, { ignorado: true, motivo: 'pedido de infra: O.S. já finalizada' }) }); return; }
  if (foneI.length < 12) { out.push({ pairedItem: { item: e.i }, json: Object.assign(j, { ignorado: true, motivo: 'pedido de infra: infra_fone não cadastrado' }) }); return; }
  stI_.infra[ki] = agoraMs;
  out.push({ pairedItem: { item: e.i }, json: Object.assign(j, {
    ignorado: false, chamado, cliente: e.cliente, mensagem: (e.novo && e.textoAbertura) || msg.mensagem || '', grupo_jid: foneI + '@c.us', marcar: [],
    nome: null, shopping: loc ? loc.nome : 'Local não identificado', sem_tecnico: false, evento_emoji: '🏗️',
    evento_label: 'Pedido de infra' + (pid && !dono ? ' — ' + nomePessoa(C, emp, pid) : ''), folga: null, evento_chave: null, tempo: null, folga_v: null,
    primeira: false,
  }) });
}
""" + R_LOOP_VELHO

R_PID_VELHO = ("    const pid = tecEvento || tecChamado;\n"
               "    if (!pid) continue; // aberto sem ninguem: espera o aviso SEMTEC\n")
R_PID_NOVO = ("    const pid = tecEvento || tecChamado;\n"
              "    if (PRIVADO_) infraPeloChamado_(e, base, loc, pid);  // 0.6.6: pedido de infra pelo encaminhamento (dono, assunto ou setor de infra)\n"
              "    if (!pid) continue; // aberto sem ninguem: espera o aviso SEMTEC\n")


def aplicar(wf):
    pe, ro = no(wf, "Processar Eventos"), no(wf, "Rotear")
    c = ro["parameters"]["jsCode"]
    assert MARCA not in c, "WF 01 ja esta na 0.6.6"
    assert "aviso_privado" in c and "aviso_max_rodada" in c, "WF 01 anterior a 0.6.1 (rode v060 e v061 antes)"
    assert "const PRIVADO_" in c and c.index("const PRIVADO_") < c.index(R_LOOP_VELHO), "Rotear: PRIVADO_ fora do lugar esperado"
    pe["parameters"]["jsCode"] = troca(pe["parameters"]["jsCode"], PE_VELHO, PE_NOVO, "Processar Eventos")
    c = troca(c, R_DONO_VELHO, R_DONO_NOVO, "Rotear")
    c = troca(c, R_LOOP_VELHO, R_LOOP_NOVO, "Rotear")
    c = troca(c, R_PID_VELHO, R_PID_NOVO, "Rotear")
    ro["parameters"]["jsCode"] = c


def main():
    alvo = sys.argv[1]
    solto = alvo.endswith(".json") and os.path.isfile(alvo)
    raiz, p = (os.path.dirname(os.path.abspath(alvo)), alvo) if solto else (alvo, achar(alvo, W01))
    wf = ler(p)
    if isinstance(wf, list):   # n8n export:workflow --id=... grava uma lista com 1 workflow
        assert len(wf) == 1, "esperava 1 workflow no arquivo, achei %d" % len(wf)
        wf = wf[0]
    aplicar(wf)
    if solto:
        with open(p, "w", encoding="utf-8") as f:
            json.dump(wf, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("  gravado:", p)
    else:
        gravar(raiz, p, wf)
    print("ok", os.path.basename(p), "-> 0.6.6 (pedido de infra pelo encaminhamento: dono, assunto e setor de infra)")


if __name__ == "__main__":
    main()
