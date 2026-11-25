// Junta as O.S. finalizadas das bases de origem, tira as já resolvidas e prepara a leitura de contratos e clientes.
const cfg = $('Config').first().json.cfg;
const BASES = Object.keys(cfg.ORIGENS);
const st = $getWorkflowStaticData('global');
st.feitos = st.feitos || {};
const limite = Date.now() - (cfg.JANELA_HORAS + 24) * 3600000;
for (const k of Object.keys(st.feitos)) if (!(st.feitos[k] >= limite)) delete st.feitos[k];

const lista = [], erros = {}, campos = {};
let jaFeitas = 0;
if (cfg.MODO !== 'NENHUM') for (const b of BASES) {
  const r = parseTolerante($('OS ' + b).first().json);
  const e = falhou(r);
  if (e) { erros[b] = 'leitura das O.S.: ' + e; continue; }
  const assuntos = cfg.ORIGENS[b].map(String);
  for (const o of regs(r)) {
    if (!campos[b]) campos[b] = Object.keys(o).filter(k => /contrato/i.test(k));
    // Conferência local (a API já filtrou; se algum filtro for ignorado pelo IXC, nada passa errado).
    if (String(o.status) !== 'F' || !assuntos.includes(String(o.id_assunto))) continue;
    if (String(o.data_fechamento || '') < cfg.desde) continue;
    if (st.feitos[b + ':' + o.id]) { jaFeitas++; continue; }
    const campo = CAMPOS_CONTRATO_OS.find(c => o[c] !== undefined);
    lista.push({ base: b, id_os: String(o.id), id_assunto: String(o.id_assunto), id_cliente: String(o.id_cliente || ''),
      id_contrato: campo ? String(o[campo] || '') : '', campo_contrato: campo || '', data_fechamento: String(o.data_fechamento || '') });
  }
}
lista.sort((a, b) => a.data_fechamento < b.data_fechamento ? -1 : a.data_fechamento > b.data_fechamento ? 1 : 0);
const cortadas = Math.max(0, lista.length - cfg.MAX_OS_RODADA);
const os = lista.slice(0, cfg.MAX_OS_RODADA);

const corpos = { contratos: {}, clientes: {} };
for (const b of BASES) {
  const da = os.filter(x => x.base === b);
  corpos.contratos[b] = da.length ? corpoIds('cliente_contrato', 'id', da.map(x => x.id_contrato)) : VAZIO('cliente_contrato');
  corpos.clientes[b] = da.length ? corpoIds('cliente', 'id', da.map(x => x.id_cliente)) : VAZIO('cliente');
}
return [{ json: { os, erros, campos, ja_feitas: jaFeitas, cortadas, corpos } }];
