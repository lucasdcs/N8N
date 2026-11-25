// Decide, por O.S., se ativa o único pré-contrato do cliente na RESOLUTTO.
const cfg = $('Config').first().json.cfg;
const base = $('Casar cliente').all();
const resp = $input.all();
const usados = new Set();
let ativacoes = 0;
const out = [];
resp.forEach((r, i) => {
  const it = { ...base[i].json, acao: 'nada', id_contrato_res: '' };
  delete it.corpo_doc_fmt; delete it.corpo_doc_num; delete it.corpo_contratos_res;
  if (!it.pular && !it.vazio) {
    const rc = parseTolerante(r.json), e = falhou(rc);
    const cts = e ? [] : regs(rc).filter(x => String(x.id_cliente) === it.id_cliente_res);
    const pre = cts.filter(x => cfg.STATUS_PRE.includes(String(x.status)));
    const ativos = cts.filter(x => cfg.STATUS_ATIVO.includes(String(x.status)));
    if (e) it.motivo = 'erro ao ler os contratos na RESOLUTTO: ' + e;
    else if (pre.length > 1) { it.motivo = pre.length + ' pré-contratos na RESOLUTTO (ids ' + pre.map(x => x.id).join(', ') + '): decidir manualmente'; it.situacao = 'revisar'; }
    else if (pre.length === 0 && ativos.length) { it.motivo = 'já ativo na RESOLUTTO (contrato ' + ativos.map(x => x.id).join(', ') + ')'; it.situacao = 'ja_ativo'; }
    else if (pre.length === 0) { it.motivo = 'nenhum pré-contrato na RESOLUTTO (contratos: ' + (cts.map(x => x.id + '=' + x.status).join(', ') || 'nenhum') + ')'; it.situacao = 'revisar'; }
    else {
      const ct = pre[0];
      it.id_contrato_res = String(ct.id);
      if (usados.has(it.id_contrato_res)) { it.motivo = 'contrato ' + ct.id + ' já entra nesta rodada por outra O.S.'; it.situacao = 'duplicada'; }
      else if (ativacoes >= cfg.MAX_ATIVACOES_RODADA) it.motivo = 'limite de ' + cfg.MAX_ATIVACOES_RODADA + ' ativações por rodada (fica para a próxima)';
      else {
        usados.add(it.id_contrato_res); ativacoes++;
        it.acao = cfg.MODO === 'REAL' ? 'ativar' : 'simular';
        it.situacao = it.acao === 'ativar' ? 'ativando' : 'simulado';
        it.motivo = (it.acao === 'ativar' ? 'ativar' : 'SIMULAR: ativaria') + ' o contrato ' + ct.id + ' do cliente ' + it.id_cliente_res + ' na RESOLUTTO';
        it.payload = { qtype: 'cliente_contrato_ativar_cliente.id', id_contrato: it.id_contrato_res };
        it.corpo_reler = corpoIds('cliente_contrato', 'id', [it.id_contrato_res]);
      }
    }
  }
  out.push({ json: it });
});
return out;
