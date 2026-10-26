/* Painel de Chamados IXC — bloco 1
 * Busca api/dados.php, filtra/ordena no navegador, atualiza sozinho.
 * Todo texto vindo do IXC entra via textContent (nunca innerHTML).
 */
(function iniciar() {
  'use strict';

  if (document.readyState !== 'complete') { window.addEventListener('load', iniciar); return; }
  var raiz = document.getElementById('pixc-painel');
  if (!raiz) return;

  var API = raiz.getAttribute('data-api');
  var HISTORICO = parseInt(raiz.getAttribute('data-historico'), 10) || 90;
  var INTERVALO_MS = 60000;
  var POR_PAGINA = 100;
  var SEM_TEC = '__sem__';

  var CORES_STATUS = {
    A: '#dc2626', AN: '#9333ea', EN: '#2563eb', AS: '#0891b2', AG: '#059669',
    RAG: '#d97706', DS: '#0d9488', EX: '#16a34a', F: '#64748b', C: '#64748b'
  };

  var st = {
    dados: null,
    agora: null,          // Date do servidor na última carga
    carregadoEm: 0,       // Date.now() da última carga
    bases: {},            // codigo -> base
    aba: 'abertas',
    periodo: { de: '', ate: '' },
    filtro: { bases: [], busca: '', status: [], assunto: [], tecnico: [], condominio: [], setor: [], atrasadas: false },
    ord: { campo: 'idade', dir: 'desc' },
    pagina: 1,
    aberto: {},           // id -> detalhe aberto
    falhas: 0
  };

  var $ = function (id) { return document.getElementById(id); };
  /** 0.12.0: direitos da categoria (Ler/Atualizar/Criar/Deletar) desenhados pelo servidor. */
  function direitos() { try { return JSON.parse(raiz.getAttribute('data-direitos') || 'null'); } catch (e) { return null; } }

  // ------------------------------------------------------------------ utilidades
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined && txt !== null) e.textContent = String(txt);
    return e;
  }
  function data(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/.exec(s);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  }
  function fmtData(s) {
    var d = data(s);
    if (!d) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fmtDia(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }
  function diaISO(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function periodoPadrao(dias) {
    var ate = new Date(); var de = new Date(); de.setDate(de.getDate() - (dias || 30));
    return { de: diaISO(de), ate: diaISO(ate) };
  }
  function aplicarAba() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-aba]'), function (b) {
      var on = b.getAttribute('data-aba') === st.aba;
      b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('pixc-periodo').hidden = st.aba !== 'resolvidas';
    if (st.aba === 'resolvidas') st.filtro.atrasadas = false;   // não se aplica a resolvidas
    Array.prototype.forEach.call(document.querySelectorAll('#pixc-tabela th[data-rot-abertas]'), function (th) {
      th.textContent = th.getAttribute(st.aba === 'resolvidas' ? 'data-rot-resolvidas' : 'data-rot-abertas');
    });
    if (st.aba === 'resolvidas') {
      if (!st.periodo.de || !st.periodo.ate) st.periodo = periodoPadrao(30);
      $('pixc-de').value = st.periodo.de; $('pixc-ate').value = st.periodo.ate;
    }
  }
  function fmtDuracao(ms) {
    if (ms === null || isNaN(ms)) return '';
    if (ms < 0) ms = 0;
    var min = Math.floor(ms / 60000);
    if (min < 60) return min + 'min';
    var h = Math.floor(min / 60);
    if (h < 24) return h + 'h' + (min % 60 ? ' ' + (min % 60) + 'min' : '');
    var d = Math.floor(h / 24);
    return d + 'd' + (h % 24 ? ' ' + (h % 24) + 'h' : '');
  }
  function agoraServidor() {
    // relógio do servidor avançando junto com o do navegador
    if (!st.agora) return new Date();
    return new Date(st.agora.getTime() + (Date.now() - st.carregadoEm));
  }
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function guardar() {
    try { localStorage.setItem('pixc_glpi_filtro', JSON.stringify({ f: st.filtro, o: st.ord, aba: st.aba, p: st.periodo })); } catch (e) { /* sem storage */ }
  }
  function restaurar() {
    try { lerEstado(JSON.parse(localStorage.getItem('pixc_glpi_filtro') || 'null')); } catch (e) { /* sem storage */ }
  }
  /** Carrega {f, o, aba, p} para o estado (localStorage ou filtro salvo). */
  function lerEstado(v) {
    {
      if (v && v.f) {
        for (var k in st.filtro) if (k in v.f) st.filtro[k] = v.f[k];
        ['bases', 'status', 'assunto', 'tecnico', 'condominio', 'setor'].forEach(function (k) {
          var x = st.filtro[k]; st.filtro[k] = Array.isArray(x) ? x.map(String) : (x ? [String(x)] : []);
        });
      }
      if (v && v.o && v.o.campo) st.ord = v.o;
      if (v && (v.aba === 'resolvidas' || v.aba === 'abertas')) st.aba = v.aba;
      if (v && v.p && v.p.de && v.p.ate) st.periodo = v.p;
    }
  }
  /** Filtros salvos: o que se guarda e como se aplica. A ABA NÃO faz parte do filtro: ele vale na aba em que você está
   *  (o período guardado só é usado quando se está em Resolvidas). */
  function obterFiltroSalvo() {
    return { f: st.filtro, o: st.ord, p: st.periodo };
  }
  /** Mesma rotina do botão "Limpar" (também usada ao escolher "— nenhum —" nos filtros salvos). */
  function limparFiltros() {
    st.filtro = { bases: [], busca: '', status: [], assunto: [], tecnico: [], condominio: [], setor: [], atrasadas: false };
    $('pixc-busca').value = ''; st.pagina = 1; render();
  }
  function aplicarFiltroSalvo(v) {
    var abaAntes = st.aba, pAntes = JSON.stringify(st.periodo);
    st.filtro = { bases: [], busca: '', status: [], assunto: [], tecnico: [], condominio: [], setor: [], atrasadas: false };
    if (v && typeof v === 'object') { v = Object.assign({}, v); delete v.aba; if (st.aba !== 'resolvidas') delete v.p; }
    lerEstado(v);
    st.pagina = 1; st.aberto = {};
    $('pixc-busca').value = st.filtro.busca || '';
    aplicarAba(); guardar();
    if (st.aba !== abaAntes || JSON.stringify(st.periodo) !== pAntes || !st.dados) { st.dados = null; $('pixc-linhas').replaceChildren(); carregar(); }
    else render();
  }

  // ------------------------------------------------------------------ regras
  function enriquecer(c, agora, atrasoMs) {
    var ab = data(c.data_abertura) || data(c.primeiro_visto);
    var ag = data(c.data_agenda);
    var fim = st.aba === 'resolvidas' ? (data(c.data_fechamento) || data(c.data_final) || agora) : agora;
    c._idade = ab ? fim - ab : null;
    c._agendaVencida = !!(ag && ag < agora);
    c._parada = !ag && c._idade !== null && c._idade > atrasoMs;
    c._atrasada = c._agendaVencida || c._parada;
    // 0.13.5: SLA como o IXC (cadastro do assunto da base); nas resolvidas fica congelado na data de fechamento
    var cfgSla = ((st.dados.sla || {}).bases || {})[c.base];
    c._sla = (window.PixcSla && cfgSla) ? window.PixcSla.deOs(c, cfgSla[c.id_assunto], agora, st.aba === 'resolvidas' ? (c.data_fechamento || c.data_final) : null) : null;
    c._busca = norm([c.ixc_id, c.protocolo, c.cliente, c.condominio, c.assunto, c.diagnostico, c.tecnico, c.setor, c.mensagem, c.mensagem_resposta, c.id_ticket].join(' '));
    if (st.aba === 'resolvidas') { c._agendaVencida = false; c._parada = false; c._atrasada = false; }
  }

  /** chave de uma opção: o NOME (mescla bases); sem nome usa id:N; sem valor = SEM_TEC */
  function normalizar(nome) {
    return String(nome).toLowerCase().trim().replace(/\s*\(\d+\)\s*$/, '').replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }
  function chave(id, nome) { if (!id) return SEM_TEC; return nome ? normalizar(nome) : 'id:' + id; }
  /** lista vazia = todos */
  function dentro(lista, id, nome) {
    if (!lista.length) return true;
    return lista.indexOf(chave(id, nome)) >= 0;
  }
  /** cópia do filtro só com as dimensões anteriores a `ate` (funil na ordem dos campos) */
  var ORDEM_SEL = ['status', 'assunto', 'tecnico', 'condominio', 'setor'];
  function filtroAte(f, ate) {
    var g = { bases: f.bases, busca: '', status: [], assunto: [], tecnico: [], condominio: [], setor: [], atrasadas: false };
    for (var i = 0; i < ORDEM_SEL.length && ORDEM_SEL[i] !== ate; i++) g[ORDEM_SEL[i]] = f[ORDEM_SEL[i]];
    return g;
  }
  function passa(c, f, ignorarBase) {
    if (!ignorarBase && f.bases.length && f.bases.indexOf(c.base) < 0) return false;
    if (f.status.length && f.status.indexOf(c.status) < 0) return false;
    if (!dentro(f.assunto, c.id_assunto, c.assunto)) return false;
    if (!dentro(f.tecnico, c.id_tecnico, c.tecnico)) return false;
    if (!dentro(f.condominio, c.id_condominio, c.condominio)) return false;
    if (!dentro(f.setor, c.id_setor, c.setor)) return false;
    if (f.atrasadas && !c._atrasada) return false;
    if (f.busca) {
      var termos = norm(f.busca).split(/\s+/).filter(Boolean);
      for (var i = 0; i < termos.length; i++) if (c._busca.indexOf(termos[i]) < 0) return false;
    }
    return true;
  }

  function comparar(a, b) {
    var campo = st.ord.campo, dir = st.ord.dir === 'asc' ? 1 : -1, va, vb;
    if (campo === 'idade') { va = a._idade; vb = b._idade; }
    else if (campo === 'sla') { va = a._sla ? a._sla.pct : null; vb = b._sla ? b._sla.pct : null; }
    else if (campo === 'data_agenda' && st.aba === 'resolvidas') { va = a.data_fechamento || a.data_final; vb = b.data_fechamento || b.data_final; }
    else if (campo === 'base') { va = (st.bases[a.base] || {}).nome || a.base; vb = (st.bases[b.base] || {}).nome || b.base; }
    else { va = a[campo]; vb = b[campo]; }
    if (va === null || va === undefined || va === '') return 1;   // vazios sempre no fim
    if (vb === null || vb === undefined || vb === '') return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) * dir;
  }

  function estadoSync(b, agora, intervaloMin) {
    var sync = data(b.ultima_sync), tent = data(b.ultima_tentativa);
    if (b.ultimo_erro && (!sync || (tent && tent > sync))) {
      return { cls: 'erro', txt: 'falhou há ' + fmtDuracao(agora - tent), erro: b.ultimo_erro };
    }
    if (!sync) return { cls: '', txt: 'aguardando 1º retrato do n8n' };
    var idade = agora - sync;
    var limite = Math.max(intervaloMin, 1) * 3 * 60000;
    if (idade > limite) return { cls: 'aviso', txt: 'sem retrato há ' + fmtDuracao(idade) };
    if (b.ultimo_erro) return { cls: 'aviso', txt: 'sincronizado há ' + fmtDuracao(idade), aviso: b.ultimo_erro };
    return { cls: 'ok', txt: 'sincronizado há ' + fmtDuracao(idade) };
  }

  // ------------------------------------------------------------------ render
  function renderBases(lista, agora) {
    var d = st.dados, cont = $('pixc-bases'), frag = document.createDocumentFragment();
    var cfg = d.config || {};
    var porBase = {};
    lista.forEach(function (c) {
      var p = porBase[c.base] || (porBase[c.base] = { total: 0, semTec: 0, atras: 0 });
      p.total++; if (!c.id_tecnico) p.semTec++; if (c._atrasada) p.atras++;
    });
    cont.classList.toggle('filtrando', st.filtro.bases.length > 0);
    (d.bases || []).forEach(function (b) {
      var p = porBase[b.codigo] || { total: 0, semTec: 0, atras: 0 };
      var card = el('div', 'pixc-base' + (st.filtro.bases.indexOf(b.codigo) >= 0 ? ' sel' : ''));
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-pressed', st.filtro.bases.indexOf(b.codigo) >= 0 ? 'true' : 'false');
      card.style.setProperty('--cor', b.cor || '#64748b');
      card.setAttribute('data-base', b.codigo);
      card.title = 'Clique para filtrar esta base (Ctrl+clique para somar)';

      var cab = el('div', 'pixc-base-cab');
      cab.appendChild(el('span', 'pixc-base-nome', b.nome));
      card.appendChild(cab);

      var nunca = !b.ultima_sync;
      var rotulo = st.aba === 'resolvidas' ? (p.total === 1 ? 'resolvida no período' : 'resolvidas no período') : (p.total === 1 ? 'aberta' : 'abertas');
      var num = el('div', 'pixc-base-num' + (nunca ? ' sem-dado' : ''), nunca ? '—' : p.total);
      num.appendChild(el('small', null, nunca ? 'sem dados ainda' : rotulo));
      card.appendChild(num);

      var k = el('div', 'pixc-kpis');
      if (st.aba === 'resolvidas') k.hidden = true;
      var k1 = el('span', 'pixc-kpi' + (p.semTec ? ' alerta' : '')); k1.appendChild(el('b', null, p.semTec)); k1.appendChild(document.createTextNode(' sem técnico'));
      var k2 = el('span', 'pixc-kpi' + (p.atras ? ' alerta' : '')); k2.appendChild(el('b', null, p.atras)); k2.appendChild(document.createTextNode(' atrasadas'));
      var k3 = el('span', 'pixc-kpi'); k3.appendChild(el('b', null, b.sairam_24h || 0)); k3.appendChild(document.createTextNode(' saíram 24h'));
      k.appendChild(k1); k.appendChild(k2); k.appendChild(k3);
      card.appendChild(k);

      var es = estadoSync(b, agora, cfg.sync_intervalo_min || 5);
      var s = el('div', 'pixc-sync ' + es.cls);
      s.appendChild(el('span', 'ponto'));
      s.appendChild(el('span', null, es.txt));
      card.appendChild(s);
      if (es.erro) card.appendChild(el('div', 'pixc-base-erro', es.erro));
      else if (es.aviso) card.appendChild(el('div', 'pixc-base-erro aviso', es.aviso));

      frag.appendChild(card);
    });
    cont.replaceChildren(frag);
  }

  var temSelect2 = !!(window.jQuery && window.jQuery.fn && window.jQuery.fn.select2);
  var silencio = 0;          // > 0 enquanto a página mexe nos selects por código
  var abertos = {};          // id do select com a lista aberta (não repõe as opções nessa hora)

  function montarSelect2(sel) {
    if (!temSelect2 || !window.PixcSelect || sel.classList.contains('select2-hidden-accessible')) return;
    if (!window.PixcSelect.montar(sel, { width: '100%' })) return;
    var $s = window.jQuery(sel);
    $s.on('select2:open', function () { abertos[sel.id] = true; });
    $s.on('select2:close', function () { delete abertos[sel.id]; render(); });
  }
  /** Repõe as opções mantendo a seleção que ainda existe; devolve a seleção válida. */
  function preencherSelect(sel, opcoes, valores) {
    valores = (valores || []).map(String);
    if (abertos[sel.id]) return valores;    // usuário está escolhendo: não mexe agora
    var frag = document.createDocumentFragment();
    opcoes.forEach(function (o) { var op = new Option(o[1], o[0]); if (o[2] !== undefined) op.setAttribute('data-n', o[2]); frag.appendChild(op); });
    sel.replaceChildren(frag);
    var validos = valores.filter(function (v) { return !!sel.querySelector('option[value="' + CSS.escape(v) + '"]'); });
    Array.prototype.forEach.call(sel.options, function (o) { o.selected = validos.indexOf(o.value) >= 0; });
    montarSelect2(sel);
    silencio++;
    try { if (temSelect2) window.jQuery(sel).trigger('change.select2'); } finally { silencio--; }
    return validos;
  }

  /** Funil: cada select mostra só o que existe dentro das bases + dos selects à esquerda. */
  function renderSelects(todos) {
    var f = st.filtro, d = st.dados;
    var universo = function (ate) { var g = filtroAte(f, ate); return todos.filter(function (c) { return passa(c, g, false); }); };
    var mapa = function (rows, idK, nomeK, rotSem) {
      var m = {}, n = {}, sem = 0;
      rows.forEach(function (c) {
        if (!c[idK]) { sem++; return; }
        var k = chave(c[idK], c[nomeK]), nm = (c[nomeK] || ('#' + c[idK])).trim();
        if (!m[k] || (/\(\d+\)\s*$/.test(m[k]) && !/\(\d+\)\s*$/.test(nm))) m[k] = nm;   // prefere o nome sem "(1)"
        n[k] = (n[k] || 0) + 1;
      });
      var lista = Object.keys(m).map(function (k) { return [k, m[k], n[k]]; })
        .sort(function (a, b) { return a[1].localeCompare(b[1], 'pt-BR'); });
      if (rotSem && sem) lista.unshift([SEM_TEC, rotSem, sem]);
      return lista;
    };
    var rs = universo('status'), stat = {};
    rs.forEach(function (c) { stat[c.status] = (stat[c.status] || 0) + 1; });
    f.status = preencherSelect($('pixc-f-status'), Object.keys(stat).map(function (s) { return [s, (d.status || {})[s] || s, stat[s]]; }), f.status);
    // Assunto: lista TODOS os assuntos cadastrados no IXC (dicionário), mesmo sem O.S. (contagem 0) — dá para salvar filtro antes de existir O.S.
    var assuntos = mapa(universo('assunto'), 'id_assunto', 'assunto'), temAssunto = {};
    assuntos.forEach(function (a) { temAssunto[a[0]] = true; });
    (d.assuntos || []).forEach(function (a) {
      if (f.bases.length && f.bases.indexOf(a.base) < 0) return;      // respeita os cards marcados
      var k = chave(a.id, a.nome); if (temAssunto[k]) return;
      temAssunto[k] = true; assuntos.push([k, String(a.nome).trim(), 0]);
    });
    assuntos.sort(function (a, b) { return a[1].localeCompare(b[1], 'pt-BR'); });
    f.assunto = preencherSelect($('pixc-f-assunto'), assuntos, f.assunto);
    f.tecnico = preencherSelect($('pixc-f-tecnico'), mapa(universo('tecnico'), 'id_tecnico', 'tecnico', '— sem técnico —'), f.tecnico);
    f.condominio = preencherSelect($('pixc-f-condominio'), mapa(universo('condominio'), 'id_condominio', 'condominio', '— sem condomínio —'), f.condominio);
    f.setor = preencherSelect($('pixc-f-setor'), mapa(universo('setor'), 'id_setor', 'setor'), f.setor);
  }

  function celula(tr, txt, cls) { var td = el('td', cls, txt); tr.appendChild(td); return td; }

  function renderTabela(lista) {
    var tb = $('pixc-linhas'), frag = document.createDocumentFragment();
    var paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
    if (st.pagina > paginas) st.pagina = paginas;
    var ini = (st.pagina - 1) * POR_PAGINA;
    var d = st.dados;

    if (!lista.length) {
      var tr0 = el('tr'); var td0 = el('td', 'pixc-vazio', st.dados.chamados.length ? 'Nenhuma O.S. com esses filtros.'
        : (st.aba === 'resolvidas' ? 'Nenhuma O.S. resolvida neste período (a coleta de resolvidas entra no bloco P2).' : 'Nenhuma O.S. aberta recebida ainda.'));
      td0.colSpan = 10; tr0.appendChild(td0); frag.appendChild(tr0);
    }

    lista.slice(ini, ini + POR_PAGINA).forEach(function (c) {
      var b = st.bases[c.base] || {};
      var tr = el('tr', 'linha' + (c._atrasada ? ' atrasada' : ''));
      tr.setAttribute('data-id', c.id);

      var tdB = el('td'); var tag = el('span', 'pixc-tag-base'); tag.style.setProperty('--cor', b.cor || '#64748b');
      tag.appendChild(el('i')); tag.appendChild(document.createTextNode(b.nome || c.base)); tdB.appendChild(tag); tr.appendChild(tdB);

      celula(tr, c.ixc_id, 'os');

      var tdS = el('td'); var sp = el('span', 'pixc-st', (d.status || {})[c.status] || c.status);
      sp.style.setProperty('--c', CORES_STATUS[c.status] || '#64748b'); tdS.appendChild(sp); tr.appendChild(tdS);

      celula(tr, c.assunto || (c.id_assunto ? '#' + c.id_assunto : ''));
      celula(tr, c.cliente || (c.id_cliente ? '#' + c.id_cliente : ''));
      celula(tr, c.condominio || (c.id_condominio ? '#' + c.id_condominio : ''));
      if (c.id_tecnico) celula(tr, c.tecnico || '#' + c.id_tecnico);
      else celula(tr, 'sem técnico', 'pixc-sem-tec');
      var tdSla = el('td', 'num'); tdSla.appendChild(window.PixcSla ? window.PixcSla.pill(c._sla) : el('span', null, '—')); tr.appendChild(tdSla);

      var tdI = celula(tr, fmtDuracao(c._idade), 'num idade' + (c._parada ? ' alerta-txt' : ''));
      if (c._parada) tdI.title = 'Sem agenda e aberta há mais de ' + (d.config.atraso_horas || 48) + 'h';

      if (st.aba === 'resolvidas') {
        celula(tr, fmtData(c.data_fechamento || c.data_final));
      } else {
        var tdA = celula(tr, fmtData(c.data_agenda), c._agendaVencida ? 'idade alerta-txt' : '');
        if (c._agendaVencida) tdA.title = 'Agenda vencida';
      }

      frag.appendChild(tr);
      if (st.aberto[c.id]) frag.appendChild(detalhe(c));
    });
    tb.replaceChildren(frag);

    // cabeçalho de ordenação
    Array.prototype.forEach.call(document.querySelectorAll('#pixc-tabela th[data-ord]'), function (th) {
      th.classList.remove('asc', 'desc');
      if (th.getAttribute('data-ord') === st.ord.campo) th.classList.add(st.ord.dir);
    });

    // paginação
    var nav = $('pixc-paginacao'), nf = document.createDocumentFragment();
    if (paginas > 1) {
      var ant = el('button', 'btn btn-sm btn-outline-secondary', '‹'); ant.type = 'button'; ant.disabled = st.pagina <= 1; ant.setAttribute('data-pag', st.pagina - 1);
      var prox = el('button', 'btn btn-sm btn-outline-secondary', '›'); prox.type = 'button'; prox.disabled = st.pagina >= paginas; prox.setAttribute('data-pag', st.pagina + 1);
      nf.appendChild(ant);
      nf.appendChild(el('span', null, 'página ' + st.pagina + ' de ' + paginas));
      nf.appendChild(prox);
    }
    nav.replaceChildren(nf);
  }

  function detalhe(c) {
    var tr = el('tr', 'detalhe'), td = el('td'); td.colSpan = 10;
    var g = el('div', 'pixc-detalhe-grade');
    var item = function (rot, val) {
      if (val === null || val === undefined || val === '') return;
      var dv = el('div'); dv.appendChild(el('span', null, rot)); dv.appendChild(document.createTextNode(String(val))); g.appendChild(dv);
    };
    item('Protocolo', c.protocolo);
    item('Atendimento (ticket)', c.id_ticket);
    item('Abertura', fmtData(c.data_abertura));
    item('Agenda', fmtData(c.data_agenda));
    item('Última atualização', fmtData(c.ultima_atualizacao));
    item('Prioridade', c.prioridade);
    item('Assunto', c.assunto ? c.assunto + ' (#' + c.id_assunto + ')' : c.id_assunto);
    item('Técnico', c.id_tecnico ? (c.tecnico || '') + ' (#' + c.id_tecnico + ')' : 'sem técnico');
    item('Cliente', c.id_cliente ? (c.cliente || '') + ' (#' + c.id_cliente + ')' : null);
    item('Condomínio', c.id_condominio ? (c.condominio || '') + ' (#' + c.id_condominio + ')' : null);
    item('Diagnóstico', c.id_diagnostico ? (c.diagnostico || '') + ' (#' + c.id_diagnostico + ')' : null);
    item('Setor', c.setor || (c.id_setor ? '#' + c.id_setor : null));
    item('Início', fmtData(c.data_inicio));
    item('Fim', fmtData(c.data_final));
    item('Fechamento', fmtData(c.data_fechamento));
    item('No painel desde', fmtData(c.primeiro_visto));
    td.appendChild(g);
    var m1 = el('div', 'pixc-detalhe-msg'); m1.appendChild(el('b', null, 'Mensagem')); m1.appendChild(document.createTextNode(c.mensagem || '(sem mensagem)')); td.appendChild(m1);
    if (c.mensagem_resposta) { var m2 = el('div', 'pixc-detalhe-msg'); m2.appendChild(el('b', null, 'Resposta do técnico')); m2.appendChild(document.createTextNode(c.mensagem_resposta)); td.appendChild(m2); }
    tr.appendChild(td);
    return tr;
  }

  function renderResumo(lista) {
    var semTec = 0, atras = 0;
    lista.forEach(function (c) { if (!c.id_tecnico) semTec++; if (c._atrasada) atras++; });
    var r = $('pixc-resumo'), f = document.createDocumentFragment();
    var parte = function (n, txt, alerta) {
      var s = el('span', alerta && n ? 'r-alerta' : null); s.appendChild(el('b', null, n)); s.appendChild(document.createTextNode(' ' + txt)); return s;
    };
    // "sem técnico" e "atrasadas" são botões: clicou, a lista fica só com essas O.S.; clicou de novo, desfaz
    var botao = function (n, txt, acao, ativo, titulo) {
      var b = el('button', 'pixc-resumo-btn' + (n ? ' r-alerta' : '') + (ativo ? ' ativo' : '')); b.type = 'button';
      b.setAttribute('data-acao', acao); b.title = ativo ? 'Clique para mostrar todas de novo' : titulo;
      b.appendChild(el('b', null, n)); b.appendChild(document.createTextNode(' ' + txt)); return b;
    };
    var soSemTec = st.filtro.tecnico.length === 1 && st.filtro.tecnico[0] === SEM_TEC;
    if (st.aba === 'resolvidas') {
      f.appendChild(parte(lista.length, lista.length === 1 ? 'O.S. resolvida' : 'O.S. resolvidas'));
      f.appendChild(document.createTextNode(' de ' + fmtDia(st.periodo.de) + ' a ' + fmtDia(st.periodo.ate)));
    } else {
      f.appendChild(parte(lista.length, lista.length === 1 ? 'O.S. aberta' : 'O.S. abertas'));
      f.appendChild(document.createTextNode(' · '));
      f.appendChild(botao(semTec, 'sem técnico', 'semtec', soSemTec, 'Mostrar só as O.S. sem técnico'));
      f.appendChild(document.createTextNode(' · '));
      f.appendChild(botao(atras, 'atrasadas', 'atrasadas', !!st.filtro.atrasadas, 'Mostrar só as O.S. atrasadas'));
    }
    if (lista.length !== st.dados.chamados.length) f.appendChild(document.createTextNode('  (de ' + st.dados.chamados.length + ' no total)'));
    r.replaceChildren(f);
  }

  function render() {
    if (!st.dados) return;
    var agora = agoraServidor();
    var atrasoMs = ((st.dados.config || {}).atraso_horas || 48) * 3600000;
    var todos = Array.isArray(st.dados.chamados) ? st.dados.chamados : [];
    todos.forEach(function (c) { enriquecer(c, agora, atrasoMs); });

    var semBase = todos.filter(function (c) { return passa(c, st.filtro, true); });
    var lista = semBase.filter(function (c) { return passa(c, st.filtro, false); }).sort(comparar);

    st.lista = lista;   // 0.12.0: o que a tela mostra (todas as páginas) — base do CSV
    renderBases(semBase, agora);
    renderSelects(todos);
    renderResumo(lista);
    renderTabela(lista);
    guardar();
  }

  // ------------------------------------------------------------------ CSV (0.12.0)
  /** Linhas exatamente como na tela: mesma busca, filtros, cards de base e ordenação. */
  function dadosCsv() {
    if (!st.dados || !Array.isArray(st.lista)) return null;
    var d = st.dados, fin = st.aba === 'resolvidas', D = window.PixcCsv.data;
    var colunas = ['Base', 'O.S.', 'Protocolo', 'Status', 'Assunto', 'Cliente', 'Condomínio', 'Técnico', 'SLA %', 'Setor', 'Diagnóstico',
      'Abertura', fin ? 'Fechamento' : 'Agenda', fin ? 'Duração' : 'Aberta há', fin ? 'Início' : 'Atrasada', 'Atendimento', 'Prioridade', 'Mensagem'];
    var linhas = st.lista.map(function (c) {
      return [
        (st.bases[c.base] || {}).nome || c.base, c.ixc_id, c.protocolo, (d.status || {})[c.status] || c.status,
        c.assunto || (c.id_assunto ? '#' + c.id_assunto : ''), c.cliente || (c.id_cliente ? '#' + c.id_cliente : ''),
        c.condominio || (c.id_condominio ? '#' + c.id_condominio : ''), c.id_tecnico ? (c.tecnico || '#' + c.id_tecnico) : 'sem técnico',
        c._sla && c._sla.pct !== null ? c._sla.pct : '',
        c.setor || (c.id_setor ? '#' + c.id_setor : ''), c.diagnostico || (c.id_diagnostico ? '#' + c.id_diagnostico : ''),
        D(c.data_abertura), fin ? D(c.data_fechamento || c.data_final) : D(c.data_agenda), fmtDuracao(c._idade),
        fin ? D(c.data_inicio) : (c._atrasada ? (c._agendaVencida ? 'agenda vencida' : 'parada') : ''),
        c.id_ticket, c.prioridade, c.mensagem
      ];
    });
    var per = fin && st.periodo.de ? '_' + st.periodo.de + '_a_' + st.periodo.ate : '';
    return { prefixo: 'os-' + (fin ? 'finalizadas' : 'abertas') + per, colunas: colunas, linhas: linhas };
  }

  function renderRelogio() {
    var a = $('pixc-atualizado'), p = $('pixc-pulso');
    if (!st.carregadoEm) return;
    var seg = Math.round((Date.now() - st.carregadoEm) / 1000);
    a.textContent = st.falhas ? 'sem conexão com o painel — tentando de novo' : 'atualizado há ' + (seg < 60 ? seg + 's' : fmtDuracao(seg * 1000));
    p.className = 'pulso' + (st.falhas ? ' falha' : '');
  }

  // ------------------------------------------------------------------ dados
  var reqId = 0;
  function carregar() {
    var meu = ++reqId;
    var url = API + '?aba=' + st.aba + (st.aba === 'resolvidas' ? '&de=' + encodeURIComponent(st.periodo.de) + '&ate=' + encodeURIComponent(st.periodo.ate) : '');
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) { window.location.reload(); throw new Error('sessão expirada'); }
        return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error(j.erro || ('HTTP ' + r.status)); return j; });
      })
      .then(function (j) {
        if (meu !== reqId) return;           // chegou uma resposta mais nova
        if (j.aba && j.aba !== st.aba) return;
        if (!Array.isArray(j.chamados)) j.chamados = [];
        if (!Array.isArray(j.bases)) j.bases = [];
        st.dados = j;
        st.bases = {};
        j.bases.forEach(function (b) { st.bases[b.codigo] = b; });
        st.agora = data(j.agora) || new Date();
        st.carregadoEm = Date.now();
        st.falhas = 0;
        render();
      })
      .catch(function (e) {
        if (meu !== reqId) return;
        st.falhas++;
        if (!st.carregadoEm) { st.carregadoEm = Date.now(); }
        if (window.console) console.warn('[painel-ixc]', e);
      })
      .then(function () { renderRelogio(); });
  }

  // ------------------------------------------------------------------ eventos
  function ligar() {
    var f = st.filtro;
    $('pixc-busca').value = f.busca;

    // 0.13.5.15: a busca só é aplicada no botão Buscar (ou Enter) — digitar não filtra mais sozinho
    var buscarAgora = function () { st.filtro.busca = $('pixc-busca').value; st.pagina = 1; render(); };
    $('pixc-buscar').addEventListener('click', buscarAgora);
    $('pixc-busca').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); buscarAgora(); } });
    [['pixc-f-status', 'status'], ['pixc-f-assunto', 'assunto'], ['pixc-f-tecnico', 'tecnico'], ['pixc-f-condominio', 'condominio'], ['pixc-f-setor', 'setor']].forEach(function (p) {
      var sel = $(p[0]);
      var aoMudar = function () {
        if (silencio) return;
        st.filtro[p[1]] = Array.prototype.filter.call(sel.options, function (o) { return o.selected; }).map(function (o) { return o.value; });
        st.pagina = 1; render();
      };
      if (temSelect2) window.jQuery(sel).on('change', aoMudar); else sel.addEventListener('change', aoMudar);
    });
    $('pixc-resumo').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-acao]'); if (!b) return;
      if (b.getAttribute('data-acao') === 'atrasadas') {
        st.filtro.atrasadas = !st.filtro.atrasadas;   // o botão do resumo é o único controle
      } else {
        var so = st.filtro.tecnico.length === 1 && st.filtro.tecnico[0] === SEM_TEC;
        st.filtro.tecnico = so ? [] : [SEM_TEC];
      }
      st.pagina = 1; render();
    });
    $('pixc-limpar').addEventListener('click', function () {
      limparFiltros();
      if (window.PixcFiltros && window.PixcFiltros.nenhum) window.PixcFiltros.nenhum('painel');   // filtro salvo volta a "— nenhum —"
    });
    $('pixc-bases').addEventListener('click', function (e) {
      var card = e.target.closest('.pixc-base'); if (!card) return;
      var fb = st.filtro, cod = card.getAttribute('data-base'), i = fb.bases.indexOf(cod);
      if (e.ctrlKey || e.metaKey) { if (i >= 0) fb.bases.splice(i, 1); else fb.bases.push(cod); }
      else fb.bases = (i >= 0 && fb.bases.length === 1) ? [] : [cod];
      st.pagina = 1; render();
    });
    document.querySelector('#pixc-tabela thead').addEventListener('click', function (e) {
      var th = e.target.closest('th[data-ord]'); if (!th) return;
      var campo = th.getAttribute('data-ord');
      if (st.ord.campo === campo) st.ord.dir = st.ord.dir === 'asc' ? 'desc' : 'asc';
      else st.ord = { campo: campo, dir: campo === 'idade' ? 'desc' : 'asc' };   // SLA: crescente = os mais estourados primeiro
      render();
    });
    $('pixc-linhas').addEventListener('click', function (e) {
      var tr = e.target.closest('tr.linha'); if (!tr) return;
      var id = tr.getAttribute('data-id');
      if (st.aberto[id]) delete st.aberto[id]; else st.aberto[id] = true;
      render();
    });
    $('pixc-paginacao').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-pag]'); if (!b || b.disabled) return;
      st.pagina = +b.getAttribute('data-pag'); render(); window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    $('pixc-bases').addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('pixc-base')) { e.preventDefault(); e.target.click(); }
    });
    if ($('pixc-atualizar')) $('pixc-atualizar').addEventListener('click', carregar);
    if (window.PixcCsv) window.PixcCsv.ligarBotao($('pixc-csv'), dadosCsv);
    Array.prototype.forEach.call(document.querySelectorAll('[data-aba]'), function (b) {
      b.addEventListener('click', function () {
        var aba = b.getAttribute('data-aba');
        if (aba === st.aba) return;
        st.aba = aba; st.pagina = 1; st.aberto = {}; st.dados = null;
        st.ord = aba === 'resolvidas' ? { campo: 'data_agenda', dir: 'desc' } : { campo: 'idade', dir: 'desc' };
        aplicarAba(); $('pixc-linhas').replaceChildren(); $('pixc-resumo').textContent = 'carregando…'; guardar(); carregar();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#pixc-periodo [data-dias]'), function (b) {
      b.addEventListener('click', function () { st.periodo = periodoPadrao(+b.getAttribute('data-dias')); aplicarAba(); guardar(); carregar(); });
    });
    $('pixc-aplicar').addEventListener('click', function () {
      var de = $('pixc-de').value, ate = $('pixc-ate').value;
      if (!de || !ate) return;
      if (de > ate) { var t = de; de = ate; ate = t; }
      st.periodo = { de: de, ate: ate }; aplicarAba(); guardar(); carregar();
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) carregar(); });
  }

  restaurar();
  // vindo da tela Auditoria (?aba=abertas|resolvidas): abre na aba pedida
  try {
    var abaUrl = new URLSearchParams(window.location.search).get('aba');
    if ((abaUrl === 'abertas' || abaUrl === 'resolvidas') && abaUrl !== st.aba) {
      st.aba = abaUrl;
      st.ord = abaUrl === 'resolvidas' ? { campo: 'data_agenda', dir: 'desc' } : { campo: 'idade', dir: 'desc' };
    }
  } catch (e) { /* navegador sem URLSearchParams */ }
  ligar();
  aplicarAba();
  var pFiltros = (window.PixcFiltros && raiz.getAttribute('data-filtros'))
    ? window.PixcFiltros.montar({ raiz: $('pixc-salvos'), url: raiz.getAttribute('data-filtros'), tela: 'painel', direitos: direitos(), obter: obterFiltroSalvo, aplicar: aplicarFiltroSalvo, limpar: limparFiltros })
    : Promise.resolve(null);
  pFiltros.then(function (padrao) {
    if (padrao) { st.filtro = { bases: [], busca: '', status: [], assunto: [], tecnico: [], condominio: [], setor: [], atrasadas: false }; padrao = Object.assign({}, padrao); delete padrao.aba; if (st.aba !== 'resolvidas') delete padrao.p; lerEstado(padrao); $('pixc-busca').value = st.filtro.busca || ''; aplicarAba(); guardar(); }
    carregar();
  });
  setInterval(function () { if (!document.hidden) carregar(); }, INTERVALO_MS);
  setInterval(renderRelogio, 1000);
  setInterval(render, 60000); // idades e "há Xmin" andam mesmo sem dados novos

  // exposto só para testes
  window.PainelIxc = { _st: st, _fmtDuracao: fmtDuracao, _passa: passa, _render: render, _carregar: carregar, _csv: dadosCsv };
})();
