/* Painel IXC — Relatório / Indicadores (ECharts do GLPI) */
(function iniciar() {
  'use strict';

  // O GLPI injeta o ECharts no fim da página (Html::requireJs), depois deste script: espera o load.
  if (document.readyState !== 'complete') {
    window.addEventListener('load', iniciar);
    return;
  }
  var raiz = document.getElementById('pixc-relatorio');
  if (!raiz) return;
  if (typeof echarts === 'undefined') {
    raiz.insertAdjacentHTML('afterbegin', '<div class="alert alert-danger">Biblioteca de gráficos (ECharts) não carregou. Recarregue a página.</div>');
    return;
  }

  var URL_DADOS = raiz.getAttribute('data-dados');
  var URL_CSV = raiz.getAttribute('data-csv');
  var $ = function (id) { return document.getElementById(id); };

  var PALETA = ['#2563eb', '#059669', '#d97706', '#db2777', '#7c3aed', '#0891b2', '#65a30d', '#dc2626', '#0f766e', '#9333ea', '#ca8a04', '#475569'];
  var CORES_STATUS = { Aberta: '#dc2626', 'Análise': '#9333ea', Encaminhada: '#2563eb', Assumida: '#0891b2', Agendada: '#059669',
    Reagendar: '#d97706', Deslocamento: '#0d9488', 'Execução': '#16a34a', Finalizada: '#475569', Cancelada: '#94a3b8' };

  var st = { opcoes: null, dados: null, graficos: {} };

  // 0.12.0 — tema escuro (petróleo): os gráficos usam um tema do ECharts com texto claro; o PDF sempre sai no claro
  var TEMA_ESCURO = 'pixc-petroleo';
  try {
    var tx = '#e3eef0', tx2 = '#a3bcc1', ln = 'rgba(163,188,193,.18)';
    var eixo = { axisLine: { lineStyle: { color: ln } }, axisTick: { lineStyle: { color: ln } }, axisLabel: { color: tx2 }, splitLine: { lineStyle: { color: ln } } };
    echarts.registerTheme(TEMA_ESCURO, {
      backgroundColor: 'transparent', textStyle: { color: tx }, title: { textStyle: { color: tx2 } },
      legend: { textStyle: { color: tx2 }, pageTextStyle: { color: tx2 } },
      tooltip: { backgroundColor: '#193840', borderColor: '#2b5964', textStyle: { color: tx } },
      categoryAxis: eixo, valueAxis: eixo, pie: { itemStyle: { borderColor: '#193840' }, label: { color: tx } }, bar: { label: { color: tx } }
    });
  } catch (e) { /* ECharts antigo: fica no padrão */ }
  var temaGraficos = (raiz.getAttribute('data-tema-ativo') === 'escuro') ? TEMA_ESCURO : null;
  function trocarTemaGraficos(t) {
    if (t === temaGraficos) return;
    temaGraficos = t;
    Object.keys(st.graficos).forEach(function (k) { try { st.graficos[k].dispose(); } catch (e) { /* já descartado */ } });
    st.graficos = {};
    if (st.dados) renderGraficos(st.dados);
  }
  document.addEventListener('pixc:tema', function (e) { trocarTemaGraficos(e.detail && e.detail.ativo === 'escuro' ? TEMA_ESCURO : null); });
  function direitos() { try { return JSON.parse(raiz.getAttribute('data-direitos') || 'null'); } catch (e) { return null; } }

  // ------------------------------------------------------------------ util
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined && txt !== null) e.textContent = String(txt); return e; }
  function diaISO(d) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function fmtDia(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
  function fmtDataHora(s) { var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s || ''); return m ? m[3] + '/' + m[2] + ' ' + m[4] + ':' + m[5] : ''; }
  function fmtNum(v, dec) { return v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }); }
  function fmtHoras(h) { if (h === null || h === undefined) return '—'; return h < 48 ? fmtNum(h, 1) + ' h' : fmtNum(h / 24, 1) + ' d'; }
  function selecionados(sel) { return Array.prototype.filter.call(sel.options, function (o) { return o.selected; }).map(function (o) { return o.value; }); }
  function corDe(d) { return getComputedStyle(document.documentElement).getPropertyValue('--tblr-body-color') || '#1d273b'; }

  // ------------------------------------------------------------------ filtros
  function filtrosAtuais() {
    return {
      modo: $('pixc-rf-modo').value, de: $('pixc-rf-de').value, ate: $('pixc-rf-ate').value,
      bases: selecionados($('pixc-rf-bases')), assunto: selecionados($('pixc-rf-assunto')), diagnostico: selecionados($('pixc-rf-diagnostico')),
      condominio: selecionados($('pixc-rf-condominio')), tecnico: selecionados($('pixc-rf-tecnico')),
      sem_diagnostico: $('pixc-rf-semdiag').checked ? 1 : 0
    };
  }
  function query(f) {
    var p = new URLSearchParams();
    Object.keys(f).forEach(function (k) { var v = f[k]; if (Array.isArray(v)) { v.forEach(function (x) { p.append(k + '[]', x); }); } else if (v !== '' && v !== null && v !== undefined) p.set(k, v); });
    return p.toString();
  }
  function guardar(f) { try { localStorage.setItem('pixc_rel_filtros', JSON.stringify(f)); } catch (e) { /* sem storage */ } }
  function restaurar() {
    try {
      var f = JSON.parse(localStorage.getItem('pixc_rel_filtros') || 'null'); if (!f) return;
      if (f.modo) $('pixc-rf-modo').value = f.modo;
      if (f.de) $('pixc-rf-de').value = f.de; if (f.ate) $('pixc-rf-ate').value = f.ate;
      $('pixc-rf-semdiag').checked = !!f.sem_diagnostico;
      var sel = {}; DIMS.forEach(function (k) { sel[k] = (f[k] || []).map(String); });
      return sel;
    } catch (e) { return null; }
  }
  var DIMS = ['bases', 'assunto', 'diagnostico', 'condominio', 'tecnico'];
  var temSelect2 = !!(window.jQuery && window.jQuery.fn && window.jQuery.fn.select2);

  function montarSelect2(sel) {
    if (!temSelect2 || !window.PixcSelect) return;
    window.PixcSelect.montar(sel, { width: '100%' });
  }
  function valoresDe(id) { return selecionados($(id)); }
  var silencio = 0;   // > 0 enquanto a página mexe nos selects (não dispara a cascata)
  function setValores(sel, vals) {
    Array.prototype.forEach.call(sel.options, function (o) { o.selected = vals.indexOf(o.value) >= 0; });
    silencio++;
    try { if (temSelect2) window.jQuery(sel).trigger('change.select2'); } finally { silencio--; }
  }
  /** Repõe as opções de uma dimensão mantendo o que ainda existe da seleção atual (ou a seleção pedida). */
  function preencher(dim, lista, manter) {
    var sel = $('pixc-rf-' + dim), atual = manter || selecionados(sel);
    sel.replaceChildren();
    (lista || []).forEach(function (o) { var opt = new Option(o.nome, String(o.valor)); if (o.n !== undefined) opt.setAttribute('data-n', o.n); sel.appendChild(opt); });
    var validos = atual.filter(function (v) { return !!sel.querySelector('option[value="' + CSS.escape(v) + '"]'); });
    setValores(sel, validos);
    montarSelect2(sel);
    return validos.length === atual.length;   // false = alguma seleção caiu
  }
  var reqOp = 0;
  /** Recarrega as opções a partir da dimensão `desde` (hierarquia da esquerda para a direita) e depois aplica. */
  function recarregarOpcoes(desde, manterPorDim) {
    var meu = ++reqOp, f = filtrosAtuais();
    if (manterPorDim) DIMS.forEach(function (d) { if (manterPorDim[d]) f[d] = manterPorDim[d]; });
    return fetch(URL_DADOS + '?acao=opcoes&' + query(f), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (op) {
        if (meu !== reqOp || !op.ok) return;
        var comeca = DIMS.indexOf(desde || 'bases');
        DIMS.forEach(function (d, i) { if (i >= comeca) preencher(d, op[d], manterPorDim ? manterPorDim[d] : null); });
      });
  }

  // ------------------------------------------------------------------ render
  function renderKpis(k, f) {
    var g = $('pixc-rel-kpis'), fr = document.createDocumentFragment();
    var tile = function (v, r) { var t = el('div', 'pixc-kpi-tile'); t.appendChild(el('div', 'v', v)); t.appendChild(el('div', 'r', r)); fr.appendChild(t); };
    tile(fmtNum(k.total), f.modo === 'abertas' ? 'O.S. abertas no período' : 'O.S. resolvidas no período');
    tile(fmtNum(k.por_dia, 1), 'média por dia');
    tile(fmtHoras(k.media_h), 'duração média (abertura → fechamento)');
    tile(fmtHoras(k.mediana_h), 'duração mediana');
    tile(fmtNum(k.com_diagnostico_pct, 1) + '%', 'com diagnóstico preenchido');
    tile(fmtNum(k.condominios), 'condomínios atendidos');
    tile(fmtNum(k.colaboradores), 'colaboradores envolvidos');
    g.replaceChildren(fr);
  }

  function grafico(chave) {
    var box = raiz.querySelector('.pixc-grafico[data-grafico="' + chave + '"]');
    if (!box) return null;
    if (!st.graficos[chave]) st.graficos[chave] = echarts.init(box, temaGraficos, { renderer: 'canvas' });
    return st.graficos[chave];
  }
  function vazio(ch, msg) {
    ch.clear();
    ch.setOption({ title: { text: msg || 'Sem dados no período', left: 'center', top: 'middle', textStyle: { color: '#94a3b8', fontSize: 13, fontWeight: 'normal' } } });
  }
  var BASE_OPT = { textStyle: { fontFamily: 'inherit' }, animationDuration: 300, color: PALETA };

  function pizza(chave, itens, donut, coresFixas) {
    var ch = grafico(chave); if (!ch) return;
    var top = itens.slice(0, 9); var resto = itens.slice(9).reduce(function (s, x) { return s + x.n; }, 0);
    var data = top.map(function (x) { return { name: x.nome, value: x.n }; });
    if (resto > 0) data.push({ name: 'Outros (' + (itens.length - 9) + ')', value: resto });
    if (!data.length) return vazio(ch);
    var cores = coresFixas ? top.map(function (x, i) { return coresFixas(x) || PALETA[i % PALETA.length]; }) : PALETA;
    ch.clear();
    ch.setOption(Object.assign({}, BASE_OPT, {
      color: cores,
      tooltip: { trigger: 'item', formatter: function (p) { return p.name + '<br><b>' + p.value + '</b> O.S. (' + p.percent + '%)'; } },
      legend: { type: 'scroll', orient: 'vertical', right: 0, top: 'middle', textStyle: { fontSize: 11 }, formatter: function (n) { return n.length > 26 ? n.slice(0, 25) + '…' : n; } },
      series: [{ type: 'pie', radius: donut ? ['42%', '70%'] : '70%', center: ['32%', '50%'], data: data, avoidLabelOverlap: true,
        label: { show: true, formatter: '{d}%', fontSize: 11 }, labelLine: { length: 8, length2: 6 },
        itemStyle: { borderColor: temaGraficos ? '#193840' : '#fff', borderWidth: 1 }, emphasis: { scale: true, scaleSize: 4 } }]
    }));
  }
  function barrasH(chave, itens, max, cor) {
    var ch = grafico(chave); if (!ch) return;
    var top = itens.slice(0, max || 12).reverse();
    if (!top.length) return vazio(ch);
    ch.clear();
    ch.setOption(Object.assign({}, BASE_OPT, {
      grid: { left: 8, right: 40, top: 6, bottom: 6, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: function (ps) { var p = ps[0], it = top[p.dataIndex]; return p.name + '<br><b>' + p.value + '</b> O.S. (' + it.pct + '%)' + (it.media_h !== null ? '<br>duração média ' + fmtHoras(it.media_h) : ''); } },
      xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: 'rgba(128,128,128,.15)' } } },
      yAxis: { type: 'category', data: top.map(function (x) { return x.nome; }), axisLabel: { fontSize: 11, width: 150, overflow: 'truncate' }, axisTick: { show: false } },
      series: [{ type: 'bar', data: top.map(function (x) { return x.n; }), barMaxWidth: 22, itemStyle: { color: cor || '#2563eb', borderRadius: [0, 3, 3, 0] },
        label: { show: true, position: 'right', fontSize: 11 } }]
    }));
  }
  function linhaDias(serie) {
    var ch = grafico('por_dia'); if (!ch) return;
    if (!serie.length) return vazio(ch);
    ch.clear();
    ch.setOption(Object.assign({}, BASE_OPT, {
      grid: { left: 8, right: 16, top: 12, bottom: 6, containLabel: true },
      tooltip: { trigger: 'axis', formatter: function (ps) { var p = ps[0]; return fmtDia(p.name) + '<br><b>' + p.value + '</b> O.S.'; } },
      xAxis: { type: 'category', data: serie.map(function (x) { return x.dia; }), axisLabel: { formatter: function (v) { return v.slice(8, 10) + '/' + v.slice(5, 7); }, fontSize: 11 }, axisTick: { alignWithLabel: true } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: 'rgba(128,128,128,.15)' } } },
      series: [{ type: 'bar', data: serie.map(function (x) { return x.n; }), itemStyle: { color: '#2563eb', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 26 }]
    }));
  }

  function renderGraficos(d) {
    var dims = d.dimensoes;
    linhaDias(d.por_dia);
    barrasH('assunto', dims.assunto.itens, 12, '#2563eb');
    pizza('diagnostico', dims.diagnostico.itens, true);
    barrasH('condominio', dims.condominio.itens, 12, '#059669');
    barrasH('tecnico', dims.tecnico.itens, 15, '#7c3aed');
    pizza('base', dims.base.itens, false, function (x) { return x.cor; });
    pizza('status', dims.status.itens, true, function (x) { return CORES_STATUS[x.nome]; });
  }

  function renderTabelas(d) {
    var wrap = $('pixc-rel-tabelas'), fr = document.createDocumentFragment();
    [['assunto', '#2563eb'], ['diagnostico', '#db2777'], ['condominio', '#059669'], ['tecnico', '#7c3aed']].forEach(function (par) {
      var dim = d.dimensoes[par[0]]; var card = el('div', 'pixc-rel-card');
      var tit = el('div', 'pixc-rel-card-titulo', dim.rotulo); tit.appendChild(el('span', 'pixc-sub', dim.itens.length + ' itens')); card.appendChild(tit);
      var t = el('table'), th = el('thead'), tr = el('tr');
      [['', dim.rotulo], ['num', 'O.S.'], ['num', '%'], ['num', 'Média']].forEach(function (c) { tr.appendChild(el('th', c[0], c[1])); }); th.appendChild(tr); t.appendChild(th);
      var tb = el('tbody'); var maxN = dim.itens.length ? dim.itens[0].n : 1;
      dim.itens.slice(0, 15).forEach(function (it) {
        var r = el('tr'); var td = el('td'); td.appendChild(document.createTextNode(it.nome));
        var b = el('div', 'barra'); var i = el('i'); i.style.width = Math.round(it.n * 100 / maxN) + '%'; i.style.setProperty('--c', par[1]); b.appendChild(i); td.appendChild(b); r.appendChild(td);
        r.appendChild(el('td', 'num', fmtNum(it.n))); r.appendChild(el('td', 'num', fmtNum(it.pct, 1) + '%')); r.appendChild(el('td', 'num', fmtHoras(it.media_h)));
        tb.appendChild(r);
      });
      if (!dim.itens.length) { var r0 = el('tr'); var td0 = el('td', null, 'Sem dados'); td0.colSpan = 4; r0.appendChild(td0); tb.appendChild(r0); }
      t.appendChild(tb); card.appendChild(t); fr.appendChild(card);
    });
    wrap.replaceChildren(fr);
  }

  function renderAmostra(d) {
    var tb = $('pixc-rel-amostra'), fr = document.createDocumentFragment();
    d.amostra.forEach(function (c) {
      var tr = el('tr');
      [c.base, c.ixc_id, c.status, c.assunto || '', c.diagnostico || '—', c.condominio || '—', c.tecnico || 'sem técnico', c.cliente || '', fmtDataHora(c.data_abertura), fmtDataHora(c.data_fechamento)].forEach(function (v) { tr.appendChild(el('td', null, v)); });
      tr.appendChild(el('td', 'num', fmtHoras(c.duracao_h)));
      fr.appendChild(tr);
    });
    if (!d.amostra.length) { var tr0 = el('tr'); var td0 = el('td', 'pixc-vazio', 'Nenhuma O.S. com esses filtros.'); td0.colSpan = 11; tr0.appendChild(td0); fr.appendChild(tr0); }
    tb.replaceChildren(fr);
    $('pixc-rel-amostra-info').textContent = d.kpis.total > d.amostra.length ? '(mostrando ' + d.amostra.length + ' de ' + d.kpis.total + ' — o CSV traz todas)' : '(' + d.kpis.total + ')';
  }

  // ------------------------------------------------------------------ carregar
  function carregar() {
    var f = filtrosAtuais();
    if (!f.de || !f.ate) return;
    if (f.de > f.ate) { var t = f.de; f.de = f.ate; f.ate = t; $('pixc-rf-de').value = f.de; $('pixc-rf-ate').value = f.ate; }
    guardar(f);
    $('pixc-rel-sub').textContent = 'carregando…';
    $('pixc-rel-csv').disabled = true; $('pixc-rel-pdf').disabled = true;
    fetch(URL_DADOS + '?acao=agregar&' + query(f), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { if (r.status === 401 || r.status === 403) { window.location.reload(); throw new Error('sessão'); } return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.erro || 'erro');
        st.dados = d;
        $('pixc-rel-sub').textContent = d.modo_rotulo + ' · ' + fmtDia(f.de) + ' a ' + fmtDia(f.ate) + ' · gerado ' + fmtDataHora(d.gerado_em);
        var av = $('pixc-rel-aviso'); av.hidden = !d.truncado; if (d.truncado) av.textContent = 'O período tem mais O.S. do que o limite do relatório. Reduza o período para números exatos.';
        renderKpis(d.kpis, f); renderGraficos(d); renderTabelas(d); renderAmostra(d);
        $('pixc-rel-csv').disabled = false; $('pixc-rel-pdf').disabled = false;
      })
      .catch(function (e) { $('pixc-rel-sub').textContent = 'Falha ao carregar: ' + e.message; if (window.console) console.warn('[painelixc]', e); });
  }

  function exportarPdf() {
    if (!st.dados) return;
    var imgs = {};
    // no tema escuro, redesenha no claro (sem animação) só para tirar as imagens do PDF, que tem fundo branco
    var voltar = temaGraficos;
    if (voltar) { BASE_OPT.animation = false; trocarTemaGraficos(null); }
    Object.keys(st.graficos).forEach(function (k) {
      var ch = st.graficos[k]; if (!ch) return;
      try { imgs[k] = ch.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' }); } catch (e) { /* gráfico vazio */ }
    });
    if (voltar) { trocarTemaGraficos(voltar); delete BASE_OPT.animation; }
    $('pixc-rel-pdf-filtros').value = JSON.stringify(st.dados.filtros);
    $('pixc-rel-pdf-imagens').value = JSON.stringify(imgs);
    $('pixc-rel-pdf-form').submit();
  }

  // ------------------------------------------------------------------ eventos
  function ligar() {
    $('pixc-rf-aplicar').addEventListener('click', function () { recarregarOpcoes('bases').then(carregar); });
    $('pixc-rel-form').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName !== 'SELECT') { e.preventDefault(); carregar(); } });
    Array.prototype.forEach.call(raiz.querySelectorAll('[data-dias]'), function (b) {
      b.addEventListener('click', function () { var ate = new Date(), de = new Date(); de.setDate(de.getDate() - (+b.getAttribute('data-dias') - 1)); $('pixc-rf-de').value = diaISO(de); $('pixc-rf-ate').value = diaISO(ate); recarregarOpcoes('bases').then(carregar); });
    });
    Array.prototype.forEach.call(raiz.querySelectorAll('[data-mes]'), function (b) {
      b.addEventListener('click', function () {
        var h = new Date(), de, ate;
        if (b.getAttribute('data-mes') === 'atual') { de = new Date(h.getFullYear(), h.getMonth(), 1); ate = h; }
        else { de = new Date(h.getFullYear(), h.getMonth() - 1, 1); ate = new Date(h.getFullYear(), h.getMonth(), 0); }
        $('pixc-rf-de').value = diaISO(de); $('pixc-rf-ate').value = diaISO(ate); recarregarOpcoes('bases').then(carregar);
      });
    });
    $('pixc-rf-limpar').addEventListener('click', function () {
      limparFiltros();
      if (window.PixcFiltros && window.PixcFiltros.nenhum) window.PixcFiltros.nenhum('relatorio');   // filtro salvo volta a "— nenhum —"
    });
    DIMS.forEach(function (d, i) {
      var sel = $('pixc-rf-' + d);
      var aoMudar = function () { if (silencio) return; var prox = DIMS[i + 1]; (prox ? recarregarOpcoes(prox) : Promise.resolve()).then(carregar); };
      if (temSelect2) window.jQuery(sel).on('change', aoMudar); else sel.addEventListener('change', aoMudar);
    });
    $('pixc-rf-semdiag').addEventListener('change', function () { recarregarOpcoes('condominio').then(carregar); });
    $('pixc-rf-modo').addEventListener('change', function () { recarregarOpcoes('bases').then(carregar); });
    $('pixc-rel-csv').addEventListener('click', function () { window.location.href = URL_CSV + '?' + query(filtrosAtuais()); });
    $('pixc-rel-pdf').addEventListener('click', exportarPdf);
    window.addEventListener('resize', function () { Object.keys(st.graficos).forEach(function (k) { st.graficos[k] && st.graficos[k].resize(); }); });
  }

  /** Mesma rotina do botão "Limpar" (também usada ao escolher "— nenhum —" nos filtros salvos). */
  function limparFiltros() {
    silencio++;
    try { DIMS.forEach(function (k) { setValores($('pixc-rf-' + k), []); }); } finally { silencio--; }
    $('pixc-rf-semdiag').checked = false;
    recarregarOpcoes('bases').then(carregar);
  }

  /** Filtros salvos: o que se guarda e como se aplica. */
  function aplicarFiltroSalvo(f) {
    if (!f || typeof f !== 'object') return;
    guardar(f);
    var sel = restaurar();
    silencio++;
    try { DIMS.forEach(function (k) { setValores($('pixc-rf-' + k), []); }); } finally { silencio--; }
    recarregarOpcoes('bases', sel).then(carregar);
  }
  var salvos = restaurar();
  var pFiltros = (window.PixcFiltros && raiz.getAttribute('data-filtros'))
    ? window.PixcFiltros.montar({ raiz: $('pixc-rel-salvos'), url: raiz.getAttribute('data-filtros'), tela: 'relatorio', direitos: direitos(), obter: filtrosAtuais, aplicar: aplicarFiltroSalvo, limpar: limparFiltros })
    : Promise.resolve(null);
  pFiltros
    .then(function (padrao) { if (padrao && typeof padrao === 'object') { guardar(padrao); salvos = restaurar(); } return recarregarOpcoes('bases', salvos); })
    .then(function () { ligar(); carregar(); })
    .catch(function (e) { $('pixc-rel-sub').textContent = 'Falha ao carregar as opções de filtro: ' + e.message; });

  window.PainelIxcRelatorio = { _st: st, _carregar: carregar, _filtros: filtrosAtuais };
})();
