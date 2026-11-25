// Confere o contrato na origem e o CNPJ/CPF do cliente. Sai 1 item por O.S. (os que não seguem levam o motivo e pular=true).
const cfg = $('Config').first().json.cfg;
const fin = $('Finalizadas').first().json;
const BASES = Object.keys(cfg.ORIGENS);
const ler = {};
for (const b of BASES) {
  const rc = parseTolerante($('Contratos ' + b).first().json), rk = parseTolerante($('Clientes ' + b).first().json);
  ler[b] = { eContr: falhou(rc), eCli: falhou(rk),
    contratos: new Map(regs(rc).map(x => [String(x.id), x])), clientes: new Map(regs(rk).map(x => [String(x.id), x])) };
}
const ignorar = new Set((cfg.IGNORAR_DOCS || []).map(digitos));
const out = [];
for (const o of fin.os) {
  const L = ler[o.base];
  const it = { ...o, pular: true, motivo: '', situacao: 'aguardando', doc: '', status_origem: '', nome: '' };
  const cli = L.clientes.get(o.id_cliente);
  if (cli) it.nome = String(cli.fantasia || cli.razao || '').slice(0, 80);
  if (L.eContr) it.motivo = 'erro ao ler contratos na ' + o.base + ': ' + L.eContr;
  else if (L.eCli) it.motivo = 'erro ao ler clientes na ' + o.base + ': ' + L.eCli;
  else if (!o.id_contrato || o.id_contrato === '0') it.motivo = 'O.S. sem contrato (' + (o.campo_contrato || 'campo do contrato não encontrado') + ' vazio)';
  else if (!L.contratos.has(o.id_contrato)) it.motivo = 'contrato ' + o.id_contrato + ' não encontrado na ' + o.base;
  else {
    const ct = L.contratos.get(o.id_contrato);
    it.status_origem = String(ct.status || '');
    if (String(ct.id_cliente || '') && String(ct.id_cliente) !== o.id_cliente) it.motivo = 'contrato ' + o.id_contrato + ' é de outro cliente na ' + o.base;
    else if (!cfg.STATUS_ORIGEM_OK.includes(it.status_origem)) it.motivo = 'contrato ' + o.id_contrato + ' na ' + o.base + ' está "' + (it.status_origem || 'vazio') + '" (aguarda ficar ativo)';
    else if (!cli) it.motivo = 'cliente ' + o.id_cliente + ' não encontrado na ' + o.base;
    else {
      it.doc = digitos(cli.cnpj_cpf);
      if (it.doc.length !== 11 && it.doc.length !== 14) { it.motivo = 'cliente sem CNPJ/CPF válido na ' + o.base; it.situacao = 'revisar'; }
      else if (ignorar.has(it.doc)) { it.motivo = 'CNPJ/CPF na lista IGNORAR_DOCS'; it.situacao = 'ignorado'; }
      else it.pular = false;
    }
  }
  it.corpo_doc_fmt = it.pular ? VAZIO('cliente') : { qtype: 'cliente.cnpj_cpf', query: formatarDoc(it.doc), oper: '=', page: '1', rp: '20' };
  it.corpo_doc_num = it.pular ? VAZIO('cliente') : { qtype: 'cliente.cnpj_cpf', query: it.doc, oper: '=', page: '1', rp: '20' };
  out.push({ json: it });
}
if (!out.length) out.push({ json: { vazio: true, pular: true, motivo: 'nenhuma O.S. nova', corpo_doc_fmt: VAZIO('cliente'), corpo_doc_num: VAZIO('cliente') } });
return out;
