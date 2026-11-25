// Confere cada ativação relendo o contrato. Só marca a O.S. como resolvida quando o contrato ficou ativo.
const cfg = $('Config').first().json.cfg;
const st = $getWorkflowStaticData('global'); st.feitos = st.feitos || {};
const dec = $('Ativar?').all(0), atv = $('Ativar RESOLUTTO').all(), rel = $input.all();
return rel.map((r, i) => {
  const it = { ...dec[i].json };
  const ra = parseTolerante(atv[i].json), rr = parseTolerante(r.json);
  const ea = (ra && ra.type === 'error') ? String(ra.message || 'erro') : (ra && ra.erro_parse) ? ra.erro_parse : '';
  const ct = regs(rr)[0];
  const st2 = ct ? String(ct.status) : '?';
  it.resposta_ixc = ra && ra.message ? String(ra.message).slice(0, 300) : '';
  if (cfg.STATUS_ATIVO.includes(st2)) {
    it.situacao = 'ativado'; it.motivo = 'contrato ' + it.id_contrato_res + ' ativado na RESOLUTTO';
    st.feitos[it.base + ':' + it.id_os] = Date.now();
  } else {
    it.situacao = 'erro'; it.motivo = 'contrato ' + it.id_contrato_res + ' continua "' + st2 + '"' + (ea ? ' — IXC: ' + ea : '');
  }
  delete it.payload; delete it.corpo_reler;
  return { json: it };
});
