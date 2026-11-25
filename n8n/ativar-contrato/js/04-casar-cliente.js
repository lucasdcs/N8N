// (1 vez por item) Acha o cliente da RESOLUTTO com o mesmo CNPJ/CPF (compara só os dígitos).
const c = $('Candidatos').item.json;
const it = { ...c, id_cliente_res: '', corpo_contratos_res: VAZIO('cliente_contrato') };
if (!c.pular) {
  const r1 = parseTolerante($('Cliente RESOLUTTO (formatado)').item.json), r2 = parseTolerante($input.item.json);
  const e = falhou(r1) || falhou(r2);
  if (e) { it.pular = true; it.motivo = 'erro ao buscar o cliente na RESOLUTTO: ' + e; }
  else {
    const achados = new Map();
    for (const x of [...regs(r1), ...regs(r2)]) if (digitos(x.cnpj_cpf) === c.doc) achados.set(String(x.id), x);
    if (achados.size === 0) { it.pular = true; it.motivo = 'nenhum cliente com este CNPJ/CPF na RESOLUTTO'; it.situacao = 'revisar'; }
    else if (achados.size > 1) { it.pular = true; it.motivo = achados.size + ' clientes com este CNPJ/CPF na RESOLUTTO (ids ' + [...achados.keys()].join(', ') + ')'; it.situacao = 'revisar'; }
    else {
      it.id_cliente_res = [...achados.keys()][0];
      it.corpo_contratos_res = corpoIds('cliente_contrato', 'id_cliente', [it.id_cliente_res]);
    }
  }
}
return { json: it };
