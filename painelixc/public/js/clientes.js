/* Painel IXC 0.13.0 — Clientes: busca ao vivo no IXC (uma base por vez), 50 por página, com os contratos de cada cliente.
 * Todo texto vindo do IXC entra via textContent (nunca innerHTML).
 */
(function iniciar() {
  'use strict';

  if (document.readyState !== 'complete') { window.addEventListener('load', iniciar); return; }
  var raiz = document.getElementById('pixc-clientes');
  if (!raiz) return;

  var API = raiz.getAttribute('data-api');
  var CHAVE_LS = 'pixc_glpi_clientes';
  var ST_CONTRATO = { A: 'Ativo', I: 'Inativo', P: 'Pré-contrato', N: 'Negativado', D: 'Desistiu', C: 'Cancelado' };
  var ST_ACESSO = { A: 'Ativo', D: 'Desativado', CM: 'Bloqueio manual', CA: 'Bloqueio automático', FA: 'Financeiro em atraso', AA: 'Aguardando assinatura' };
  var COR_CONTRATO = { A: '#16a34a', I: '#64748b', P: '#0891b2', N: '#dc2626', D: '#9333ea', C: '#64748b' };
  var COR_ACESSO = { A: '#16a34a', D: '#64748b', CM: '#dc2626', CA: '#d97706', FA: '#d97706', AA: '#0891b2' };

  var RP_PADRAO = +raiz.getAttribute('data-por-pagina') || 50;
  var st = { f: vazio(), opcoes: {}, dados: null, carregando: false, req: 0, aberto: {}, kAberto: {}, ordl: null };   // kAberto: contratos abertos no detalhe (0.13.4)   // ordl = {campo, dir} ordenação local da página
  var $ = function (id) { return document.getElementById(id); };

  function vazio() { return { base: '', ativo: '', id: '', razao: '', fantasia: '', tipo: '', condominio: '', produto: '', ordem: 'razao', dir: 'asc', pagina: 1, rp: String(RP_PADRAO) }; }
  function direitos() { try { return JSON.parse(raiz.getAttribute('data-direitos') || 'null'); } catch (e) { return null; } }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined && txt !== null) e.textContent = String(txt); return e; }
  function fmtDia(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
  function pill(txt, cor) { var s = el('span', 'pixc-st', txt); s.style.setProperty('--c', cor || '#64748b'); return s; }
  function query(f, extra) {
    var p = new URLSearchParams();
    Object.keys(f).forEach(function (k) { if (f[k] !== '' && f[k] !== null && f[k] !== undefined) p.set(k, f[k]); });
    Object.keys(extra || {}).forEach(function (k) { p.set(k, extra[k]); });
    return p.toString();
  }
  function guardar() { try { localStorage.setItem(CHAVE_LS, JSON.stringify(st.f)); } catch (e) { /* sem storage */ } }
  function restaurar() {
    try { var v = JSON.parse(localStorage.getItem(CHAVE_LS) || 'null'); if (v && typeof v === 'object') lerFiltro(v); } catch (e) { /* sem storage */ }
  }
  function lerFiltro(v) {
    var f = vazio();
    Object.keys(f).forEach(function (k) { if (v[k] !== undefined && v[k] !== null) f[k] = k === 'pagina' ? (+v[k] || 1) : String(v[k]); });
    st.f = f;
  }
  function nomeBase(c) { var b = raiz.querySelector('.pixc-cli-base[data-base="' + c + '"]'); return b ? b.textContent.trim() : c; }

  // ------------------------------------------------------------------ formulário <-> estado
  function paraForm() {
    $('pixc-cf-ativo').value = st.f.ativo; $('pixc-cf-id').value = st.f.id;
    $('pixc-cf-razao').value = st.f.razao; $('pixc-cf-fantasia').value = st.f.fantasia;
    $('pixc-cf-tipo').value = st.f.tipo; $('pixc-cf-condominio').value = st.f.condominio; $('pixc-cf-produto').value = st.f.produto;
    var rp = $('pixc-cf-rp'); if (rp) { rp.value = st.f.rp; if (rp.value !== String(st.f.rp)) { st.f.rp = String(RP_PADRAO); rp.value = st.f.rp; } }
    if (window.jQuery && window.jQuery.fn && window.jQuery.fn.select2) {
      ['pixc-cf-tipo', 'pixc-cf-condominio', 'pixc-cf-produto'].forEach(function (id) { var s = window.jQuery($(id)); if (s.hasClass('select2-hidden-accessible')) s.trigger('change.select2'); });
    }
    Array.prototype.forEach.call(raiz.querySelectorAll('.pixc-cli-base'), function (b) {
      var on = b.getAttribute('data-base') === st.f.base; b.classList.toggle('sel', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }
  function doForm() {
    st.f.ativo = $('pixc-cf-ativo').value; st.f.id = $('pixc-cf-id').value.trim().replace(/\D/g, '');
    st.f.razao = $('pixc-cf-razao').value.trim(); st.f.fantasia = $('pixc-cf-fantasia').value.trim();
    st.f.tipo = $('pixc-cf-tipo').value; st.f.condominio = $('pixc-cf-condominio').value; st.f.produto = $('pixc-cf-produto').value;
  }

  // ------------------------------------------------------------------ listas (condomínio e tipo) da base
  function preencher(sel, lista, valor) {
    var frag = document.createDocumentFragment();
    frag.appendChild(new Option('Todos', ''));
    (lista || []).forEach(function (o) { frag.appendChild(new Option(o.nome, String(o.id))); });
    sel.replaceChildren(frag);
    sel.value = valor && sel.querySelector('option[value="' + CSS.escape(String(valor)) + '"]') ? String(valor) : '';
  }
  function montarSelect2(sel) {
    if (!(window.jQuery && window.jQuery.fn && window.jQuery.fn.select2) || sel.classList.contains('select2-hidden-accessible')) return;
    try { window.jQuery(sel).select2({ width: '100%', dropdownCssClass: 'pixc-lista' }); } catch (e) { /* segue com o select comum */ }
  }
  function carregarOpcoes() {
    var base = st.f.base;
    if (!base) return Promise.resolve();
    if (st.opcoes[base]) { aplicarOpcoes(st.opcoes[base]); return Promise.resolve(); }
    $('pixc-cli-status').textContent = 'carregando condomínios, tipos e produtos de ' + nomeBase(base) + '…';
    return fetch(API + '?' + query({ acao: 'opcoes', base: base }), { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.erro || 'falha');
        st.opcoes[base] = j; if (base === st.f.base) aplicarOpcoes(j);
      })
      .catch(function (e) { avisar('Não consegui carregar as listas de ' + nomeBase(base) + ': ' + e.message); });
  }
  function aplicarOpcoes(j) {
    preencher($('pixc-cf-tipo'), j.tipos, st.f.tipo);
    preencher($('pixc-cf-condominio'), j.condominios, st.f.condominio);
    preencher($('pixc-cf-produto'), j.produtos, st.f.produto);
    montarSelect2($('pixc-cf-condominio')); montarSelect2($('pixc-cf-tipo')); montarSelect2($('pixc-cf-produto'));
    paraForm();
    avisar((j.avisos || []).join(' · '));
  }
  function nomeDe(lista, id) {
    if (!id) return '';
    for (var i = 0; i < (lista || []).length; i++) if (String(lista[i].id) === String(id)) return lista[i].nome;
    return '#' + id;
  }
  function avisar(msg) { var a = $('pixc-cli-aviso'); a.hidden = !msg; a.textContent = msg || ''; }

  // ------------------------------------------------------------------ busca
  function buscar(pagina) {
    if (!st.f.base) { $('pixc-cli-status').textContent = 'escolha a base'; return; }
    doForm();
    st.f.pagina = pagina || 1;
    if (st.f.pagina === 1) st.aberto = {};
    guardar();
    var meu = ++st.req;
    st.carregando = true; raiz.classList.add('carregando');
    $('pixc-cli-status').textContent = 'buscando no IXC de ' + nomeBase(st.f.base) + '…';
    $('pixc-cli-buscar').disabled = true;
    fetch(API + '?' + query(st.f, { acao: 'buscar' }), { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) { window.location.reload(); throw new Error('sessão expirada'); }
        return r.json().then(function (j) { if (!j.ok) throw new Error(j.erro || ('HTTP ' + r.status)); return j; });
      })
      .then(function (j) {
        if (meu !== st.req) return;
        st.dados = j; render();
        $('pixc-cli-status').textContent = nomeBase(st.f.base) + ' · consultado agora';
        if (j.avisos && j.avisos.length) avisar(j.avisos.slice(0, 3).join(' · ') + (j.avisos.length > 3 ? ' (+' + (j.avisos.length - 3) + ')' : ''));
      })
      .catch(function (e) {
        if (meu !== st.req) return;
        st.dados = null; renderVazio('Falha na busca: ' + e.message);
        $('pixc-cli-status').textContent = 'falhou';
      })
      .then(function () { if (meu === st.req) { st.carregando = false; raiz.classList.remove('carregando'); $('pixc-cli-buscar').disabled = false; } });
  }

  function renderVazio(msg) {
    var tr = el('tr'), td = el('td', 'pixc-vazio', msg); td.colSpan = 8; tr.appendChild(td);
    $('pixc-linhas').replaceChildren(tr); $('pixc-paginacao').replaceChildren(); $('pixc-resumo').textContent = ''; $('pixc-cli-exibindo').textContent = '';
  }

  function linhaContrato(k) {
    var l = el('div', 'pixc-cli-contrato');
    l.appendChild(el('span', 'pixc-cli-cnum', '#' + k.id));
    l.appendChild(pill(ST_CONTRATO[k.status] || k.status || '?', COR_CONTRATO[k.status]));
    var ac = pill('Acesso: ' + (ST_ACESSO[k.status_acesso] || k.status_acesso || '—'), COR_ACESSO[k.status_acesso]);
    ac.classList.add('pixc-cli-acesso'); l.appendChild(ac);
    l.appendChild(el('span', 'pixc-cli-data', k.data_ativacao ? 'ativado em ' + fmtDia(k.data_ativacao) : 'sem ativação'));
    if (k.plano) l.title = 'Plano de venda: ' + k.plano;
    return l;
  }
  function produtosDe(k) { return Array.isArray(k.produtos) ? k.produtos : []; }
  /** Produtos do cliente (descrição), contratos ativos primeiro, sem repetir. */
  function listaProdutos(c) {
    var out = [], visto = {};
    c.contratos.slice().sort(function (a, b) { return (a.status === 'A' ? 0 : 1) - (b.status === 'A' ? 0 : 1); }).forEach(function (k) {
      produtosDe(k).forEach(function (p) {
        var d = p.descricao || p.servico; if (!d || visto[d]) return;
        visto[d] = true; out.push(p);
      });
    });
    return out;
  }
  /** 0.13.4: a linha toda abre o detalhe; a célula mostra só o resumo (1 contrato = a linha dele; vários = contagem por status). */
  function celContratos(c, aberto) {
    var box = el('div', 'pixc-cli-contratos');
    if (!c.contratos.length) { box.appendChild(el('span', 'pixc-cli-sem', 'sem contrato')); return box; }
    var res = el('div', 'pixc-cli-toggle'); res.setAttribute('aria-expanded', aberto ? 'true' : 'false');
    if (c.contratos.length === 1) res.appendChild(linhaContrato(c.contratos[0]));
    else {
      res.appendChild(el('b', null, c.contratos.length + ' contratos'));
      var porStatus = {}; c.contratos.forEach(function (k) { porStatus[k.status] = (porStatus[k.status] || 0) + 1; });
      Object.keys(porStatus).sort(function (a, b) { return (a === 'A' ? -1 : 0) - (b === 'A' ? -1 : 0); }).forEach(function (s) {
        res.appendChild(pill(porStatus[s] + ' ' + (ST_CONTRATO[s] || s || '?'), COR_CONTRATO[s]));
      });
    }
    res.appendChild(el('i', 'ti ti-chevron-down pixc-cli-seta'));
    box.appendChild(res);
    return box;
  }
  /** 0.13.4: coluna Produto = descrição do produto do contrato (aba "Produtos" do contrato no IXC). */
  function celProdutos(c) {
    var td = el('td', 'pixc-cli-planos'), l = listaProdutos(c);
    if (!l.length) { td.textContent = '—'; return td; }
    var nome = l[0].descricao || l[0].servico;
    var d = el('div', null, nome.length > 24 ? nome.slice(0, 24).replace(/\s+$/, '') + '…' : nome);   // 0.13.4.2: 24 caracteres + reticências
    d.title = nome + (l[0].servico ? ' · Serviço/Produto: ' + l[0].servico : '');
    td.appendChild(d);
    if (l.length > 1) td.appendChild(el('small', 'pixc-cli-mais', '+' + (l.length - 1) + (l.length === 2 ? ' outro produto' : ' outros produtos')));
    return td;
  }
  function fmtQtde(q) { return q === null || q === undefined || q === '' ? '' : Number(q).toLocaleString('pt-BR', { maximumFractionDigits: 3 }); }
  /** Detalhe do cliente: cada contrato num bloco recolhível com os produtos dele. */
  function linhaDetalhe(c) {
    var tr = el('tr', 'pixc-cli-det'), td = el('td'); td.colSpan = 8;
    var box = el('div', 'pixc-cli-kdets');
    c.contratos.forEach(function (k) {
      var chave = c.id + ':' + k.id, prods = produtosDe(k);
      var d = el('details', 'pixc-cli-kdet'); d.setAttribute('data-k', chave);
      d.open = st.kAberto[chave] !== undefined ? st.kAberto[chave] : c.contratos.length === 1;
      var sm = el('summary');
      sm.appendChild(el('i', 'ti ti-chevron-right pixc-cli-kseta'));
      sm.appendChild(linhaContrato(k));
      if (k.plano) sm.appendChild(el('span', 'pixc-cli-kplano', 'Plano de venda: ' + k.plano));
      sm.appendChild(el('span', 'pixc-cli-kqtd', prods.length + (prods.length === 1 ? ' produto' : ' produtos')));
      d.appendChild(sm);
      if (!prods.length) d.appendChild(el('div', 'pixc-cli-ksem', 'Nenhum produto neste contrato.'));
      else {
        var t = el('table', 'pixc-cli-prods'), h = el('tr');
        ['Descrição produto', 'Serviço/Produto', 'Qtde.', 'Vínculo'].forEach(function (x, i) { h.appendChild(el('th', i === 2 ? 'num' : null, x)); });
        var th = el('thead'); th.appendChild(h); t.appendChild(th);
        var tb = el('tbody');
        prods.forEach(function (p) {
          var l = el('tr');
          l.appendChild(el('td', null, p.descricao || '—'));
          l.appendChild(el('td', null, p.servico || '—'));
          l.appendChild(el('td', 'num', fmtQtde(p.qtde)));
          l.appendChild(el('td', null, p.vinculo || ''));
          tb.appendChild(l);
        });
        t.appendChild(tb); d.appendChild(t);
      }
      box.appendChild(d);
    });
    td.appendChild(box); tr.appendChild(td);
    return tr;
  }
  /** Páginas no estilo do GLPI: « ‹ 1 … 4 5 [6] 7 8 … 40 › » */
  function paginas(atual, total) {
    var out = [1], ini = Math.max(2, atual - 2), fim = Math.min(total - 1, atual + 2);
    if (ini > 2) out.push('…');
    for (var i = ini; i <= fim; i++) out.push(i);
    if (fim < total - 1) out.push('…');
    if (total > 1) out.push(total);
    return out;
  }

  /** 0.13.2.5: ordenação local (Tipo, Condomínio, Produto, Contratos) da página que está na tela. */
  function listaOrdenada(lista, op) {
    if (!st.ordl) return lista;
    var k = st.ordl.campo, m = st.ordl.dir === 'desc' ? -1 : 1;
    var val = function (c) {
      if (k === 'tipo') return nomeDe(op.tipos, c.id_tipo) || '';
      if (k === 'condominio') return nomeDe(op.condominios, c.id_condominio) || '';
      if (k === 'produto') { var l = listaProdutos(c); return l.length ? (l[0].descricao || l[0].servico) : ''; }
      if (k === 'contratos') return c.contratos.length;
      return '';
    };
    return lista.slice().sort(function (a, b) {
      var x = val(a), y = val(b);
      if (x === '' && y !== '') return 1; if (y === '' && x !== '') return -1;   // vazios sempre no fim
      var r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR', { numeric: true });
      return (r || (a.id - b.id)) * m;
    });
  }
  function render() {
    var d = st.dados, op = st.opcoes[st.f.base] || {};
    if (!d) return;
    if (!d.clientes.length) { renderVazio('Nenhum cliente com esses filtros nesta base.'); return; }
    var frag = document.createDocumentFragment();
    listaOrdenada(d.clientes, op).forEach(function (c) {
      var tr = el('tr');
      tr.appendChild(el('td', 'num os', c.id));
      tr.appendChild(el('td', null, c.fantasia || '—'));
      tr.appendChild(el('td', null, c.razao || '—'));
      var tp = el('td', null, nomeDe(op.tipos, c.id_tipo) || '—');
      if (c.tipo_pessoa) tp.appendChild(el('small', 'pixc-cli-pessoa', c.tipo_pessoa === 'J' ? 'Jurídica' : (c.tipo_pessoa === 'F' ? 'Física' : c.tipo_pessoa)));
      tr.appendChild(tp);
      tr.appendChild(el('td', null, nomeDe(op.condominios, c.id_condominio) || '—'));
      var tdA = el('td'); tdA.appendChild(pill(c.ativo === 'S' ? 'Sim' : (c.ativo === 'N' ? 'Não' : (c.ativo || '?')), c.ativo === 'S' ? '#16a34a' : '#64748b')); tr.appendChild(tdA);
      var aberto = !!st.aberto[c.id] && c.contratos.length > 0;
      if (c.contratos.length) {   // 0.13.4: a linha inteira abre/recolhe o detalhe (contratos e produtos)
        tr.classList.add('pixc-cli-varios'); if (aberto) tr.classList.add('aberta');
        tr.setAttribute('data-abrir', c.id); tr.tabIndex = 0; tr.setAttribute('aria-expanded', aberto ? 'true' : 'false');
        tr.title = aberto ? 'Recolher contratos e produtos' : 'Ver contratos e produtos';
      }
      tr.appendChild(celProdutos(c));
      var tdC = el('td'); tdC.appendChild(celContratos(c, aberto)); tr.appendChild(tdC);
      frag.appendChild(tr);
      if (aberto) frag.appendChild(linhaDetalhe(c));
    });
    $('pixc-linhas').replaceChildren(frag);

    var pags = Math.max(1, Math.ceil(d.total / d.por_pagina)), ini = (d.pagina - 1) * d.por_pagina;
    var r = $('pixc-resumo'), rf = document.createDocumentFragment(), b = el('b', null, d.total.toLocaleString('pt-BR'));
    rf.appendChild(b); rf.appendChild(document.createTextNode((d.total === 1 ? ' cliente' : ' clientes') + ' em ' + nomeBase(st.f.base)));
    var varios = d.clientes.filter(function (c) { return c.contratos.length > 1; }).length;
    var comContrato = d.clientes.filter(function (c) { return c.contratos.length > 0; }).length;
    if (varios) {
      var todos = d.clientes.every(function (c) { return !c.contratos.length || st.aberto[c.id]; });
      rf.appendChild(document.createTextNode(' · ' + varios + (varios === 1 ? ' cliente' : ' clientes') + ' com vários contratos nesta página · '));
      var bx = el('button', 'pixc-resumo-btn', todos ? 'recolher todos' : 'abrir todos'); bx.type = 'button'; bx.setAttribute('data-todos', todos ? '0' : '1');
      rf.appendChild(bx);
    }
    r.replaceChildren(rf);
    $('pixc-cli-exibindo').textContent = 'Exibindo ' + (ini + 1).toLocaleString('pt-BR') + ' a ' + (ini + d.clientes.length).toLocaleString('pt-BR') +
      ' de ' + d.total.toLocaleString('pt-BR') + ' linhas';

    var nav = $('pixc-paginacao'), nf = document.createDocumentFragment();
    if (pags > 1) {
      var bt = function (txt, pag, off, atual, titulo) {
        var x = el('button', 'btn btn-sm ' + (atual ? 'btn-primary' : 'btn-outline-secondary'), txt); x.type = 'button';
        x.setAttribute('data-pag', pag); x.disabled = !!off; if (atual) x.setAttribute('aria-current', 'page'); if (titulo) x.title = titulo; return x;
      };
      nf.appendChild(bt('«', 1, d.pagina <= 1, false, 'Primeira página'));
      nf.appendChild(bt('‹', d.pagina - 1, d.pagina <= 1, false, 'Página anterior'));
      paginas(d.pagina, pags).forEach(function (p) { nf.appendChild(p === '…' ? el('span', 'pixc-cli-reticencias', '…') : bt(p.toLocaleString('pt-BR'), p, false, p === d.pagina)); });
      nf.appendChild(bt('›', d.pagina + 1, d.pagina >= pags, false, 'Próxima página'));
      nf.appendChild(bt('»', pags, d.pagina >= pags, false, 'Última página'));
    }
    nav.replaceChildren(nf);
    Array.prototype.forEach.call(raiz.querySelectorAll('#pixc-tabela th[data-ord], #pixc-tabela th[data-ordl]'), function (th) {
      var ativa = st.ordl ? th.getAttribute('data-ordl') === st.ordl.campo : th.getAttribute('data-ord') === st.f.ordem;
      var dir = st.ordl ? st.ordl.dir : st.f.dir;
      th.classList.toggle('asc', ativa && dir === 'asc'); th.classList.toggle('desc', ativa && dir === 'desc');
      th.setAttribute('aria-sort', ativa ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
  }

  // ------------------------------------------------------------------ filtros salvos (tela "clientes")
  function obterFiltroSalvo() { doForm(); var f = Object.assign({}, st.f); delete f.pagina; return f; }
  function limparFiltros() {
    var base = st.f.base, rp = st.f.rp; st.f = vazio(); st.f.base = base; st.f.rp = rp; paraForm(); st.dados = null; renderVazio('Clique em Buscar.'); guardar();
  }
  function aplicarFiltroSalvo(v) {
    if (!v || typeof v !== 'object') return;
    lerFiltro(v); paraForm();
    carregarOpcoes().then(function () { paraForm(); buscar(1); });
  }

  // ------------------------------------------------------------------ eventos
  raiz.querySelector('#pixc-cli-bases').addEventListener('click', function (e) {
    var b = e.target.closest('.pixc-cli-base'); if (!b || b.disabled) return;
    var base = b.getAttribute('data-base'); if (base === st.f.base) return;
    doForm();
    st.f.base = base; st.f.tipo = ''; st.f.condominio = ''; st.f.produto = ''; st.dados = null;   // condomínio, tipo e produto são ids da base anterior
    paraForm(); renderVazio('Clique em Buscar.'); guardar();
    carregarOpcoes().then(function () { buscar(1); });
  });
  $('pixc-cli-form').addEventListener('submit', function (e) { e.preventDefault(); buscar(1); });
  $('pixc-limpar').addEventListener('click', function () {
    limparFiltros();
    if (window.PixcFiltros && window.PixcFiltros.nenhum) window.PixcFiltros.nenhum('clientes');
  });
  function alternar(t, teclado) {
    var id = t.getAttribute('data-abrir');
    if (st.aberto[id]) delete st.aberto[id]; else st.aberto[id] = true;
    render();
    if (teclado) { var n = $('pixc-linhas').querySelector('tr[data-abrir="' + id + '"]'); if (n) n.focus(); }   // o render troca a linha: devolve o foco
  }
  $('pixc-linhas').addEventListener('click', function (e) {
    var t = e.target.closest('tr[data-abrir]'); if (!t || window.getSelection().toString()) return;
    alternar(t);
  });
  $('pixc-linhas').addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr[data-abrir]')) { e.preventDefault(); alternar(e.target, true); }
  });
  // 0.13.4: lembra quais contratos foram abertos/fechados no detalhe (o render redesenha a tabela)
  $('pixc-linhas').addEventListener('toggle', function (e) {
    var d = e.target; if (d && d.getAttribute && d.getAttribute('data-k')) st.kAberto[d.getAttribute('data-k')] = d.open;
  }, true);
  $('pixc-resumo').addEventListener('click', function (e) {
    var b = e.target.closest('[data-todos]'); if (!b || !st.dados) return;
    var abrir = b.getAttribute('data-todos') === '1';
    st.dados.clientes.forEach(function (c) { if (c.contratos.length) { if (abrir) st.aberto[c.id] = true; else delete st.aberto[c.id]; } });
    render();
  });
  $('pixc-cf-rp').addEventListener('change', function () { st.f.rp = this.value; guardar(); if (st.f.base) buscar(1); });
  $('pixc-paginacao').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-pag]'); if (!b || b.disabled) return;
    buscar(+b.getAttribute('data-pag')); window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  raiz.querySelector('#pixc-tabela thead').addEventListener('click', function (e) {
    var th = e.target.closest('th[data-ord], th[data-ordl]'); if (!th) return;
    var local = th.getAttribute('data-ordl');
    if (local) {   // ordena só a página da tela (o IXC não ordena por nome do tipo/condomínio/plano)
      st.ordl = st.ordl && st.ordl.campo === local ? { campo: local, dir: st.ordl.dir === 'asc' ? 'desc' : 'asc' } : { campo: local, dir: local === 'contratos' ? 'desc' : 'asc' };
      if (st.dados) render();
      return;
    }
    var campo = th.getAttribute('data-ord');
    st.f.dir = !st.ordl && st.f.ordem === campo ? (st.f.dir === 'asc' ? 'desc' : 'asc') : 'asc';   // clicar de novo inverte
    st.f.ordem = campo; st.ordl = null;
    if (st.dados) buscar(1); else guardar();
  });
  $('pixc-csv').addEventListener('click', function () {
    if (!st.f.base) { $('pixc-cli-status').textContent = 'escolha a base'; return; }
    doForm(); guardar();
    // 0.13.2: baixa por fetch para mostrar o erro do IXC na própria tela (antes abria uma página só com o texto do erro)
    var b = this, base = nomeBase(st.f.base);
    b.disabled = true; avisar('');
    $('pixc-cli-status').textContent = 'gerando o CSV no IXC de ' + base + ' (pode levar alguns minutos em bases grandes)…';
    fetch(API + '?' + query(st.f, { acao: 'csv' }), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) { window.location.reload(); throw new Error('sessão expirada'); }
        if (!r.ok) return r.text().then(function (t) { throw new Error(t || ('HTTP ' + r.status)); });
        var m = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '');
        var av = r.headers.get('X-Pixc-Aviso');
        return r.blob().then(function (blob) { return { blob: blob, nome: m ? m[1] : 'clientes.csv', aviso: av ? decodeURIComponent(av) : '' }; });
      })
      .then(function (x) {
        var url = URL.createObjectURL(x.blob), a = document.createElement('a');
        a.href = url; a.download = x.nome; a.style.display = 'none'; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
        $('pixc-cli-status').textContent = 'CSV de ' + base + ' baixado';
        if (x.aviso) avisar(x.aviso);
      })
      .catch(function (e) { avisar('Não consegui gerar o CSV: ' + String(e.message).slice(0, 300)); $('pixc-cli-status').textContent = 'falhou'; })
      .then(function () { b.disabled = false; });
  });

  // ------------------------------------------------------------------ início
  restaurar();
  paraForm();
  var pFiltros = (window.PixcFiltros && raiz.getAttribute('data-filtros'))
    ? window.PixcFiltros.montar({ raiz: $('pixc-salvos'), url: raiz.getAttribute('data-filtros'), tela: 'clientes', direitos: direitos(), obter: obterFiltroSalvo, aplicar: aplicarFiltroSalvo, limpar: limparFiltros })
    : Promise.resolve(null);
  pFiltros.then(function (padrao) {
    if (padrao && typeof padrao === 'object') { lerFiltro(padrao); paraForm(); }
    var b = st.f.base && raiz.querySelector('.pixc-cli-base[data-base="' + st.f.base + '"]:not([disabled])');
    if (!b) { st.f.base = ''; paraForm(); return; }
    carregarOpcoes().then(function () { paraForm(); buscar(st.f.pagina || 1); });
  });

  window.PainelIxcClientes = { _st: st, _buscar: buscar, _render: render };   // exposto só para testes
})();
