#!/usr/bin/env python3
"""whatsapp-ixc 0.3.0 — textos e perguntas editaveis pelo Painel do Bot (GLPI, plugin painelbot).

Aplica sobre a 0.2.6 (saida do adaptar_waha.py + v020 + v021), no lugar:
  python3 scripts/v030_mensagens_perguntas.py <pasta com n8n/ e fontes/>

O que muda (23/11/2026):
  - Mensagens: cada texto do bot passa por M(chave, padrao, vars). Se ixc.mensagens.texto (editado no painel) existir,
    usa ele; senao o padrao embutido aqui (igual ao de antes). Linha cuja variavel veio vazia some (ex.: sem telefone).
  - Perguntas de setor (WF 03, "Escala: Filtrar Pergunta"): o reconhecimento de hoje (regex) CONTINUA e soma as frases
    ligadas de ixc.perguntas (decisao de 23/11, opcao a). Frase padrao DESLIGADA no painel vence a regex: se a mensagem
    tem uma frase desligada do setor e nenhuma ligada, o setor nao responde. grupos = 'recados' so vale no grupo Recados.
  - Mencoes: o telefone "(dd) nnnn-nnnn" vira @ em qualquer linha da resposta (antes so nas linhas com 👤), para o texto
    poder ser editado sem quebrar a marcacao.
Exige as tabelas ixc.mensagens e ixc.perguntas (painelbot/sql/01-mensagens-perguntas.sql) no banco do bot.
Falha alto (AssertionError) se o JSON de entrada nao for o esperado.
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v021_lembrete_particular import extrair_fontes  # mesma extracao das fontes/ (so os nos Code)

M_JS = r"""// 0.3.0 (Painel do Bot): textos editaveis em ixc.mensagens; sem texto editado usa o padrao embutido na chamada.
const MSG_ = (() => { try { let c = $('__NO__').first().json.cfg; if (typeof c === 'string') c = JSON.parse(c); return (c && c.mensagens) || {}; } catch (e) { return {}; } })();
function M(chave, padrao, v) {
  const t = typeof MSG_[chave] === 'string' && MSG_[chave].trim() ? MSG_[chave] : padrao;
  if (!v) return t;
  const vazio = k => v[k] === null || v[k] === undefined || String(v[k]) === '';
  return t.split('\n').map(l => {
    const ks = [...l.matchAll(/\{([a-z_]+)\}/g)].map(m => m[1]).filter(k => k in v);
    const vz = ks.filter(vazio);
    // linha so com variaveis vazias (e emoji/pontuacao): some
    if (ks.length && vz.length === ks.length && !/[\p{L}\p{N}]/u.test(l.replace(/\{[a-z_]+\}/g, ''))) return null;
    const s = l.replace(/\{([a-z_]+)\}/g, (x, k) => (k in v ? (vazio(k) ? '' : String(v[k])) : x));
    return vz.length ? s.replace(/[\s—·:-]+$/u, '') : s;
  }).filter(l => l !== null).join('\n');
}
"""


def troca(txt, velho, novo, no, todas=False):
    n = txt.count(velho)
    assert (n >= 1 if todas else n == 1), f"{no}: trecho esperado nao encontrado (ou repetido {n}x): {velho[:80]!r}"
    return txt.replace(velho, novo)


def com_m(code, no_cfg, no):
    """Poe o helper M() no comeco do codigo do no (le os textos do no de config indicado)."""
    assert 'function M(chave' not in code, f"{no}: ja tem M() (0.3.0 aplicada?)"
    return M_JS.replace('__NO__', no_cfg) + code


# ---------------------------------------------------------------- WF 03: trechos de escala (iguais em 2 nos)
ESCALA_COMUM = [
    (r"""return b.tecnicos ? b.tecnicos.replace(/;/g, ' /') : '_(escala do dia não encontrada na planilha)_';""",
     r"""return b.tecnicos ? b.tecnicos.replace(/;/g, ' /') : M('escala.sem_escala_dia', '_(escala do dia não encontrada na planilha)_');"""),
    (r"""return b.tecnicos ? b.tecnicos.replace(/;/g, ' /') : 'sem técnico cadastrado';""",
     r"""return b.tecnicos ? b.tecnicos.replace(/;/g, ' /') : M('escala.sem_tecnico', 'sem técnico cadastrado');"""),
    (r"""if (horaAgora < ini) return ' · ⏳ começa às ' + ini;""",
     r"""if (horaAgora < ini) return M('escala.status.comeca', ' · ⏳ começa às {inicio}', { inicio: ini });"""),
    (r"""if (horaAgora <= fim) return ' · 🟢 em atendimento (até ' + fim + ')';""",
     r"""if (horaAgora <= fim) return M('escala.status.atendendo', ' · 🟢 em atendimento (até {fim})', { fim });"""),
    (r"""return ' · 🔴 encerrou às ' + fim;""",
     r"""return M('escala.status.encerrou', ' · 🔴 encerrou às {fim}', { fim });"""),
    (r"""  return rot + ' — ' + hfmt(h) + (agora ? statusAgora(h) : '') + '\n' + pessoas;""",
     r"""  return M('escala.shopping.dia', '*{rotulo} ({dia} {data})* — {horario}{status}', Object.assign(rv, { horario: hfmt(h), status: agora ? statusAgora(h) : '' })) + '\n' + pessoas;"""),
    (r"""  const linhas = ['🏬 *' + loc.nome + '* (' + (EMP[loc.empresa] || loc.empresa) + ')' + (b.tipo === '12x36' ? ' · 12x36' : ''),""",
     r"""  const linhas = [M('escala.shopping.titulo', '🏬 *{shopping}* ({empresa}){regime}', { shopping: loc.nome, empresa: EMP[loc.empresa] || loc.empresa, regime: b.tipo === '12x36' ? ' · 12x36' : '' }),"""),
    (r"""return linhas.concat(['Horário: ' + semana(b)])""",
     r"""return linhas.concat([M('escala.shopping.horario', 'Horário: {semana}', { semana: semana(b) })])"""),
    (r"""const linhas = ['👷 *Quem atende hoje* (' + DIAS_TXT[diaSem(hojeIso)] + ' ' + ddmm(hojeIso) + ', ' + horaAgora + ')'];""",
     r"""const linhas = [M('escala.quem_hoje.titulo', '👷 *Quem atende hoje* ({dia} {data}, {hora})', { dia: DIAS_TXT[diaSem(hojeIso)], data: ddmm(hojeIso), hora: horaAgora })];"""),
    (r"""'Não achei shopping nem técnico "' + q + '". Tente *ixc quem hoje* ou *ixc lista*.'""",
     r"""M('cmd.nao_achei_nada', 'Não achei shopping nem técnico "{busca}". Tente *ixc quem hoje* ou *ixc lista*.', { busca: q })"""),
    (r"""return { erro: 'Não achei o shopping "' + q + '". Veja os nomes com *ixc lista*.' };""",
     r"""return { erro: M('cmd.nao_achei_shopping', 'Não achei o shopping "{busca}". Veja os nomes com *ixc lista*.', { busca: q }) };"""),
    (r"""return { erro: 'Não achei o técnico "' + q + '"' + (emp ? ' na ' + emp : '') + '. Veja com *ixc tecnicos*' + (emp ? ' ' + emp : '') + ' (técnico novo: *ixc novo tecnico*).' };""",
     r"""return { erro: M('cmd.nao_achei_tecnico', 'Não achei o técnico "{busca}"{na_empresa}. Veja com *ixc tecnicos*{empresa} (técnico novo: *ixc novo tecnico*).', { busca: q, na_empresa: emp ? ' na ' + emp : '', empresa: emp ? ' ' + emp : '' }) };"""),
]
ESCALA_MONTAR = [
    (r"""  const rot = '*' + (agora ? 'Hoje' : 'Amanhã') + ' (' + DIAS_TXT[diaSem(iso)] + ' ' + ddmm(iso) + ')*';
  if (!h) return rot + ': não atende';""",
     r"""  const rv = { rotulo: agora ? 'Hoje' : 'Amanhã', dia: DIAS_TXT[diaSem(iso)], data: ddmm(iso) };
  if (!h) return M('escala.shopping.nao_atende', '*{rotulo} ({dia} {data})*: não atende', rv);"""),
    (r"""linhas.push('\n', '*Próximo atendimento (' + DIAS_TXT[diaSem(px)] + ' ' + ddmm(px) + ')* — ' + hfmt(b[diaSem(px)]) + '\n' + pessoasDe(loc, px));""",
     r"""linhas.push('\n', M('escala.shopping.proximo', '*Próximo atendimento ({dia} {data})* — {horario}', { dia: DIAS_TXT[diaSem(px)], data: ddmm(px), horario: hfmt(b[diaSem(px)]) }) + '\n' + pessoasDe(loc, px));"""),
]
ESCALA_INTERPRETAR = [
    (r"""  const rot = (agora ? 'Hoje' : 'Amanhã') + ' (' + DIAS_TXT[diaSem(iso)] + ' ' + ddmm(iso) + ')';
  if (!h) return rot + ': não atende';""",
     r"""  const rv = { rotulo: agora ? 'Hoje' : 'Amanhã', dia: DIAS_TXT[diaSem(iso)], data: ddmm(iso) };
  if (!h) return M('escala.shopping.nao_atende', '*{rotulo} ({dia} {data})*: não atende', rv);"""),
    (r"""linhas.push('Próximo atendimento (' + DIAS_TXT[diaSem(px)] + ' ' + ddmm(px) + ') — ' + hfmt(b[diaSem(px)]) + '\n' + pessoasDe(loc, px));""",
     r"""linhas.push('\n', M('escala.shopping.proximo', '*Próximo atendimento ({dia} {data})* — {horario}', { dia: DIAS_TXT[diaSem(px)], data: ddmm(px), horario: hfmt(b[diaSem(px)]) }) + '\n' + pessoasDe(loc, px));"""),
]
# a linha de cada pessoa (👤 nome — telefone) aparece 2-3x por no
PESSOA_VELHO = r"""'👤 ' + x.trim().replace(/ (\(\d{2}\))/, ' — $1')"""
PESSOA_NOVO = r"""pessoaTxt(x)"""
PESSOA_FN = r"""function pessoaTxt(x) {  // 0.3.0: "Nome (dd) nnnn-nnnn" -> mensagem escala.shopping.pessoa
  const m = String(x).trim().match(/^(.*?)\s*(\(\d{2}\)\s*[\d-]+)?$/);
  return M('escala.shopping.pessoa', '👤 {tecnico} — {telefone}', { tecnico: m ? m[1] : String(x).trim(), telefone: m && m[2] ? m[2] : '' });
}
"""
CAB_VELHO = r"""'🤖 *Resposta automática do bot de escalas*\n\n'"""
CAB_NOVO = r"""M('escala.cabecalho', '🤖 *Resposta automática do bot de escalas*') + '\n\n'"""
MENCAO_VELHO = r"""/(👤[^\n]*?)\((\d{2})\)\s*(\d{4,5})-(\d{4})/g"""
MENCAO_NOVO = r"""/()\((\d{2})\)\s*(\d{4,5})-(\d{4})/g"""

SETOR = [
    (r"""const TIT = { rh: '👥 *RH*', financeiro: '💰 *Financeiro*', compras: '🛒 *Compras*', comercial: '💼 *Comercial*', n2: '🛠️ *Suporte N2*' };""",
     r"""const TIT = { rh: M('setor.titulo.rh', '👥 *RH*'), financeiro: M('setor.titulo.financeiro', '💰 *Financeiro*'), compras: M('setor.titulo.compras', '🛒 *Compras*'),
    comercial: M('setor.titulo.comercial', '💼 *Comercial*'), n2: M('setor.titulo.n2', '🛠️ *Suporte N2*') };"""),
    (r"""if (horaAgora < a) return '⏳ de plantão hoje, começa às ' + a; if (horaAgora <= b) return '🟢 de plantão agora (até ' + b + ')';""",
     r"""if (horaAgora < a) return M('setor.status.plantao_comeca', '⏳ de plantão hoje, começa às {inicio}', { inicio: a }); if (horaAgora <= b) return M('setor.status.plantao_agora', '🟢 de plantão agora (até {fim})', { fim: b });"""),
    (r"""return '🔴 plantão de hoje encerrou às ' + b + ' · próximo ' + DIAS_TXT[diaSem(px)] + ' ' + ddmm(px) + ' às ' + ((hEsc(c, px) || a + '-').split('-')[0]); }""",
     r"""return M('setor.status.plantao_encerrou', '🔴 plantão de hoje encerrou às {fim} · próximo {dia} {data} às {inicio}', { fim: b, dia: DIAS_TXT[diaSem(px)], data: ddmm(px), inicio: (hEsc(c, px) || a + '-').split('-')[0] }); }"""),
    (r"""return '🔴 folga hoje · plantão amanhã às ' + hEsc(c, amanha).split('-')[0];""",
     r"""return M('setor.status.folga_amanha', '🔴 folga hoje · plantão amanhã às {inicio}', { inicio: hEsc(c, amanha).split('-')[0] });"""),
    (r"""return '🔴 folga hoje (12x36)';""", r"""return M('setor.status.folga', '🔴 folga hoje (12x36)');"""),
    (r"""if (!ORD.some(d => c[d])) return '⚪ horário não informado';""", r"""if (!ORD.some(d => c[d])) return M('setor.status.sem_horario', '⚪ horário não informado');"""),
    (r"""return '🟢 atendendo agora (até ' + b + ')';""", r"""return M('setor.status.atendendo', '🟢 atendendo agora (até {fim})', { fim: b });"""),
    (r"""return '⏳ volta hoje às ' + a;""", r"""return M('setor.status.volta_hoje', '⏳ volta hoje às {inicio}', { inicio: a });"""),
    (r"""return '🔴 fora do horário · volta ' + (i === 1 ? 'amanhã' : DIAS_TXT[diaSem(iso)] + ' ' + ddmm(iso)) + ' às ' + iv2[0][0]; }""",
     r"""return M('setor.status.fora', '🔴 fora do horário · volta {quando} às {inicio}', { quando: i === 1 ? 'amanhã' : DIAS_TXT[diaSem(iso)] + ' ' + ddmm(iso), inicio: iv2[0][0] }); }"""),
    (r"""    return '⚪ horário não informado';
  };""", r"""    return M('setor.status.sem_horario', '⚪ horário não informado');
  };"""),
    (r"""L.push('👤 ' + c.nome + ' — ' + fmtFone(c.fone) + '\n🕐 ' + (c.escala ? '12x36 ' + nomeEsc(c) + ' ' + hfmt((EB[c.escala] || {})[diaSem(hojeIso)] || '') : (sem(c) || 'sem horário')) + ' · ' + status(c));""",
     r"""L.push(M('setor.contato', '👤 {nome} — {telefone}\n🕐 {horario} · {status}', { nome: c.nome, telefone: fmtFone(c.fone),
        horario: c.escala ? '12x36 ' + nomeEsc(c) + ' ' + hfmt((EB[c.escala] || {})[diaSem(hojeIso)] || '') : (sem(c) || 'sem horário'), status: status(c) }));"""),
    (r"""if (!cs.length) L.push('_sem contato cadastrado_');""", r"""if (!cs.length) L.push(M('setor.sem_contato', '_sem contato cadastrado_'));"""),
    (r"""blocos.push('📌 Para falar com *' + txt + '*, pergunte no grupo *Resolutto - Recados*: é lá que estão todos os setores (Financeiro, Comercial, Compras e RH).');""",
     r"""blocos.push(M('setor.ir_recados', '📌 Para falar com *{setores}*, pergunte no grupo *Resolutto - Recados*: é lá que estão todos os setores (Financeiro, Comercial, Compras e RH).', { setores: txt }));"""),
    (r"""const extras = achados.includes('PELOTAS') ? ['🏬 *Shopping Pelotas*\nSem técnico no momento (em fase de entrega de contrato).'] : [];""",
     r"""const extras = achados.includes('PELOTAS') ? [M('escala.pelotas', '🏬 *Shopping Pelotas*\nSem técnico no momento (em fase de entrega de contrato).')] : [];"""),
]

CMD = [
    (r"""const AJUDA = [
  '🛠️ *Comandos IXC* (só valem depois de *ixc ok*)',
  '',
  '*ixc lista* [empresa ou shopping] — quem é marcado em cada shopping',
  '*ixc tecnicos* [empresa] — técnicos e números',
  '*ixc quem* <shopping ou técnico> — quem atende, horário, hoje e amanhã (*ixc quem hoje* = todos)',
  '',
  '*ixc shopping* <shopping> *tecnico* <técnico> — troca o técnico do shopping',
  '*ixc numero* <técnico> <telefone> — troca o número do técnico',
  '*ixc incluir* <técnico ou telefone> *em* <shopping> — marca também essa pessoa quando o chamado ficar sem técnico',
  '*ixc remover* <técnico ou telefone> *de* <shopping>',
  '*ixc novo tecnico* <empresa> <id no IXC> <nome> <telefone>',
  '',
  '*ixc ok* — aplica a alteração pendente · *ixc cancelar* — descarta',
  '',
  'Ex.: _ixc shopping Tijucas tecnico Joao_ · _ixc numero Fulano 41 99999-0000_',
].join('\n');""",
     r"""const AJUDA = M('cmd.ajuda', '🛠️ *Comandos IXC* (só valem depois de *ixc ok*)\n\n*ixc lista* [empresa ou shopping] — quem é marcado em cada shopping\n*ixc tecnicos* [empresa] — técnicos e números\n*ixc quem* <shopping ou técnico> — quem atende, horário, hoje e amanhã (*ixc quem hoje* = todos)\n\n*ixc shopping* <shopping> *tecnico* <técnico> — troca o técnico do shopping\n*ixc numero* <técnico> <telefone> — troca o número do técnico\n*ixc incluir* <técnico ou telefone> *em* <shopping> — marca também essa pessoa quando o chamado ficar sem técnico\n*ixc remover* <técnico ou telefone> *de* <shopping>\n*ixc novo tecnico* <empresa> <id no IXC> <nome> <telefone>\n\n*ixc ok* — aplica a alteração pendente · *ixc cancelar* — descarta\n\nEx.: _ixc shopping Tijucas tecnico Joao_ · _ixc numero Fulano 41 99999-0000_');"""),
]
CMD_INTERPRETAR = [
    (r"""const linhas = ['📋 *Marcação por shopping*', '_técnico → chamado atribuído a ele marca ele; sem técnico → marca a lista_'];""",
     r"""const linhas = [M('cmd.lista.titulo', '📋 *Marcação por shopping*\n_técnico → chamado atribuído a ele marca ele; sem técnico → marca a lista_')];"""),
    (r"""const linhas = ['👷 *Técnicos*'];""", r"""const linhas = [M('cmd.tecnicos.titulo', '👷 *Técnicos*')];"""),
    (r"""return out({ resposta: '📅 *Próximos feriados (sem reaviso)*\n' + fs.map(""",
     r"""return out({ resposta: M('cmd.feriados.titulo', '📅 *Próximos feriados (sem reaviso)*') + '\n' + fs.map("""),
    (r"""return out({ resposta: 'Não entendi o comando. Mande *ixc ajuda* pra ver a lista.' });""",
     r"""return out({ resposta: M('cmd.nao_entendi', 'Não entendi o comando. Mande *ixc ajuda* pra ver a lista.') });"""),
]
CMD_FINALIZAR = [
    (r"""return [{ json: { sql, resposta: '❌ O número ' + d.fone_validar + ' não tem WhatsApp. Confere e manda de novo.' } }];""",
     r"""return [{ json: { sql, resposta: M('cmd.sem_whatsapp', '❌ O número {telefone} não tem WhatsApp. Confere e manda de novo.', { telefone: d.fone_validar }) } }];"""),
    (r"""else aviso = '\n⚠️ Não consegui confirmar se o número tem WhatsApp.';""",
     r"""else aviso = '\n' + M('cmd.nao_confirmou_whatsapp', '⚠️ Não consegui confirmar se o número tem WhatsApp.');"""),
    (r"""resposta = '📝 *Alteração pendente:* ' + d.resumo + aviso + '\n\nResponda *ixc ok* em até 15 min pra aplicar (ou *ixc cancelar*).';""",
     r"""resposta = M('cmd.pendente', '📝 *Alteração pendente:* {alteracao}\n\nResponda *ixc ok* em até 15 min pra aplicar (ou *ixc cancelar*).', { alteracao: d.resumo + aviso });"""),
]

FILTRO_VELHO = r"""if (setores.length) return [{ json: { grupo: key.remoteJid, texto, id: key.id, participant: key.participant || null, fromMe: !!key.fromMe, setores } }];"""
FILTRO_NOVO = r"""// 0.3.0 (Painel do Bot, decisao de 23/11 "opcao a"): as frases de ixc.perguntas SOMAM ao reconhecimento acima.
// Frase ligada do setor aciona; frase desligada (e nenhuma ligada) cala o setor mesmo que a regex tenha achado.
// grupos = 'recados': so vale no grupo de Recados. Mensagem com mais de 200 caracteres nao aciona (igual a regex).
if (n.length <= 200) {
  let PQ = [];
  try { PQ = JSON.parse(String($('Carregar Parametros').first().json.perguntas || '[]')); } catch (e) { PQ = []; }
  if (!Array.isArray(PQ)) PQ = [];
  const recados = String($('Carregar Parametros').first().json.setores_grupo || '');
  const nn = ' ' + n.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const tem = p => nn.includes(' ' + String(p.frase_norm || '') + ' ');
  for (const s of ['n2', 'financeiro', 'comercial', 'compras', 'rh']) {
    const lig = PQ.filter(p => p.alvo === s && p.ativo && (p.grupos !== 'recados' || key.remoteJid === recados)).some(tem);
    const desl = PQ.filter(p => p.alvo === s && !p.ativo).some(tem);
    if (lig && !setores.includes(s)) setores.push(s);
    else if (!lig && desl && setores.includes(s)) setores.splice(setores.indexOf(s), 1);
  }
}
""" + FILTRO_VELHO

Q_PARAM_03_VELHO = """       max(CASE WHEN chave = 'grupo_automacao' THEN valor END) AS grupo_automacao
FROM ixc.parametros"""
Q_PARAM_03_NOVO = """       max(CASE WHEN chave = 'grupo_automacao' THEN valor END) AS grupo_automacao,
       max(CASE WHEN chave = 'setores_grupo' THEN valor END) AS setores_grupo,
       -- 0.3.0: perguntas do Painel do Bot (texto, para nao depender do parse de json pelo no Postgres)
       (SELECT coalesce(json_agg(json_build_object('alvo', p.alvo, 'frase_norm', p.frase_norm, 'grupos', p.grupos, 'ativo', p.ativo)), '[]'::json)::text FROM ixc.perguntas p) AS perguntas
FROM ixc.parametros"""
Q_MSG = """,
 'mensagens', (SELECT coalesce(json_object_agg(m.chave, m.texto), '{}'::json) FROM ixc.mensagens m WHERE m.texto IS NOT NULL)
) AS cfg"""


def no(wf, nome):
    for n in wf['nodes']:
        if n['name'] == nome:
            return n
    raise AssertionError(f"no nao encontrado: {nome}")


def code(wf, nome, fn):
    n = no(wf, nome)
    n['parameters']['jsCode'] = fn(n['parameters']['jsCode'])


def query_msg(wf, nome):
    n = no(wf, nome)
    q = n['parameters']['query']
    assert q.rstrip().endswith(') AS cfg') and "'mensagens'" not in q, f"{nome}: query inesperada"
    n['parameters']['query'] = q.rstrip()[:-len(') AS cfg')].rstrip() + Q_MSG


def aplicar_lista(c, lista, nome):
    for v, nv in lista:
        c = troca(c, v, nv, nome)
    return c


def wf03(wf):
    query_msg(wf, 'Escala: Buscar Dados')
    query_msg(wf, 'IXC Cmd: Carregar')
    n = no(wf, 'Carregar Parametros')
    n['parameters']['query'] = troca(n['parameters']['query'], Q_PARAM_03_VELHO, Q_PARAM_03_NOVO, 'Carregar Parametros 03')

    def escala(nome_cfg, extra):
        def f(c):
            c = com_m(c, nome_cfg, nome_cfg)
            c = aplicar_lista(c, ESCALA_COMUM + CMD + extra, nome_cfg)
            c = troca(c, PESSOA_VELHO, PESSOA_NOVO, nome_cfg, todas=True)
            c = troca(c, 'function quemNoDia(loc, iso) {', PESSOA_FN + 'function quemNoDia(loc, iso) {', nome_cfg)
            c = troca(c, CAB_VELHO, CAB_NOVO, nome_cfg, todas=True)
            return c
        return f
    code(wf, 'Escala: Montar Resposta', lambda c: troca(escala('Escala: Buscar Dados', ESCALA_MONTAR + SETOR)(c), MENCAO_VELHO, MENCAO_NOVO, 'Montar Resposta', todas=True))
    code(wf, 'IXC Cmd: Interpretar', escala('IXC Cmd: Carregar', ESCALA_INTERPRETAR + CMD_INTERPRETAR))
    code(wf, 'IXC Cmd: Finalizar', lambda c: aplicar_lista(com_m(c, 'IXC Cmd: Carregar', 'Finalizar'), CMD_FINALIZAR, 'Finalizar'))
    code(wf, 'Escala: Filtrar Pergunta', lambda c: troca(c, FILTRO_VELHO, FILTRO_NOVO, 'Filtrar Pergunta'))


# ---------------------------------------------------------------- WF 01: avisos de chamado
ROTEAR = [
    ("let rota, emoji, label, semTec = false, folga = null;",
     "let rota, emoji, label, semTec = false, folga = null, chave = null, tempo = null, folgaV = null;  // 0.3.0: chave/tempo/folgaV = mensagens do painel"),
    ("emoji = msg.escalar ? '🚨' : '⚠️'; label = 'Chamado segue sem técnico há ' + t + (msg.escalar ? ' (escalado)' : '');",
     "emoji = msg.escalar ? '🚨' : '⚠️'; label = 'Chamado segue sem técnico há ' + t + (msg.escalar ? ' (escalado)' : ''); chave = msg.escalar ? 'aviso.escalado' : 'aviso.segue_sem_tecnico'; tempo = t;"),
    ("} else { emoji = '⚠️'; label = 'Chamado sem técnico há 10+ min'; }",
     "} else { emoji = '⚠️'; label = 'Chamado sem técnico há 10+ min'; chave = 'aviso.sem_tecnico'; }"),
    ("{ emoji = '🆕'; label = 'Novo chamado'; }", "{ emoji = '🆕'; label = 'Novo chamado'; chave = 'aviso.novo'; }"),
    ("{ emoji = '📨'; label = 'Chamado transferido'; }", "{ emoji = '📨'; label = 'Chamado transferido'; chave = 'aviso.transferido'; }"),
    ("{ emoji = '👤'; label = 'Chamado assumido'; }", "{ emoji = '👤'; label = 'Chamado assumido'; chave = 'aviso.assumido'; }"),
    ("folga = tAtrib.nome + ' está de folga hoje — plantão no ' + loc.nome + ': ' + pl.nomes.join(' e ');",
     "folga = tAtrib.nome + ' está de folga hoje — plantão no ' + loc.nome + ': ' + pl.nomes.join(' e ');\n        folgaV = { tecnico: tAtrib.nome, shopping: loc.nome, plantao: pl.nomes.join(' e ') };"),
    ("evento_emoji: emoji, evento_label: label, folga,", "evento_emoji: emoji, evento_label: label, folga, evento_chave: chave, tempo, folga_v: folgaV,"),
]
MONTAR_VELHO = r"""  let texto = d.evento_emoji + ' ' + d.evento_label + (quem ? ' — ' + quem : '');
  if (d.folga) texto += '\n⚠️ ' + d.folga;
  texto += '\n🎫 #' + d.chamado.protocolo + ' · ' + assunto;
  if (d.sem_tecnico) texto += '\n🏢 ' + (d.shopping || 'Local não identificado') + ' · sem técnico atribuído';
  else if (d.shopping) texto += '\n🏢 ' + d.shopping;
  const cli = d.cliente || {};
  const nomeCliente = (cli.razao || '').trim(), nomeLoja = (cli.fantasia || '').trim();
  const fone = [cli.whatsapp, cli.telefone_celular, cli.fone, cli.telefone_comercial]
    .map(f => (f || '').trim()).find(f => f.replace(/\D/g, '').length >= 8) || '';
  if (nomeCliente) texto += '\n👤 ' + nomeCliente;
  const numLoja = numeroLoja(d.chamado, cli), outroNome = nomeLoja && nomeLoja.toLowerCase() !== nomeCliente.toLowerCase();
  if (numLoja) texto += '\n🏬 ' + numLoja + (outroNome ? ' · ' + nomeLoja : '');
  else if (outroNome) texto += '\n🏬 Loja: ' + nomeLoja;
  if (fone) texto += '\n📞 ' + fone;
  const resumo = resumir(d.mensagem, 150);
  if (resumo) texto += '\n💬 ' + resumo;"""
MONTAR_NOVO = r"""  // 0.3.0: cabecalho, folga e linhas do chamado pelas mensagens do Painel do Bot (aviso.*); linha vazia some
  const AV = { 'aviso.novo': '🆕 Novo chamado — {marcados}', 'aviso.transferido': '📨 Chamado transferido — {marcados}', 'aviso.assumido': '👤 Chamado assumido — {marcados}',
    'aviso.sem_tecnico': '⚠️ Chamado sem técnico há 10+ min — {marcados}', 'aviso.segue_sem_tecnico': '⚠️ Chamado segue sem técnico há {tempo} — {marcados}',
    'aviso.escalado': '🚨 Chamado segue sem técnico há {tempo} (escalado) — {marcados}' };
  let texto = AV[d.evento_chave] ? M(d.evento_chave, AV[d.evento_chave], { marcados: quem, tempo: d.tempo || '' })
    : d.evento_emoji + ' ' + d.evento_label + (quem ? ' — ' + quem : '');   // pedido de infra: fixo
  if (d.folga) texto += '\n' + (d.folga_v ? M('aviso.folga', '⚠️ {tecnico} está de folga hoje — plantão no {shopping}: {plantao}', d.folga_v) : '⚠️ ' + d.folga);
  const cli = d.cliente || {};
  const nomeCliente = (cli.razao || '').trim(), nomeLoja = (cli.fantasia || '').trim();
  const fone = [cli.whatsapp, cli.telefone_celular, cli.fone, cli.telefone_comercial]
    .map(f => (f || '').trim()).find(f => f.replace(/\D/g, '').length >= 8) || '';
  const numLoja = numeroLoja(d.chamado, cli), outroNome = nomeLoja && nomeLoja.toLowerCase() !== nomeCliente.toLowerCase();
  const resumo = resumir(d.mensagem, 150);
  texto += '\n' + M('aviso.corpo', '🎫 #{protocolo} · {assunto}\n🏢 {shopping}\n👤 {cliente}\n🏬 {loja}\n📞 {telefone}\n💬 {resumo}', {
    protocolo: d.chamado.protocolo, assunto,
    shopping: d.sem_tecnico ? M('aviso.sem_tecnico_linha', '{shopping} · sem técnico atribuído', { shopping: d.shopping || 'Local não identificado' }) : (d.shopping || ''),
    cliente: nomeCliente, loja: numLoja ? numLoja + (outroNome ? ' · ' + nomeLoja : '') : (outroNome ? 'Loja: ' + nomeLoja : ''),
    telefone: fone, resumo: resumo || '' });"""
SIMUL_01_VELHO = r"""const texto = simular ? '🧪 SIMULAÇÃO → ' + m.grupo_jid + '\n' + m.texto : m.texto;"""
SIMUL_01_NOVO = r"""const texto = simular ? M('envio.simulacao', '🧪 SIMULAÇÃO → {grupo}', { grupo: m.grupo_jid }) + '\n' + m.texto : m.texto;"""


def wf01(wf):
    query_msg(wf, 'Carregar Config')
    code(wf, 'Rotear', lambda c: aplicar_lista(c, ROTEAR, 'Rotear'))
    code(wf, 'Montar Mensagem', lambda c: troca(com_m(c, 'Carregar Config', 'Montar Mensagem'), MONTAR_VELHO, MONTAR_NOVO, 'Montar Mensagem'))
    code(wf, 'Anexar Planta', lambda c: troca(com_m(c, 'Carregar Config', 'Anexar Planta 01'), SIMUL_01_VELHO, SIMUL_01_NOVO, 'Anexar Planta 01'))


# ---------------------------------------------------------------- WF 02: lembretes de visita
LEMB_10_VELHO = r"""    let curto = '⏰ Não esqueça: visita' + (quemVisita ? ' na *' + quemVisita + '*' : ' do chamado #' + c.protocolo) + (onde ? ' (' + onde + ')' : '')
      + ' daqui ' + n + (n === 1 ? ' minuto' : ' minutos') + ', às ' + hora + '.';
    if (quem) curto += '\n' + quem + (d.sem_tecnico ? ' · sem técnico atribuído' : '');"""
LEMB_10_NOVO = r"""    // 0.3.0: mensagem lembrete.10min do Painel do Bot
    const curto = M('lembrete.10min', '⏰ Não esqueça: visita {visita}{onde} daqui {minutos}, às {hora}.\n{marcados}', {
      visita: quemVisita ? 'na *' + quemVisita + '*' : 'do chamado #' + c.protocolo, onde: onde ? ' (' + onde + ')' : '',
      minutos: n + (n === 1 ? ' minuto' : ' minutos'), hora, marcados: quem ? quem + (d.sem_tecnico ? ' · sem técnico atribuído' : '') : '' });"""
LEMB_1H_VELHO = r"""  let texto = '⏰ *Lembrete de visita — ' + d.janela + '*' + (quem ? ' — ' + quem : '');
  if (d.sem_tecnico) texto += '\n🏢 ' + (d.shopping || 'Local não identificado') + ' · sem técnico atribuído';
  else if (d.shopping) texto += '\n🏢 ' + d.shopping;
  texto += '\n🕐 Visita às *' + hora + '*' + (fim && fim !== hora ? ' (até ' + fim + ')' : '');
  texto += '\n🎫 #' + c.protocolo + (assunto ? ' · ' + assunto : '');
  if (nomeCliente) texto += '\n👤 ' + nomeCliente;
  const outroNome = nomeLoja && nomeLoja.toLowerCase() !== nomeCliente.toLowerCase();
  if (numLoja) texto += '\n🏬 ' + numLoja + (outroNome ? ' · ' + nomeLoja : '');
  else if (outroNome) texto += '\n🏬 Loja: ' + nomeLoja;
  if (local) texto += '\n📍 ' + local;
  if (fone) texto += '\n📞 ' + fone;"""
LEMB_1H_NOVO = r"""  // 0.3.0: mensagem lembrete.1h do Painel do Bot (linha com variavel vazia some)
  const outroNome = nomeLoja && nomeLoja.toLowerCase() !== nomeCliente.toLowerCase();
  const texto = M('lembrete.1h', '⏰ *Lembrete de visita — {janela}* — {marcados}\n🏢 {shopping}\n🕐 Visita às *{hora}*{ate}\n🎫 #{protocolo} · {assunto}\n👤 {cliente}\n🏬 {loja}\n📍 {local}\n📞 {telefone}', {
    janela: d.janela, marcados: quem || '',
    shopping: d.sem_tecnico ? M('aviso.sem_tecnico_linha', '{shopping} · sem técnico atribuído', { shopping: d.shopping || 'Local não identificado' }) : (d.shopping || ''),
    hora, ate: fim && fim !== hora ? ' (até ' + fim + ')' : '', protocolo: c.protocolo, assunto: assunto || '', cliente: nomeCliente,
    loja: numLoja ? numLoja + (outroNome ? ' · ' + nomeLoja : '') : (outroNome ? 'Loja: ' + nomeLoja : ''), local, telefone: fone });"""
SIMUL_02_VELHO = r"""o.json.texto = '🧪 SIMULAÇÃO → ' + o.json.grupo_jid + '\n' + o.json.texto;"""
SIMUL_02_NOVO = r"""o.json.texto = M('envio.simulacao', '🧪 SIMULAÇÃO → {grupo}', { grupo: o.json.grupo_jid }) + '\n' + o.json.texto;"""


def wf02(wf):
    query_msg(wf, 'Carregar Config')
    code(wf, 'Montar Lembrete', lambda c: aplicar_lista(com_m(c, 'Carregar Config', 'Montar Lembrete'),
                                                        [(LEMB_10_VELHO, LEMB_10_NOVO), (LEMB_1H_VELHO, LEMB_1H_NOVO), (SIMUL_02_VELHO, SIMUL_02_NOVO)], 'Montar Lembrete'))


# ---------------------------------------------------------------- WF 04: alerta da planilha
Q_TROCAS_VELHO = """       coalesce(max(CASE WHEN chave = 'escala_ler_porto_belo' THEN valor END), 'sim') AS escala_ler_porto_belo
FROM ixc.parametros"""
Q_TROCAS_NOVO = """       coalesce(max(CASE WHEN chave = 'escala_ler_porto_belo' THEN valor END), 'sim') AS escala_ler_porto_belo,
       -- 0.3.0: texto do alerta editado no Painel do Bot (nulo = padrao do no Montar Escala)
       (SELECT m.texto FROM ixc.mensagens m WHERE m.chave = 'alerta.planilha') AS msg_alerta_planilha
FROM ixc.parametros"""
ALERTA_VELHO = r"""alerta: st.falhas === 3 ? '⚠️ Leitura da planilha ESCALAS falhou 3x seguidas (quem está no shopping pode ficar desatualizado): ' + e.message : null } }];"""
ALERTA_NOVO = r"""alerta: st.falhas === 3 ? String((($('Carregar Trocas').first() || {}).json || {}).msg_alerta_planilha || '⚠️ Leitura da planilha ESCALAS falhou 3x seguidas (quem está no shopping pode ficar desatualizado): {erro}').split('{erro}').join(e.message) : null } }];   // 0.3.0: alerta.planilha"""


def wf04(wf):
    n = no(wf, 'Carregar Trocas')
    n['parameters']['query'] = troca(n['parameters']['query'], Q_TROCAS_VELHO, Q_TROCAS_NOVO, 'Carregar Trocas')
    code(wf, 'Montar Escala', lambda c: troca(c, ALERTA_VELHO, ALERTA_NOVO, 'Montar Escala'))


ARQS = {"01_IXC_Notificacoes_WhatsApp.json": wf01, "02_IXC_Lembretes_de_Visita.json": wf02,
        "03_IXC_Comandos_e_Consulta_de_Escala.json": wf03, "04_Escalas_Sync_Planilha.json": wf04}


def main():
    raiz = sys.argv[1]
    for arq, fn in ARQS.items():
        p = os.path.join(raiz, "n8n", arq)
        wf = json.load(open(p, encoding="utf-8"))
        fn(wf)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(wf, f, ensure_ascii=False, indent=1)
            f.write("\n")
        if os.path.isdir(os.path.join(raiz, "fontes")):
            extrair_fontes(wf, os.path.join(raiz, "fontes", arq[:-5]), wf["name"])
        print("ok", arq)


if __name__ == "__main__":
    main()
