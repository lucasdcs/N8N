/* Painel IXC — Atendimentos do IXC (0.11.0)
 * Abertos e finalizados das 5 bases; cada linha abre o detalhe do atendimento consultado ao vivo no IXC (0.13.3):
 * mensagem de abertura, mensagens e anexos do atendimento e, de cada O.S., mensagens e anexos (como na Auditoria).
 * Todo texto vindo do IXC entra via textContent (nunca innerHTML).
 */
(function iniciar() {
  'use strict';

  if (document.readyState !== 'complete') { window.addEventListener('load', iniciar); return; }
  var raiz = document.getElementById('pixc-atendimento');
  if (!raiz) return;

  var API = raiz.getAttribute('data-api');
  var DET = raiz.getAttribute('data-detalhe');   // 0.13.3: detalhe ao vivo no IXC
  var INTERVALO_MS = 60000;
  var SYNC_MIN = { abertos: 10, finalizados: 60 };   // ritmo do workflow
  var POR_PAGINA = 50;
  var CHAVE_LS = 'pixc_glpi_atendimento';
  var CORES_ATD = { N: '#2563eb', P: '#d97706', EP: '#0891b2', S: '#16a34a', C: '#64748b' };
  var CORES_OS = {
    A: '#dc2626', AN: '#9333ea', EN: '#2563eb', AS: '#0891b2', AG: '#059669',
    RAG: '#d97706', DS: '#0d9488', EX: '#16a34a', F: '#64748b', C: '#64748b'
  };

  var st = {
    modo: 'abertos', periodo: null, dados: null, agora: null, carregadoEm: 0, falhas: 0, bases: {},
    filtro: filtroVazio(), ord: { campo: 'data_abertura', dir: 'asc' }, pagina: 1, aberto: {},
    det: {}, osAberta: {}   // 0.13.3: detalhe ao vivo por "base:atendimento" e O.S. abertas/fechadas por "base:os"
  };
  var $ = function (id) { return document.getElementById(id); };
  /** 0.12.0: direitos da categoria (Ler/Atualizar/Criar/Deletar) desenhados pelo servidor. */
  function direitos() { try { return JSON.parse(raiz.getAttribute('data-direitos') || 'null'); } catch (e) { return null; } }
  var SEM = '__sem__';     // opção "— sem … —" dos selects
  function filtroVazio() { return { bases: [], busca: '', status: [], assunto: [], tecnico: [], condominio: [], setor: [] }; }

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
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : null;
  }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtData(s) {
    var d = data(s);
    return d ? p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) : '';
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
  function diaISO(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function periodoPadrao(dias) {
    var ate = new Date(), de = new Date(); de.setDate(de.getDate() - (dias || 30));
    return { de: diaISO(de), ate: diaISO(ate) };
  }
  function agoraServidor() {
    return st.agora ? new Date(st.agora.getTime() + (Date.now() - st.carregadoEm)) : new Date();
  }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function nomeOuId(nome, id) { return nome || (id ? '#' + id : ''); }
  function pill(cod, nomes, cores) {
    var sp = el('span', 'pixc-st', (nomes || {})[cod] || cod || '?');
    sp.style.setProperty('--c', cores[cod] || '#64748b');
    return sp;
  }
  function tagBase(cod) {
    var b = st.bases[cod] || {};
    var tag = el('span', 'pixc-tag-base'); tag.style.setProperty('--cor', b.cor || '#64748b');
    tag.appendChild(el('i')); tag.appendChild(document.createTextNode(b.nome || cod));
    return tag;
  }
  function guardar() {
    try { localStorage.setItem(CHAVE_LS, JSON.stringify({ m: st.modo, p: st.periodo, f: st.filtro, o: st.ord })); } catch (e) { /* sem storage */ }
  }
  function restaurar() {
    try {
      var v = JSON.parse(localStorage.getItem(CHAVE_LS) || 'null');
      if (v) {
        if (v.m === 'abertos' || v.m === 'finalizados') st.modo = v.m;
        if (v.p && /^\d{4}-\d{2}-\d{2}$/.test(v.p.de || '') && /^\d{4}-\d{2}-\d{2}$/.test(v.p.ate || '')) st.periodo = v.p;
        lerEstado(v);
      }
    } catch (e) { /* sem storage */ }
    var q = /[?&]modo=(abertos|finalizados)/.exec(window.location.search);
    if (q) st.modo = q[1];
    if (!st.periodo) st.periodo = periodoPadrao(30);
  }
  /** Carrega {f, o, p} no estado (localStorage ou filtro salvo). */
  function lerEstado(v) {
    if (!v) return;
    if (v.f) {
      var f = filtroVazio();
      ['bases', 'status', 'assunto', 'tecnico', 'condominio', 'setor'].forEach(function (k) {
        var x = v.f[k]; f[k] = Array.isArray(x) ? x.map(String) : (x ? [String(x)] : []);
      });
      f.busca = typeof v.f.busca === 'string' ? v.f.busca : '';
      st.filtro = f;
    }
    if (v.o && typeof v.o.campo === 'string') st.ord = { campo: v.o.campo, dir: v.o.dir === 'desc' ? 'desc' : 'asc' };
    if (v.p && /^\d{4}-\d{2}-\d{2}$/.test(v.p.de || '') && /^\d{4}-\d{2}-\d{2}$/.test(v.p.ate || '')) st.periodo = { de: v.p.de, ate: v.p.ate };
  }
  /** Filtros salvos (tela "atendimento"): o modo Abertos/Finalizados NÃO faz parte do filtro; o período só vale em Finalizados. */
  function obterFiltroSalvo() { return { f: st.filtro, o: st.ord, p: st.periodo }; }
  function limparFiltros() {
    st.filtro = filtroVazio(); st.pagina = 1; $('pixc-busca').value = ''; render();
  }
  function aplicarFiltroSalvo(v) {
    var pAntes = JSON.stringify(st.periodo);
    st.filtro = filtroVazio();
    if (v && typeof v === 'object') { v = Object.assign({}, v); if (st.modo !== 'finalizados') delete v.p; }
    lerEstado(v);
    st.pagina = 1; st.aberto = {};
    $('pixc-busca').value = st.filtro.busca || '';
    guardar();
    if (st.modo === 'finalizados' && JSON.stringify(st.periodo) !== pAntes) { render(); carregar(); } else render();
  }
  /** Botão só com ícone que copia o protocolo (span: pode ficar dentro de linha clicável). */
  function botaoCopiar(txt) {
    var b = el('span', 'pixc-copiar'); b.setAttribute('role', 'button'); b.tabIndex = 0;
    b.setAttribute('data-copiar', String(txt)); b.title = 'Copiar protocolo'; b.setAttribute('aria-label', 'Copiar protocolo');
    b.appendChild(el('i', 'ti ti-copy'));
    return b;
  }
  function copiarTexto(txt) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(txt);
    return new Promise(function (ok, erro) {
      var t = document.createElement('textarea'); t.value = txt; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      var feito = false; try { feito = document.execCommand('copy'); } catch (e) { /* sem suporte */ }
      t.remove(); if (feito) ok(); else erro(new Error('cópia bloqueada'));
    });
  }
  function aoCopiar(b) {
    var i = b.querySelector('i'), titulo = b.title;
    copiarTexto(b.getAttribute('data-copiar')).then(function () {
      b.classList.add('copiado'); i.className = 'ti ti-check'; b.title = 'Copiado!';
    }, function () {
      b.classList.add('falhou'); i.className = 'ti ti-x'; b.title = 'Não consegui copiar — selecione e use Ctrl+C';
    }).then(function () {
      setTimeout(function () { b.classList.remove('copiado', 'falhou'); i.className = 'ti ti-copy'; b.title = titulo; }, 1500);
    });
  }

  // ------------------------------------------------------------------ regras
  function enriquecer(a) {
    a.os = Array.isArray(a.os) ? a.os : [];
    a._cliente = nomeOuId(a.cliente, a.id_cliente);
    a._assunto = nomeOuId(a.assunto, a.id_assunto);
    a._setor = nomeOuId(a.setor, a.id_setor);
    a._resp = nomeOuId(a.responsavel, a.id_responsavel);
    a._cond = nomeOuId(a.condominio, a.id_condominio);
    // 0.13.5: SLA como o IXC (horas do assunto para solucionar o atendimento); nos finalizados fica congelado na última atualização
    var cfgSla = ((st.dados.sla || {}).bases || {})[a.base];
    a._sla = (window.PixcSla && cfgSla) ? window.PixcSla.deAtd(a, cfgSla[a.id_assunto], agoraServidor(), st.modo === 'finalizados' ? a.ultima_atualizacao : null) : null;
    a._busca = norm([a.ixc_id, a.protocolo, a._cliente, a._cond, a._assunto, a._setor, a._resp, a.titulo,
      (st.dados.status || {})[a.status] || a.status,
      a.os.map(function (o) { return [o.id, o.protocolo, o.assunto].join(' '); }).join(' ')].join(' '));
  }
  /** chave de uma opção: o NOME (mescla bases); sem nome usa id:N; sem valor = SEM (igual ao painel) */
  function normalizar(nome) {
    return String(nome).toLowerCase().trim().replace(/\s*\(\d+\)\s*$/, '').replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }
  function chave(id, nome) { if (!id) return SEM; return nome ? normalizar(nome) : 'id:' + id; }
  function dentro(lista, id, nome) { return !lista.length || lista.indexOf(chave(id, nome)) >= 0; }
  var ORDEM_SEL = ['status', 'assunto', 'tecnico', 'condominio', 'setor'];
  /** cópia do filtro só com as dimensões anteriores a `ate` (funil na ordem dos campos) */
  function filtroAte(f, ate) {
    var g = filtroVazio(); g.bases = f.bases;
    for (var i = 0; i < ORDEM_SEL.length && ORDEM_SEL[i] !== ate; i++) g[ORDEM_SEL[i]] = f[ORDEM_SEL[i]];
    return g;
  }
  function passa(a, f, ignorarBase) {
    if (!ignorarBase && f.bases.length && f.bases.indexOf(a.base) < 0) return false;
    if (f.status.length && f.status.indexOf(a.status) < 0) return false;
    if (!dentro(f.assunto, a.id_assunto, a.assunto)) return false;
    if (!dentro(f.tecnico, a.id_responsavel, a.responsavel)) return false;
    if (!dentro(f.condominio, a.id_condominio, a.condominio)) return false;
    if (!dentro(f.setor, a.id_setor, a.setor)) return false;
    if (f.busca) {
      var termos = norm(f.busca).split(/\s+/).filter(Boolean);
      for (var i = 0; i < termos.length; i++) if (a._busca.indexOf(termos[i]) < 0) return false;
    }
    return true;
  }
  var CHAVE_ORD = {
    protocolo: function (a) { return a.protocolo || ''; },
    cliente: function (a) { return norm(a._cliente); },
    assunto: function (a) { return norm(a._assunto); },
    setor: function (a) { return norm(a._setor); },
    responsavel: function (a) { return norm(a._resp); },
    sla: function (a) { return a._sla && a._sla.pct !== null ? a._sla.pct : 1e9; },
    status: function (a) { return norm((st.dados.status || {})[a.status] || a.status); },
    data_abertura: function (a) { return a.data_abertura || ''; },
    ultima_atualizacao: function (a) { return a.ultima_atualizacao || ''; },
    qtd_os: function (a) { return a.os.length; }
  };
  function ordenar(lista) {
    var f = CHAVE_ORD[st.ord.campo] || CHAVE_ORD.data_abertura, s = st.ord.dir === 'desc' ? -1 : 1;
    return lista.sort(function (x, y) {
      var a = f(x), b = f(y);
      if (a < b) return -s; if (a > b) return s;
      return (x.id - y.id) * s;
    });
  }
  function estadoSync(b, agora) {
    var p = st.modo === 'finalizados' ? 'fin_' : '';
    var sync = data(b[p + 'ultima_sync']), tent = data(b[p + 'ultima_tentativa']);
    if (!tent) return { cls: '', txt: 'aguardando 1ª coleta do n8n' };
    if (String(b[p + 'ultimo_ok']) === '0') return { cls: 'erro', txt: 'falhou há ' + fmtDuracao(agora - tent), erro: b[p + 'ultimo_erro'] };
    if (!sync) return { cls: '', txt: 'aguardando 1ª coleta do n8n' };
    var idade = agora - sync;
    if (idade > SYNC_MIN[st.modo] * 3 * 60000) return { cls: 'aviso', txt: 'sem coleta há ' + fmtDuracao(idade) };
    if (b[p + 'ultimo_erro']) return { cls: 'aviso', txt: 'coletado há ' + fmtDuracao(idade), aviso: b[p + 'ultimo_erro'] };
    return { cls: 'ok', txt: 'coletado há ' + fmtDuracao(idade) };
  }

  // ------------------------------------------------------------------ render
  function renderModo() {
    Array.prototype.forEach.call(document.querySelectorAll('.pixc-atd-modo'), function (b) {
      var on = b.getAttribute('data-modo') === st.modo;
      b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('pixc-periodo').hidden = st.modo !== 'finalizados';
    $('pixc-de').value = st.periodo.de; $('pixc-ate').value = st.periodo.ate;
    Array.prototype.forEach.call(document.querySelectorAll('#pixc-tabela th[data-ord]'), function (th) {
      th.classList.remove('asc', 'desc');
      if (th.getAttribute('data-ord') === st.ord.campo) th.classList.add(st.ord.dir);
    });
  }
  function renderBases(lista, agora) {
    var cont = $('pixc-bases'), frag = document.createDocumentFragment(), por = {};
    lista.forEach(function (a) {
      var p = por[a.base] || (por[a.base] = { total: 0, os: 0, semOs: 0 });
      p.total++; p.os += a.os.length; if (!a.os.length) p.semOs++;
    });
    cont.classList.toggle('filtrando', st.filtro.bases.length > 0);
    (st.dados.bases || []).forEach(function (b) {
      var p = por[b.codigo] || { total: 0, os: 0, semOs: 0 };
      var sel = st.filtro.bases.indexOf(b.codigo) >= 0;
      var card = el('div', 'pixc-base' + (sel ? ' sel' : ''));
      card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-pressed', sel ? 'true' : 'false');
      card.style.setProperty('--cor', b.cor || '#64748b'); card.setAttribute('data-base', b.codigo);
      card.title = 'Clique para filtrar esta base (Ctrl+clique para somar)';
      var cab = el('div', 'pixc-base-cab'); cab.appendChild(el('span', 'pixc-base-nome', b.nome)); card.appendChild(cab);
      var nunca = !(st.modo === 'finalizados' ? b.fin_ultima_sync : b.ultima_sync);
      var num = el('div', 'pixc-base-num' + (nunca && !p.total ? ' sem-dado' : ''), nunca && !p.total ? '—' : p.total);
      num.appendChild(el('small', null, nunca && !p.total ? 'sem dados ainda'
        : (st.modo === 'abertos' ? (p.total === 1 ? 'atendimento aberto' : 'atendimentos abertos')
          : (p.total === 1 ? 'finalizado no período' : 'finalizados no período'))));
      card.appendChild(num);
      var k = el('div', 'pixc-kpis');
      var k1 = el('span', 'pixc-kpi'); k1.appendChild(el('b', null, p.os)); k1.appendChild(document.createTextNode(' O.S.'));
      var k2 = el('span', 'pixc-kpi'); k2.appendChild(el('b', null, p.semOs)); k2.appendChild(document.createTextNode(' sem O.S.'));
      k.appendChild(k1); k.appendChild(k2);
      card.appendChild(k);
      var es = estadoSync(b, agora);
      var s = el('div', 'pixc-sync ' + es.cls); s.appendChild(el('span', 'ponto')); s.appendChild(el('span', null, es.txt)); card.appendChild(s);
      if (es.erro) card.appendChild(el('div', 'pixc-base-erro', es.erro));
      else if (es.aviso) card.appendChild(el('div', 'pixc-base-erro aviso', es.aviso));
      frag.appendChild(card);
    });
    cont.replaceChildren(frag);
  }
  function renderResumo(lista, total) {
    var nOs = 0; lista.forEach(function (a) { nOs += a.os.length; });
    var r = $('pixc-resumo'), f = document.createDocumentFragment();
    var parte = function (n, txt) { var s = el('span'); s.appendChild(el('b', null, n)); s.appendChild(document.createTextNode(' ' + txt)); return s; };
    f.appendChild(parte(lista.length, st.modo === 'abertos'
      ? (lista.length === 1 ? 'atendimento aberto' : 'atendimentos abertos')
      : (lista.length === 1 ? 'atendimento finalizado' : 'atendimentos finalizados')));
    f.appendChild(document.createTextNode(' · '));
    f.appendChild(parte(nOs, nOs === 1 ? 'O.S.' : 'O.S. no total'));
    if (st.modo === 'finalizados' && st.dados.periodo) {
      f.appendChild(document.createTextNode(' · última atualização de ' + st.dados.periodo.de.split('-').reverse().join('/') +
        ' a ' + st.dados.periodo.ate.split('-').reverse().join('/')));
    }
    if (lista.length !== total) f.appendChild(document.createTextNode('  (de ' + total + ' no total)'));
    if (st.dados.limite) f.appendChild(el('span', 'r-alerta', '  · mostrando só os primeiros ' + total + ' — reduza o período'));
    if (st.filtro.bases.length) {
      var nomes = st.filtro.bases.map(function (c) { return (st.bases[c] || {}).nome || c; }).join(', ');
      var bt = el('button', 'pixc-resumo-btn ativo pixc-atd-todas'); bt.type = 'button'; bt.title = 'Mostrar todas as bases';
      bt.appendChild(document.createTextNode('Só ' + nomes + ' — ver todas as bases ✕'));
      f.appendChild(document.createTextNode('  ')); f.appendChild(bt);
    }
    r.replaceChildren(f);
  }
  // ------------------------------------------------------------------ selects (mesmo funil do painel)
  var temSelect2 = !!(window.jQuery && window.jQuery.fn && window.jQuery.fn.select2);
  var silencio = 0;          // > 0 enquanto a página mexe nos selects por código
  var abertosSel = {};       // id do select com a lista aberta (não repõe as opções nessa hora)
  function montarSelect2(sel) {
    if (!temSelect2 || !window.PixcSelect || sel.classList.contains('select2-hidden-accessible')) return;
    if (!window.PixcSelect.montar(sel, { width: '100%' })) return;
    var $s = window.jQuery(sel);
    $s.on('select2:open', function () { abertosSel[sel.id] = true; });
    $s.on('select2:close', function () { delete abertosSel[sel.id]; render(); });
  }
  /** Repõe as opções mantendo a seleção que ainda existe; devolve a seleção válida. */
  function preencherSelect(sel, opcoes, valores) {
    valores = (valores || []).map(String);
    if (abertosSel[sel.id]) return valores;
    var frag = document.createDocumentFragment();
    opcoes.forEach(function (o) { var op = new Option(o[1], o[0]); if (o[2] !== undefined) op.setAttribute('data-n', o[2]); frag.appendChild(op); });
    sel.replaceChildren(frag);
    var validos = valores.filter(function (v) { return opcoes.some(function (o) { return o[0] === v; }); });
    Array.prototype.forEach.call(sel.options, function (o) { o.selected = validos.indexOf(o.value) >= 0; });
    montarSelect2(sel);
    silencio++;
    try { if (temSelect2) window.jQuery(sel).trigger('change.select2'); } finally { silencio--; }
    return validos;
  }
  /** Funil: cada select mostra só o que existe dentro das bases + dos selects à esquerda. */
  function renderSelects(todos) {
    var f = st.filtro, d = st.dados;
    var universo = function (ate) { var g = filtroAte(f, ate); return todos.filter(function (a) { return passa(a, g, false); }); };
    var mapa = function (rows, idK, nomeK, rotSem) {
      var m = {}, n = {}, sem = 0;
      rows.forEach(function (a) {
        if (!a[idK]) { sem++; return; }
        var k = chave(a[idK], a[nomeK]), nm = String(a[nomeK] || ('#' + a[idK])).trim();
        if (!m[k] || (/\(\d+\)\s*$/.test(m[k]) && !/\(\d+\)\s*$/.test(nm))) m[k] = nm;
        n[k] = (n[k] || 0) + 1;
      });
      var lista = Object.keys(m).map(function (k) { return [k, m[k], n[k]]; })
        .sort(function (x, y) { return x[1].localeCompare(y[1], 'pt-BR'); });
      if (rotSem && sem) lista.unshift([SEM, rotSem, sem]);
      return lista;
    };
    var stat = {};
    universo('status').forEach(function (a) { stat[a.status] = (stat[a.status] || 0) + 1; });
    f.status = preencherSelect($('pixc-f-status'), Object.keys(stat).map(function (s) { return [s, (d.status || {})[s] || s, stat[s]]; }), f.status);
    // Assunto: todos os assuntos cadastrados (dicionário), mesmo sem atendimento — dá para salvar filtro antes de existir
    var assuntos = mapa(universo('assunto'), 'id_assunto', 'assunto'), tem = {};
    assuntos.forEach(function (a) { tem[a[0]] = true; });
    (d.assuntos || []).forEach(function (a) {
      if (f.bases.length && f.bases.indexOf(a.base) < 0) return;
      var k = chave(a.id, a.nome); if (tem[k]) return;
      tem[k] = true; assuntos.push([k, String(a.nome).trim(), 0]);
    });
    assuntos.sort(function (x, y) { return x[1].localeCompare(y[1], 'pt-BR'); });
    f.assunto = preencherSelect($('pixc-f-assunto'), assuntos, f.assunto);
    f.tecnico = preencherSelect($('pixc-f-tecnico'), mapa(universo('tecnico'), 'id_responsavel', 'responsavel', '— sem responsável —'), f.tecnico);
    f.condominio = preencherSelect($('pixc-f-condominio'), mapa(universo('condominio'), 'id_condominio', 'condominio', '— sem condomínio —'), f.condominio);
    f.setor = preencherSelect($('pixc-f-setor'), mapa(universo('setor'), 'id_setor', 'setor', '— sem setor —'), f.setor);
  }

  function td(cls, conteudo) {
    var c = el('td', cls);
    if (conteudo instanceof Node) c.appendChild(conteudo); else if (conteudo !== null && conteudo !== undefined) c.textContent = String(conteudo);
    return c;
  }
  function linha(a) {
    var aberto = !!st.aberto[a.id];
    var tr = el('tr', 'linha' + (aberto ? ' aberta' : '')); tr.setAttribute('data-id', a.id);
    tr.setAttribute('aria-expanded', aberto ? 'true' : 'false');
    var prot = el('div', 'pixc-atd-prot');
    prot.appendChild(tagBase(a.base));
    var lp = el('span', 'pixc-com-copiar');
    var pn = el('span', 'pixc-atd-num', a.protocolo || '#' + a.ixc_id);
    pn.title = 'Atendimento #' + a.ixc_id;
    lp.appendChild(pn);
    if (a.protocolo) lp.appendChild(botaoCopiar(a.protocolo));
    prot.appendChild(lp);
    tr.appendChild(td('os', prot));
    var cli = el('div', null, a._cliente || 'cliente não identificado');
    if (a._cond) cli.appendChild(el('small', 'pixc-atd-cond', a._cond));
    if (a.titulo) cli.appendChild(el('small', 'pixc-atd-titulo', a.titulo));
    tr.appendChild(td(null, cli));
    tr.appendChild(td(null, a._assunto));
    tr.appendChild(td(null, a._setor));
    tr.appendChild(td(null, a._resp || '—'));
    tr.appendChild(td('num', window.PixcSla ? window.PixcSla.pill(a._sla) : '—'));
    tr.appendChild(td(null, pill(a.status, st.dados.status, CORES_ATD)));
    tr.appendChild(td('pixc-atd-data', fmtData(a.data_abertura)));
    tr.appendChild(td('pixc-atd-data', fmtData(a.ultima_atualizacao)));
    var q = el('span', 'pixc-atd-qtd' + (a.os.length ? '' : ' zero'), a.os.length);
    q.appendChild(el('i', 'ti ti-chevron-down pixc-atd-seta'));
    tr.appendChild(td('num', q));
    return tr;
  }
  // ------------------------------------------------------------------ detalhe ao vivo (0.13.3 · P13-6)
  // Ao abrir a linha, o painel consulta o IXC (front/atendimento_detalhe.php): O.S. do atendimento com mensagens e anexos,
  // mensagens e anexos do próprio atendimento. Fica 3 min em memória; "Recarregar" consulta de novo.
  var DET_TTL = 180000;
  function chaveDet(a) { return a.base + ':' + a.ixc_id; }
  function campo(g, rot, val) {
    if (val === null || val === undefined || val === '') return;
    var dv = el('div'); dv.appendChild(el('span', null, rot));
    if (val instanceof Node) dv.appendChild(val); else dv.appendChild(document.createTextNode(String(val)));
    g.appendChild(dv);
  }
  function bloco(titulo, conteudo, cls) {
    var s = el('section', 'pixc-aud-bloco' + (cls ? ' ' + cls : ''));
    s.appendChild(el('h4', null, titulo)); s.appendChild(conteudo);
    return s;
  }
  function texto(t) { return el('div', 'pixc-detalhe-msg', t || ''); }
  function comCopiar(txt) {
    var sp = el('span', 'pixc-com-copiar'); sp.appendChild(document.createTextNode(String(txt))); sp.appendChild(botaoCopiar(txt));
    return sp;
  }
  /** Link do anexo na web do IXC (exige estar logado no IXC da base), como na Auditoria. tipo: 'os' | 'atd' (caminho vem do servidor). */
  function urlAnexo(det, arq, tipo) {
    var base = String(det.ixc_url || (st.bases[det.base] || {}).ixc_url || '').replace(/\/+$/, '');
    var modelo = ((det.url_anexo || {})[tipo]) || (tipo === 'os' ? '/aplicativo/su_oss_chamado/rel_30001.php?id={id}' : '');
    if (!modelo || !/^https?:\/\/[^\s"'<>]+$/i.test(base) || !arq || !/^\d+$/.test(String(arq.id))) return null;
    return base + modelo.replace('{id}', encodeURIComponent(String(arq.id)));
  }
  function listaAnexos(arqs, vazio, url, dica) {
    var ul = el('ul', 'pixc-aud-anexos');
    if (!arqs.length) ul.appendChild(el('li', 'pixc-aud-vazio', vazio));
    arqs.forEach(function (f) {
      var li = el('li'), u = url ? url(f) : null, nome = f.descricao || f.nome || ('anexo #' + f.id);
      li.appendChild(el('i', 'ti ti-paperclip'));
      if (u) {
        var lk = el('a', null, nome); lk.href = u; lk.target = '_blank'; lk.rel = 'noopener noreferrer';
        lk.title = dica || 'Abrir no IXC (é preciso estar logado no IXC da base)';
        li.appendChild(lk);
      } else li.appendChild(el('span', null, nome));
      var meta = [f.descricao && f.nome ? f.nome : '', fmtData(f.data)].filter(Boolean).join(' · ');
      if (meta) li.appendChild(el('small', null, meta));
      ul.appendChild(li);
    });
    return ul;
  }
  function listaMsgs(msgs, vazio) {
    var ol = el('ol', 'pixc-aud-msgs');
    if (!msgs.length) ol.appendChild(el('li', 'pixc-aud-vazio', vazio));
    msgs.forEach(function (m) {
      var li = el('li'), cab = el('div', 'pixc-aud-msg-cab');
      cab.appendChild(el('b', null, fmtData(m.data) || 'sem data'));
      if (m.status) cab.appendChild(pill(m.status, st.dados.status_os, CORES_OS));
      if (m.autor) cab.appendChild(el('small', null, m.autor));
      li.appendChild(cab);
      if (m.mensagem) li.appendChild(el('div', 'pixc-aud-msg-txt', m.mensagem));
      if (m.historico) li.appendChild(el('small', null, m.historico));
      ol.appendChild(li);
    });
    return ol;
  }
  /** Tabela simples de O.S. que já vem da coleta (enquanto o IXC responde, ou se ele falhar). */
  function tabelaOs(a) {
    if (!a.os.length) return el('div', 'pixc-aud-vazio', 'Este atendimento não tem O.S. na última coleta.');
    var t = el('table', 'pixc-atd-os'), h = el('tr');
    ['O.S.', 'Protocolo', 'Assunto', 'Status'].forEach(function (x) { h.appendChild(el('th', null, x)); });
    var th = el('thead'); th.appendChild(h); t.appendChild(th);
    var tb = el('tbody');
    a.os.forEach(function (o) {
      var l = el('tr');
      l.appendChild(el('td', 'os', o.id));
      var p = el('td', 'os');
      if (o.protocolo) { p.appendChild(document.createTextNode(o.protocolo)); p.appendChild(botaoCopiar(o.protocolo)); } else p.textContent = '—';
      l.appendChild(p);
      l.appendChild(el('td', null, nomeOuId(o.assunto, o.id_assunto) || '—'));
      l.appendChild(td(null, o.status ? pill(o.status, st.dados.status_os, CORES_OS) : '—'));
      tb.appendChild(l);
    });
    t.appendChild(tb);
    return t;
  }
  function cartaoOs(det, o, unica) {
    var k = det.base + ':' + o.id;
    var d = el('details', 'pixc-atd-osdet'); d.setAttribute('data-os', k);
    d.open = st.osAberta[k] !== undefined ? st.osAberta[k] : unica;
    var s = el('summary');
    s.appendChild(el('i', 'ti ti-chevron-right pixc-atd-osdet-seta'));
    s.appendChild(el('b', 'os', 'O.S. ' + o.id));
    if (o.protocolo) s.appendChild(comCopiar(o.protocolo));
    s.appendChild(el('span', 'pixc-atd-osdet-ass', nomeOuId(o.assunto, o.id_assunto) || 'sem assunto'));
    if (o.status) s.appendChild(pill(o.status, st.dados.status_os, CORES_OS));
    var kp = el('span', 'pixc-atd-osdet-kpis');
    kp.appendChild(el('span', null, o.tecnico || (o.id_tecnico ? 'colaborador #' + o.id_tecnico : 'sem técnico')));
    kp.appendChild(el('span', null, o.msgs.length + (o.msgs.length === 1 ? ' mensagem' : ' mensagens')));
    kp.appendChild(el('span', null, o.arquivos.length + (o.arquivos.length === 1 ? ' anexo' : ' anexos')));
    s.appendChild(kp);
    d.appendChild(s);

    var col = el('div', 'pixc-aud-colunas'), esq = el('div'), dir = el('div');
    var g = el('div', 'pixc-detalhe-grade');
    campo(g, 'Status', o.status ? pill(o.status, st.dados.status_os, CORES_OS) : null);
    campo(g, 'Assunto', nomeOuId(o.assunto, o.id_assunto));
    campo(g, 'Técnico', nomeOuId(o.tecnico, o.id_tecnico));
    campo(g, 'Setor', nomeOuId(o.setor, o.id_setor));
    campo(g, 'Abertura', fmtData(o.data_abertura));
    campo(g, 'Agendamento', fmtData(o.data_agenda));
    campo(g, 'Fechamento', fmtData(o.data_fechamento));
    esq.appendChild(bloco('O.S. ' + o.id, g));
    if (o.mensagem) esq.appendChild(bloco('Mensagem de abertura da O.S.', texto(o.mensagem)));
    if (o.mensagem_resposta) esq.appendChild(bloco('Resposta do técnico', texto(o.mensagem_resposta)));
    esq.appendChild(bloco('Anexos da O.S. (' + o.arquivos.length + ')',
      listaAnexos(o.arquivos, 'Nenhum anexo nesta O.S.', function (f) { return urlAnexo(det, f, 'os'); })));
    dir.appendChild(bloco('Mensagens da O.S. (' + o.msgs.length + ')', listaMsgs(o.msgs, 'Sem mensagens nesta O.S.')));
    col.appendChild(esq); col.appendChild(dir);
    var corpo = el('div', 'pixc-atd-osdet-corpo'); corpo.appendChild(col);
    d.appendChild(corpo);
    return d;
  }
  function detalheVivo(a, det) {
    var c = el('div', 'pixc-aud-corpo pixc-atd-det');
    (det.avisos || []).forEach(function (t) { c.appendChild(el('div', 'pixc-base-erro aviso', 'IXC: ' + t)); });
    var col = el('div', 'pixc-aud-colunas'), esq = el('div'), dir = el('div');
    var at = det.atendimento || {};
    var g = el('div', 'pixc-detalhe-grade');
    campo(g, 'Protocolo', at.protocolo || a.protocolo ? comCopiar(at.protocolo || a.protocolo) : null);
    campo(g, 'Título', at.titulo || a.titulo);
    campo(g, 'Cliente', a._cliente);
    campo(g, 'Abertura', fmtData(at.data_abertura || a.data_abertura));
    campo(g, 'Status', pill(a.status, st.dados.status, CORES_ATD));
    esq.appendChild(bloco('Atendimento #' + a.ixc_id, g));
    if (at.mensagem) esq.appendChild(bloco('Mensagem de abertura do atendimento', texto(at.mensagem)));
    esq.appendChild(bloco('Anexos do atendimento (' + det.arquivos.length + ')', listaAnexos(det.arquivos, 'Nenhum anexo no atendimento.', function (f) { return urlAnexo(det, f, 'atd'); })));
    dir.appendChild(bloco('Mensagens do atendimento (' + det.msgs.length + ')', listaMsgs(det.msgs, 'Sem mensagens no atendimento.')));
    col.appendChild(esq); col.appendChild(dir);
    c.appendChild(col);
    var lst = el('div', 'pixc-atd-oslista');
    if (!det.os.length) lst.appendChild(el('div', 'pixc-aud-vazio', 'Este atendimento não tem O.S. no IXC.'));
    det.os.forEach(function (o) { lst.appendChild(cartaoOs(det, o, det.os.length === 1)); });
    c.appendChild(bloco('O.S. do atendimento (' + det.os.length + ')', lst));
    return c;
  }
  function buscarDetalhe(a, forcar) {
    var k = chaveDet(a), atual = st.det[k];
    if (atual && atual.estado === 'carregando') return;
    if (!forcar && atual && Date.now() - atual.em < (atual.estado === 'erro' ? 30000 : DET_TTL)) return;   // erro: tenta de novo após 30 s
    if (!DET) return;
    Object.keys(st.det).forEach(function (x) { if (Date.now() - st.det[x].em > 600000) delete st.det[x]; });   // não acumula na memória
    st.det[k] = { estado: 'carregando', em: Date.now(), dados: atual && atual.dados };
    var u = DET + (DET.indexOf('?') >= 0 ? '&' : '?') + 'base=' + encodeURIComponent(a.base) + '&id=' + encodeURIComponent(a.ixc_id);
    fetch(u, { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) { window.location.reload(); throw new Error('sessão expirada'); }
        return r.json().catch(function () { return { ok: false, erro: 'HTTP ' + r.status }; });
      })
      .then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.erro) || 'falha na consulta');
        ['msgs', 'arquivos', 'os', 'avisos'].forEach(function (x) { if (!Array.isArray(j[x])) j[x] = []; });
        j.os.forEach(function (o) { if (!Array.isArray(o.msgs)) o.msgs = []; if (!Array.isArray(o.arquivos)) o.arquivos = []; });
        st.det[k] = { estado: 'ok', em: Date.now(), dados: j };
      })
      .catch(function (e) { st.det[k] = { estado: 'erro', em: Date.now(), erro: e.message, dados: atual && atual.dados }; })
      .then(function () { if (st.aberto[a.id]) render(); });
  }
  function detalhe(a) {
    var tr = el('tr', 'detalhe'), c = el('td'); c.colSpan = 10;
    var k = chaveDet(a);
    tr.setAttribute('data-det', k);
    buscarDetalhe(a, false);
    var d = st.det[k] || { estado: 'carregando' };
    var barra = el('div', 'pixc-atd-det-barra');
    if (d.estado === 'carregando') barra.appendChild(el('span', 'pixc-atd-det-st', 'Consultando O.S., mensagens e anexos no IXC…'));
    else if (d.estado === 'erro') barra.appendChild(el('span', 'pixc-atd-det-st erro', 'Não consegui consultar o IXC: ' + d.erro));
    else barra.appendChild(el('span', 'pixc-atd-det-st', 'Consultado no IXC às ' + fmtData(d.dados.consultado).slice(11)));
    var rb = el('button', 'btn btn-sm btn-outline-secondary'); rb.type = 'button';
    rb.setAttribute('data-recarregar', a.id); rb.disabled = d.estado === 'carregando';
    rb.appendChild(el('i', 'ti ti-refresh')); rb.appendChild(document.createTextNode(' Recarregar'));
    barra.appendChild(rb);
    c.appendChild(barra);
    if (d.dados) c.appendChild(detalheVivo(a, d.dados));
    else {
      c.appendChild(el('div', 'pixc-atd-os-tit', 'O.S. do atendimento #' + a.ixc_id + ' (' + a.os.length + ') — última coleta'));
      c.appendChild(tabelaOs(a));
    }
    tr.appendChild(c);
    return tr;
  }
  function renderPaginacao(total) {
    var nav = $('pixc-paginacao'), pags = Math.max(1, Math.ceil(total / POR_PAGINA));
    if (st.pagina > pags) st.pagina = pags;
    if (pags <= 1) { nav.replaceChildren(); return; }
    var f = document.createDocumentFragment();
    var bt = function (txt, pag, off) {
      var b = el('button', 'btn btn-sm btn-outline-secondary', txt); b.type = 'button';
      b.setAttribute('data-pag', pag); b.disabled = !!off; return b;
    };
    f.appendChild(bt('‹ Anterior', st.pagina - 1, st.pagina <= 1));
    f.appendChild(el('span', null, 'página ' + st.pagina + ' de ' + pags));
    f.appendChild(bt('Próxima ›', st.pagina + 1, st.pagina >= pags));
    nav.replaceChildren(f);
  }
  function render() {
    renderModo();
    if (!st.dados) return;
    var agora = agoraServidor();
    var todos = Array.isArray(st.dados.atendimentos) ? st.dados.atendimentos : [];
    todos.forEach(enriquecer);
    var semBase = todos.filter(function (a) { return passa(a, st.filtro, true); });
    var lista = ordenar(semBase.filter(function (a) { return passa(a, st.filtro, false); }));
    st.lista = lista;   // 0.12.0: base do CSV
    renderBases(semBase, agora);
    renderSelects(todos);
    renderResumo(lista, todos.length);
    renderPaginacao(lista.length);
    var corpo = $('pixc-linhas'), frag = document.createDocumentFragment();
    if (!lista.length) {
      var v = el('tr'), c = el('td', 'pixc-vazio'); c.colSpan = 10;
      c.textContent = todos.length ? 'Nenhum atendimento com esses filtros.'
        : (st.modo === 'abertos' ? 'Nenhum atendimento aberto recebido ainda (o workflow "Painel IXC - Atendimentos" roda a cada 10 min).'
          : 'Nenhum atendimento finalizado no período.');
      v.appendChild(c); frag.appendChild(v);
    }
    lista.slice((st.pagina - 1) * POR_PAGINA, st.pagina * POR_PAGINA).forEach(function (a) {
      frag.appendChild(linha(a));
      if (st.aberto[a.id]) frag.appendChild(detalhe(a));
    });
    // 0.13.3: o redesenho de 1 em 1 min não pode jogar para o topo as listas de mensagens que a pessoa está lendo
    var rolagem = {};
    Array.prototype.forEach.call(corpo.querySelectorAll('tr.detalhe[data-det]'), function (d) {
      Array.prototype.forEach.call(d.querySelectorAll('.pixc-aud-msgs, .pixc-detalhe-msg'), function (e, i) {
        if (e.scrollTop) rolagem[d.getAttribute('data-det') + '#' + i] = e.scrollTop;
      });
    });
    corpo.replaceChildren(frag);
    Array.prototype.forEach.call(corpo.querySelectorAll('tr.detalhe[data-det]'), function (d) {
      Array.prototype.forEach.call(d.querySelectorAll('.pixc-aud-msgs, .pixc-detalhe-msg'), function (e, i) {
        var y = rolagem[d.getAttribute('data-det') + '#' + i]; if (y) e.scrollTop = y;
      });
    });
    guardar();
  }
  // ------------------------------------------------------------------ CSV (0.12.0)
  function dadosCsv() {
    if (!st.dados || !Array.isArray(st.lista)) return null;
    var D = window.PixcCsv.data, so = st.dados.status_os || {};
    var colunas = ['Base', 'Protocolo', 'Atendimento', 'Cliente', 'Condomínio', 'Título', 'Assunto', 'Setor', 'Responsável', 'SLA %', 'Status',
      'Abertura', 'Última atualização', 'Qtd. O.S.', 'O.S. (número · protocolo · assunto · status)'];
    var linhas = st.lista.map(function (a) {
      return [
        (st.bases[a.base] || {}).nome || a.base, a.protocolo, a.ixc_id, a._cliente, a._cond, a.titulo, a._assunto, a._setor, a._resp,
        a._sla && a._sla.pct !== null ? a._sla.pct : '', (st.dados.status || {})[a.status] || a.status, D(a.data_abertura), D(a.ultima_atualizacao), a.os.length,
        a.os.map(function (o) { return [o.id, o.protocolo || '', nomeOuId(o.assunto, o.id_assunto), so[o.status] || o.status || ''].join(' · '); }).join(' | ')
      ];
    });
    var per = st.modo === 'finalizados' && st.periodo ? '_' + st.periodo.de + '_a_' + st.periodo.ate : '';
    return { prefixo: 'atendimentos-' + st.modo + per, colunas: colunas, linhas: linhas };
  }
  function renderRelogio() {
    if (!st.carregadoEm) return;
    var seg = Math.round((Date.now() - st.carregadoEm) / 1000);
    $('pixc-atualizado').textContent = st.falhas ? 'sem conexão com o painel — tentando de novo' : 'atualizado há ' + (seg < 60 ? seg + 's' : fmtDuracao(seg * 1000));
    $('pixc-pulso').className = 'pixc-pulso' + (st.falhas ? ' falha' : '');
  }

  // ------------------------------------------------------------------ dados
  var reqId = 0;
  function urlDados() {
    var u = API + (API.indexOf('?') >= 0 ? '&' : '?') + 'modo=' + st.modo;
    if (st.modo === 'finalizados') u += '&de=' + encodeURIComponent(st.periodo.de) + '&ate=' + encodeURIComponent(st.periodo.ate);
    return u;
  }
  function carregar() {
    var meu = ++reqId, modo = st.modo;
    fetch(urlDados(), { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) { window.location.reload(); throw new Error('sessão expirada'); }
        return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error(j.erro || ('HTTP ' + r.status)); return j; });
      })
      .then(function (j) {
        if (meu !== reqId || modo !== st.modo) return;
        if (!Array.isArray(j.atendimentos)) j.atendimentos = [];
        if (!Array.isArray(j.bases)) j.bases = [];
        st.dados = j; st.bases = {};
        j.bases.forEach(function (b) { st.bases[b.codigo] = b; });
        st.agora = data(j.agora) || new Date(); st.carregadoEm = Date.now(); st.falhas = 0;
        render();
      })
      .catch(function (e) {
        if (meu !== reqId) return;
        st.falhas++; if (!st.carregadoEm) st.carregadoEm = Date.now();
        if (window.console) console.warn('[painel-ixc atendimentos]', e);
      })
      .then(renderRelogio);
  }
  function trocarModo(m) {
    if (m === st.modo) return;
    st.modo = m; st.pagina = 1; st.aberto = {}; st.dados = null;
    st.ord = m === 'finalizados' ? { campo: 'ultima_atualizacao', dir: 'desc' } : { campo: 'data_abertura', dir: 'asc' };
    $('pixc-linhas').replaceChildren(); $('pixc-resumo').textContent = 'carregando…'; $('pixc-paginacao').replaceChildren();
    render(); guardar(); carregar();
  }

  // ------------------------------------------------------------------ eventos
  function ligar() {
    $('pixc-busca').value = st.filtro.busca;
    // 0.13.5.15: a busca só é aplicada no botão Buscar (ou Enter) — digitar não filtra mais sozinho
    var buscarAgora = function () { st.filtro.busca = $('pixc-busca').value; st.pagina = 1; render(); };
    $('pixc-buscar').addEventListener('click', buscarAgora);
    $('pixc-busca').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); buscarAgora(); } });
    $('pixc-limpar').addEventListener('click', function () {
      limparFiltros();
      if (window.PixcFiltros && window.PixcFiltros.nenhum) window.PixcFiltros.nenhum('atendimento');   // filtro salvo volta a "— nenhum —"
    });
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
      if (e.target.closest('.pixc-atd-todas')) { st.filtro.bases = []; st.pagina = 1; render(); }
    });
    if ($('pixc-atualizar')) $('pixc-atualizar').addEventListener('click', carregar);   // 0.12.0: só com "Atendimento → Atualizar"
    if (window.PixcCsv) window.PixcCsv.ligarBotao($('pixc-csv'), dadosCsv);
    Array.prototype.forEach.call(document.querySelectorAll('.pixc-atd-modo'), function (b) {
      b.addEventListener('click', function () { trocarModo(b.getAttribute('data-modo')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#pixc-periodo [data-dias]'), function (b) {
      b.addEventListener('click', function () { st.periodo = periodoPadrao(+b.getAttribute('data-dias')); st.pagina = 1; render(); carregar(); });
    });
    $('pixc-aplicar').addEventListener('click', function () {
      var de = $('pixc-de').value, ate = $('pixc-ate').value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return;
      st.periodo = de <= ate ? { de: de, ate: ate } : { de: ate, ate: de }; st.pagina = 1; render(); carregar();
    });
    $('pixc-bases').addEventListener('click', function (e) {
      var card = e.target.closest('.pixc-base'); if (!card) return;
      var fb = st.filtro, cod = card.getAttribute('data-base'), i = fb.bases.indexOf(cod);
      if (e.ctrlKey || e.metaKey) { if (i >= 0) fb.bases.splice(i, 1); else fb.bases.push(cod); }
      else fb.bases = (i >= 0 && fb.bases.length === 1) ? [] : [cod];
      st.pagina = 1; render();
    });
    $('pixc-bases').addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('pixc-base')) { e.preventDefault(); e.target.click(); }
    });
    $('pixc-tabela').querySelector('thead').addEventListener('click', function (e) {
      var th = e.target.closest('th[data-ord]'); if (!th) return;
      var c = th.getAttribute('data-ord');
      st.ord = st.ord.campo === c ? { campo: c, dir: st.ord.dir === 'asc' ? 'desc' : 'asc' } : { campo: c, dir: c === 'qtd_os' || c === 'ultima_atualizacao' ? 'desc' : 'asc' };
      st.pagina = 1; render();
    });
    $('pixc-linhas').addEventListener('click', function (e) {
      var cp = e.target.closest('.pixc-copiar');
      if (cp) { e.preventDefault(); e.stopPropagation(); aoCopiar(cp); return; }
      var rb = e.target.closest('[data-recarregar]');
      if (rb) {
        e.preventDefault();
        var alvo = (st.dados.atendimentos || []).filter(function (x) { return String(x.id) === rb.getAttribute('data-recarregar'); })[0];
        if (alvo) { buscarDetalhe(alvo, true); render(); }
        return;
      }
      var tr = e.target.closest('tr.linha'); if (!tr) return;
      var id = tr.getAttribute('data-id');
      if (st.aberto[id]) delete st.aberto[id]; else st.aberto[id] = true;
      render();
    });
    // 0.13.3: lembra quais O.S. o usuário abriu/fechou (o render de 1 em 1 min redesenha o detalhe)
    $('pixc-linhas').addEventListener('toggle', function (e) {
      var d = e.target; if (!d || !d.getAttribute || !d.getAttribute('data-os')) return;
      st.osAberta[d.getAttribute('data-os')] = d.open;
    }, true);
    $('pixc-linhas').addEventListener('keydown', function (e) {
      var cp = e.target.closest && e.target.closest('.pixc-copiar');
      if (cp && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); aoCopiar(cp); }
    });
    $('pixc-paginacao').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-pag]'); if (!b || b.disabled) return;
      st.pagina = +b.getAttribute('data-pag'); render(); window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) carregar(); });
  }

  restaurar();
  ligar();
  render();
  var pFiltros = (window.PixcFiltros && raiz.getAttribute('data-filtros'))
    ? window.PixcFiltros.montar({ raiz: $('pixc-salvos'), url: raiz.getAttribute('data-filtros'), tela: 'atendimento', direitos: direitos(), obter: obterFiltroSalvo, aplicar: aplicarFiltroSalvo, limpar: limparFiltros })
    : Promise.resolve(null);
  pFiltros.then(function (padrao) {
    if (padrao) { st.filtro = filtroVazio(); padrao = Object.assign({}, padrao); if (st.modo !== 'finalizados') delete padrao.p; lerEstado(padrao); $('pixc-busca').value = st.filtro.busca || ''; guardar(); }
    carregar();
  });
  setInterval(function () { if (!document.hidden) carregar(); }, INTERVALO_MS);
  setInterval(renderRelogio, 1000);
  window.PainelIxcAtendimento = { _st: st, _csv: dadosCsv, _render: render, _trocarModo: trocarModo, _aplicar: aplicarFiltroSalvo, _obter: obterFiltroSalvo };   // exposto só para testes
})();
