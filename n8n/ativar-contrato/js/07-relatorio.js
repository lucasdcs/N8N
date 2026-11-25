// Resumo da rodada (O.S. que não foram ativadas). Em REAL, as já ativas na RESOLUTTO não são relidas nas próximas rodadas.
const cfg = $('Config').first().json.cfg;
const fin = $('Finalizadas').first().json;
const st = $getWorkflowStaticData('global'); st.feitos = st.feitos || {};
const itens = $input.all().map(x => x.json).filter(x => !x.vazio);
if (cfg.MODO === 'REAL') for (const x of itens) if (x.situacao === 'ja_ativo') st.feitos[x.base + ':' + x.id_os] = Date.now();
const cont = {};
for (const x of itens) cont[x.situacao] = (cont[x.situacao] || 0) + 1;
const resumo = { resumo: true, modo: cfg.MODO, janela_desde: cfg.desde, os_lidas: fin.os.length, ja_resolvidas: fin.ja_feitas,
  cortadas_pelo_limite: fin.cortadas, por_situacao: cont, erros_leitura: fin.erros, campos_contrato_vistos: fin.campos };
const linhas = itens.map(x => ({ json: { base: x.base, os: x.id_os, cliente: x.nome, doc: x.doc ? x.doc.slice(0, 4) + '…' : '',
  situacao: x.situacao, motivo: x.motivo, contrato_resolutto: x.id_contrato_res || '' } }));
return [{ json: resumo }, ...linhas];
