/* Painel IXC — Auditoria de Ativação
 * Lista as auditorias abertas e, em cada uma, a O.S. de Ativação de origem com mensagens e anexos.
 * Todo texto vindo do IXC entra via textContent (nunca innerHTML).
 */
(function iniciar() {
  'use strict';

  if (document.readyState !== 'complete') { window.addEventListener('load', iniciar); return; }
  var raiz = document.getElementById('pixc-auditoria');
  if (!raiz) return;

  var API = raiz.getAttribute('data-api');
  var API_ACAO = raiz.getAttribute('data-acao');
  var INTERVALO_MS = 60000;
  var SYNC_MIN = 10;               // o workflow roda a cada 10 min
  var CHAVE_LS = 'pixc_glpi_auditoria';
  var CORES_STATUS = {
    A: '#dc2626', AN: '#9333ea', EN: '#2563eb', AS: '#0891b2', AG: '#059669',
    RAG: '#d97706', DS: '#0d9488', EX: '#16a34a', F: '#64748b', C: '#64748b'
  };

  var st = {
    dados: null, agora: null, carregadoEm: 0, falhas: 0, bases: {},
    filtro: { bases: [], busca: '', semOrigem: false },
    aberto: {}, todasAbertas: false, histAberto: {},
    executando: {},       // id -> ação em andamento
    marcados: {},         // id -> {acao: true} motivos de reprovação marcados (0.8.2)
    retorno: {}           // id -> {ok, mensagem} da última ação feita nesta tela
  };
  var $ = function (id) { return document.getElementById(id); };

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
  function agoraServidor() {
    return st.agora ? new Date(st.agora.getTime() + (Date.now() - st.carregadoEm)) : new Date();
  }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function guardar() {
    try { localStorage.setItem(CHAVE_LS, JSON.stringify({ f: st.filtro })); } catch (e) { /* sem storage */ }
  }
  function restaurar() {
    try {
      var v = JSON.parse(localStorage.getItem(CHAVE_LS) || 'null');
      if (v && v.f) {
        st.filtro.bases = Array.isArray(v.f.bases) ? v.f.bases.map(String) : [];
        st.filtro.busca = typeof v.f.busca === 'string' ? v.f.busca : '';
        st.filtro.semOrigem = false;   // filtro removido da tela (0.7.1.3): ignora o que ficou salvo no navegador
      }
    } catch (e) { /* sem storage */ }
  }
  function nomeOuId(nome, id) { return nome || (id ? '#' + id : ''); }
  function pillStatus(cod) {
    var sp = el('span', 'pixc-st', ((st.dados || {}).status || {})[cod] || cod || '?');
    sp.style.setProperty('--c', CORES_STATUS[cod] || '#64748b');
    return sp;
  }
  function tagBase(cod) {
    var b = st.bases[cod] || {};
    var tag = el('span', 'pixc-tag-base'); tag.style.setProperty('--cor', b.cor || '#64748b');
    tag.appendChild(el('i')); tag.appendChild(document.createTextNode(b.nome || cod));
    return tag;
  }
  /** Link do anexo na web do IXC (exige estar logado no IXC da base). */
  function urlAnexo(a, arq) {
    var base = String(a.ixc_url || (st.bases[a.base] || {}).ixc_url || '').replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s"'<>]+$/i.test(base) || !arq || !/^\d+$/.test(String(arq.id))) return null;
    return base + '/aplicativo/su_oss_chamado/rel_30001.php?id=' + encodeURIComponent(String(arq.id));
  }

  // ------------------------------------------------------------------ regras
  function enriquecer(a, agora) {
    var ab = data(a.data_abertura) || data(a.primeiro_visto);
    a._idade = ab ? agora - ab : null;
    a._semOrigem = !a.origem_ixc_id;
    a._busca = norm([a.ixc_id, a.protocolo, a.cliente, a.condominio, a.tecnico, a.assunto, a.id_ticket,
      a.origem_ixc_id, a.origem_protocolo, a.origem_tecnico, a.mensagem].join(' '));
  }
  function passa(a, f, ignorarBase) {
    if (!ignorarBase && f.bases.length && f.bases.indexOf(a.base) < 0) return false;
    if (f.semOrigem && !a._semOrigem) return false;
    if (f.busca) {
      var termos = norm(f.busca).split(/\s+/).filter(Boolean);
      for (var i = 0; i < termos.length; i++) if (a._busca.indexOf(termos[i]) < 0) return false;
    }
    return true;
  }
  function estadoSync(b, agora) {
    var sync = data(b.ultima_sync), tent = data(b.ultima_tentativa);
    if (!tent) return { cls: '', txt: 'aguardando 1ª coleta do n8n' };
    if (String(b.ultimo_ok) === '0') return { cls: 'erro', txt: 'falhou há ' + fmtDuracao(agora - tent), erro: b.ultimo_erro };
    if (!sync) return { cls: '', txt: 'aguardando 1ª coleta do n8n' };
    var idade = agora - sync;
    if (idade > SYNC_MIN * 3 * 60000) return { cls: 'aviso', txt: 'sem coleta há ' + fmtDuracao(idade) };
    if (b.ultimo_erro) return { cls: 'aviso', txt: 'coletado há ' + fmtDuracao(idade), aviso: b.ultimo_erro };
    return { cls: 'ok', txt: 'coletado há ' + fmtDuracao(idade) };
  }

  // ------------------------------------------------------------------ render
  function renderBases(lista, agora) {
    var cont = $('pixc-bases'), frag = document.createDocumentFragment(), por = {};
    lista.forEach(function (a) {
      var p = por[a.base] || (por[a.base] = { total: 0, semOrigem: 0, anexos: 0 });
      p.total++; if (a._semOrigem) p.semOrigem++; p.anexos += a.qtd_arquivos || 0;
    });
    cont.classList.toggle('filtrando', st.filtro.bases.length > 0);
    (st.dados.bases || []).forEach(function (b) {
      var p = por[b.codigo] || { total: 0, semOrigem: 0, anexos: 0 };
      var sel = st.filtro.bases.indexOf(b.codigo) >= 0;
      var card = el('div', 'pixc-base' + (sel ? ' sel' : ''));
      card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-pressed', sel ? 'true' : 'false');
      card.style.setProperty('--cor', b.cor || '#64748b'); card.setAttribute('data-base', b.codigo);
      card.title = 'Clique para filtrar esta base (Ctrl+clique para somar)';
      var cab = el('div', 'pixc-base-cab'); cab.appendChild(el('span', 'pixc-base-nome', b.nome)); card.appendChild(cab);
      var nunca = !b.ultima_sync;
      var num = el('div', 'pixc-base-num' + (nunca ? ' sem-dado' : ''), nunca ? '—' : p.total);
      num.appendChild(el('small', null, nunca ? 'sem dados ainda' : (p.total === 1 ? 'auditoria aberta' : 'auditorias abertas')));
      card.appendChild(num);
      var k = el('div', 'pixc-kpis');
      var k1 = el('span', 'pixc-kpi' + (p.semOrigem ? ' alerta' : '')); k1.appendChild(el('b', null, p.semOrigem)); k1.appendChild(document.createTextNode(' sem origem'));
      var k2 = el('span', 'pixc-kpi'); k2.appendChild(el('b', null, p.anexos)); k2.appendChild(document.createTextNode(' anexos'));
      k.appendChild(k1); k.appendChild(k2);
      var ag = ((st.dados.aguardando_correcao || {})[b.codigo]) || 0;
      if (ag) { var k3 = el('span', 'pixc-kpi'); k3.title = 'Ativações reabertas pelo painel; quando o técnico finalizar, abre a reauditoria';
        k3.appendChild(el('b', null, ag)); k3.appendChild(document.createTextNode(' aguardando correção')); k.appendChild(k3); }
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
    var semOrigem = 0, anexos = 0;
    lista.forEach(function (a) { if (a._semOrigem) semOrigem++; anexos += a.qtd_arquivos || 0; });
    var r = $('pixc-resumo'), f = document.createDocumentFragment();
    var parte = function (n, txt, alerta) {
      var s = el('span', alerta && n ? 'r-alerta' : null); s.appendChild(el('b', null, n)); s.appendChild(document.createTextNode(' ' + txt)); return s;
    };
    f.appendChild(parte(lista.length, lista.length === 1 ? 'auditoria aberta' : 'auditorias abertas'));
    f.appendChild(document.createTextNode(' · '));
    f.appendChild(parte(semOrigem, 'sem Ativação de origem', true));
    f.appendChild(document.createTextNode(' · '));
    f.appendChild(parte(anexos, anexos === 1 ? 'anexo' : 'anexos'));
    var agT = 0, agM = st.dados.aguardando_correcao || {};
    Object.keys(agM).forEach(function (k) { if (!st.filtro.bases.length || st.filtro.bases.indexOf(k) >= 0) agT += agM[k]; });
    if (agT) { f.appendChild(document.createTextNode(' · ')); f.appendChild(parte(agT, agT === 1 ? 'Ativação aguardando correção' : 'Ativações aguardando correção')); }
    if (lista.length !== total) f.appendChild(document.createTextNode('  (de ' + total + ' no total)'));
    if (st.filtro.bases.length) {
      // aviso clicável: deixa claro que há base filtrada e volta para todas
      var nomes = st.filtro.bases.map(function (c) { return (st.bases[c] || {}).nome || c; }).join(', ');
      var bt = el('button', 'pixc-resumo-btn ativo pixc-aud-todas'); bt.type = 'button';
      bt.title = 'Mostrar todas as bases';
      bt.appendChild(document.createTextNode('Só ' + nomes + ' — ver todas as bases ✕'));
      f.appendChild(document.createTextNode('  ')); f.appendChild(bt);
    }
    r.replaceChildren(f);
  }

  /** Botão só com ícone que copia um texto (protocolo). É <span role=button> porque pode ficar dentro do cabeçalho, que já é <button>. */
  function botaoCopiar(txt, oque) {
    var b = el('span', 'pixc-copiar'); b.setAttribute('role', 'button'); b.tabIndex = 0;
    b.setAttribute('data-copiar', String(txt)); b.title = 'Copiar ' + oque; b.setAttribute('aria-label', 'Copiar ' + oque);
    b.appendChild(el('i', 'ti ti-copy'));
    return b;
  }
  function copiarTexto(txt) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(txt);
    return new Promise(function (ok, erro) {
      var t = document.createElement('textarea'); t.value = txt; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      var feito = false; try { feito = document.execCommand('copy'); } catch (e) { /* sem suporte */ }
      t.remove(); if (feito) ok(); else erro(new Error('cópia bloqueada pelo navegador'));
    });
  }
  function aoCopiar(b) {
    var i = b.querySelector('i'), titulo = b.title;
    copiarTexto(b.getAttribute('data-copiar')).then(function () {
      b.classList.add('copiado'); i.className = 'ti ti-check'; b.title = 'Copiado!';
    }, function () {
      b.classList.add('falhou'); i.className = 'ti ti-x'; b.title = 'Não consegui copiar — selecione o número e use Ctrl+C';
    }).then(function () {
      setTimeout(function () { b.classList.remove('copiado', 'falhou'); i.className = 'ti ti-copy'; b.title = titulo; }, 1500);
    });
  }
  function textoComCopiar(txt, oque) {
    var sp = el('span', 'pixc-com-copiar'); sp.appendChild(document.createTextNode(String(txt))); sp.appendChild(botaoCopiar(txt, oque));
    return sp;
  }
  function campo(g, rot, val) {
    if (val === null || val === undefined || val === '') return;
    var dv = el('div'); dv.appendChild(el('span', null, rot));
    if (val instanceof Node) dv.appendChild(val); else dv.appendChild(document.createTextNode(String(val)));
    g.appendChild(dv);
  }
  function bloco(titulo, conteudo, cls) {
    var s = el('section', 'pixc-aud-bloco' + (cls ? ' ' + cls : ''));
    s.appendChild(el('h4', null, titulo));
    s.appendChild(conteudo);
    return s;
  }
  function texto(t, vazio) { return el('div', 'pixc-detalhe-msg', t || vazio || ''); }

  // ------------------------------------------------------------------ ações (botões)
  // definição dos botões vem do servidor (d.acoes: acao, n, nome, rotulo, reabre, icone) — nomes configuráveis
  function botoes() {
    return (Array.isArray((st.dados || {}).acoes) ? st.dados.acoes : []).map(function (d) {
      return {
        acao: d.acao, n: d.n, nome: d.nome, rotulo: d.rotulo || d.nome, reabre: !!d.reabre, abreOs: !!d.abre_os, ic: d.icone || 'ti-point', descricao: d.descricao || d.efeito || '',
        cls: d.abre_os ? 'btn-teal' : 'btn-success',
        confirma: d.abre_os ? 'Finalizar a Auditoria O.S. {aud} como "' + d.nome + '" (#' + d.n + ') e abrir uma O.S. NOVA (sem atendimento) para o cliente {cli},\n'
          + 'com o técnico e o setor da Ativação O.S. {ativ}, no assunto {assunto}?'
          : !d.reabre ? 'Finalizar a Auditoria O.S. {aud} como "' + d.nome + '" (#' + d.n + ')?'
          : 'Reabrir a Ativação O.S. {ativ} para o técnico com a resposta "#' + d.n + ' ' + d.nome + '" e finalizar a Auditoria O.S. {aud} como reprovada?'
      };
    });
  }
  function csrf() { var m = document.querySelector('meta[property="glpi:csrf_token"]'); return m ? m.getAttribute('content') : ''; }
  /** Por que uma ação não pode ser usada nesta auditoria ('' = pode). */
  function motivoBloqueio(a, b) {
    var ok = (st.bases[a.base] || {}).acoes_ok || {};
    if (st.executando[a.id]) return 'Executando…';
    if (!ok[b.acao]) return b.abreOs
      ? 'Base sem token da API, sem a resposta #' + b.n + ', sem a resposta "#' + b.n + ' O.S." ou sem o assunto da O.S. nova (Configurar > Geral > Painel IXC).'
      : 'Base sem token da API ou sem a resposta padrão #' + b.n + ' (Configurar > Geral > Painel IXC).';
    if (b.reabre && a._semOrigem) return 'Sem O.S. de Ativação finalizada para reabrir.';
    if (b.abreOs && (a._semOrigem || !a.origem_ixc_id)) return 'Sem O.S. de Ativação: não há técnico e setor para a O.S. nova.';
    if (!a.id_tecnico) return 'A Auditoria está sem técnico no IXC (o IXC exige o colaborador para finalizar).';
    return '';
  }
  /** "Ok" é botão (finaliza direto); os motivos de reprovação são caixas de seleção + botão "Reprovar" (vários de uma vez). */
  function barraAcoes(a) {
    var resp = (st.bases[a.base] || {}).respostas || {};
    var marc = st.marcados[a.id] || {};
    var barra = el('div', 'pixc-aud-acoes');
    var motivos = el('div', 'pixc-aud-motivos'), nMarc = 0;
    botoes().forEach(function (b) {
      var motivo = motivoBloqueio(a, b);
      var dica = motivo || ('#' + b.n + ' · ' + b.nome + (b.descricao ? ' — ' + b.descricao : '') + (resp[b.acao] ? ' (resposta padrão ' + resp[b.acao] + ' no IXC)' : ''));
      if (!b.reabre) {
        var bt = el('button', 'btn btn-sm ' + b.cls); bt.type = 'button';
        bt.setAttribute('data-acao', b.acao); bt.setAttribute('data-id', a.id);
        bt.appendChild(el('i', 'ti ' + b.ic + ' me-1')); bt.appendChild(document.createTextNode(b.rotulo));
        bt.disabled = !!motivo; bt.title = dica;
        barra.appendChild(bt);
        return;
      }
      var lb = el('label', 'pixc-aud-motivo' + (motivo ? ' bloqueado' : '')); lb.title = dica;
      var cb = el('input', 'form-check-input'); cb.type = 'checkbox';
      cb.setAttribute('data-motivo', b.acao); cb.setAttribute('data-id', a.id);
      cb.disabled = !!motivo; cb.checked = !motivo && !!marc[b.acao];
      if (cb.checked) { nMarc++; lb.classList.add('marcado'); }
      lb.appendChild(cb); lb.appendChild(el('i', 'ti ' + b.ic)); lb.appendChild(el('span', null, b.rotulo));
      motivos.appendChild(lb);
    });
    if (motivos.children.length) {
      barra.appendChild(motivos);
      var rp = el('button', 'btn btn-sm btn-warning pixc-aud-reprovar'); rp.type = 'button'; rp.setAttribute('data-reprovar', a.id);
      rp.appendChild(el('i', 'ti ti-arrow-back-up me-1')); rp.appendChild(el('span', null, rotuloReprovar(nMarc)));
      rp.disabled = !nMarc || !!st.executando[a.id];
      rp.title = nMarc ? 'Reabre a Ativação para o técnico com os motivos marcados e finaliza a Auditoria como reprovada' : 'Marque um ou mais motivos de reprovação';
      barra.appendChild(rp);
    }
    if (st.executando[a.id]) barra.appendChild(el('span', 'pixc-aud-exec', 'executando no IXC…'));
    return barra;
  }
  function rotuloReprovar(n) { return n > 1 ? 'Reprovar (' + n + ')' : 'Reprovar'; }
  /** Marcar/desmarcar um motivo: atualiza só a barra (sem redesenhar a lista). */
  function aoMarcar(cb) {
    var id = cb.getAttribute('data-id'), acao = cb.getAttribute('data-motivo');
    var m = st.marcados[id] = st.marcados[id] || {};
    if (cb.checked) m[acao] = true; else delete m[acao];
    cb.closest('.pixc-aud-motivo').classList.toggle('marcado', cb.checked);
    var n = Object.keys(m).length, rp = cb.closest('.pixc-aud-acoes').querySelector('.pixc-aud-reprovar');
    if (rp) { rp.disabled = !n; rp.querySelector('span').textContent = rotuloReprovar(n); }
  }
  /** acoes: ['aprovar'] ou motivos de reprovação (um ou vários). */
  function executar(id, acoes) {
    var a = (st.dados.auditorias || []).filter(function (x) { return String(x.id) === String(id); })[0];
    var defs = botoes().filter(function (x) { return acoes.indexOf(x.acao) >= 0; });   // já em ordem #n
    if (!a || !defs.length || st.executando[id]) return;
    if (defs.some(function (b) { return motivoBloqueio(a, b); })) return;
    var txt;
    if (defs.length === 1) txt = defs[0].confirma.replace('{aud}', a.ixc_id).replace('{ativ}', a.origem_ixc_id)
      .replace('{cli}', (a.cliente ? a.cliente + ' ' : '') + '#' + (a.id_cliente || '?')).replace('{assunto}', textoAssunto(a, defs[0]));
    else txt = 'Reabrir a Ativação O.S. ' + a.origem_ixc_id + ' para o técnico com ' + defs.length + ' motivos:\n' +
      defs.map(function (b) { return '  • #' + b.n + ' ' + b.nome; }).join('\n') +
      '\n\n(o 1º vai na reabertura e os demais como mensagens separadas na O.S.)\ne finalizar a Auditoria O.S. ' + a.ixc_id + ' como reprovada?';
    if (!window.confirm(txt + '\n\nA ação é feita direto no IXC e não pode ser desfeita por aqui.')) return;
    var corpoReq = defs[0].reabre ? { id: a.id, acoes: defs.map(function (b) { return b.acao; }) } : { id: a.id, acao: defs[0].acao };
    st.executando[id] = corpoReq.acao || corpoReq.acoes.join('+'); delete st.retorno[id]; render();
    fetch(API_ACAO, { method: 'POST', credentials: 'same-origin', body: JSON.stringify(corpoReq),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-Glpi-Csrf-Token': csrf() } })
      .then(function (r) { return r.json().catch(function () { return { ok: false, mensagem: 'HTTP ' + r.status }; }); })
      .then(function (j) { st.retorno[id] = { ok: !!j.ok, mensagem: j.mensagem || (j.ok ? 'Feito.' : 'Falhou.') }; if (j.ok) delete st.marcados[id]; })
      .catch(function (e) { st.retorno[id] = { ok: false, mensagem: 'Sem resposta do servidor: ' + e.message }; })
      .then(function () { delete st.executando[id]; render(); carregar(); });
  }
  /** Assunto da O.S. nova configurado na base da auditoria: "Nome (#id)" ou "#id". */
  function textoAssunto(a, b) {
    var o = ((st.bases[a.base] || {}).os_assunto || {})[b.acao];
    if (!o) return '?';
    return o.nome ? o.nome + ' (#' + o.id + ')' : '#' + o.id;
  }
  /** 'readequar' → nome; 'multi:3+5' → "nome #3 + nome #5". */
  function nomeAcao(cod) {
    var bs = botoes(), m = /^multi:([\d+]+)$/.exec(cod || '');
    if (m) return m[1].split('+').map(function (n) { var b = bs.filter(function (x) { return String(x.n) === n; })[0]; return b ? b.rotulo : '#' + n; }).join(' + ');
    var b = bs.filter(function (x) { return x.acao === cod; })[0];
    return b ? b.rotulo : (cod || '?');
  }
  function avisoAcao(a) {
    var r = st.retorno[a.id], u = a.ultima_acao;
    if (r) return el('div', 'pixc-aud-retorno ' + (r.ok ? 'ok' : 'erro'), r.mensagem);
    if (u && !u.ok) return el('div', 'pixc-aud-retorno erro', 'Última tentativa falhou (' + nomeAcao(u.acao) + ', ' + u.usuario + ' em ' + fmtData(u.quando) + '): ' + (u.detalhe || ''));
    return null;
  }

  function corpo(a, agora) {
    var det = a.detalhe || {};
    var msgs = Array.isArray(det.msgs_os) ? det.msgs_os : [];
    var arqs = Array.isArray(det.arquivos) ? det.arquivos : [];
    var hist = Array.isArray(det.msgs_ticket) ? det.msgs_ticket : [];
    var c = el('div', 'pixc-aud-corpo');
    if (st.dados.pode_agir) c.appendChild(barraAcoes(a));
    var av = avisoAcao(a); if (av) c.appendChild(av);

    if (a._semOrigem) {
      c.appendChild(el('div', 'pixc-base-erro aviso', 'Nenhuma O.S. de Ativação Link Normal finalizada para este cliente' +
        (a.id_cliente ? ' (#' + a.id_cliente + ')' : '') + '. Confira no IXC se a Ativação foi feita e finalizada, ou se o assunto ' +
        'dela está no Config do workflow "Painel IXC - Auditoria".'));
    } else {
      var col = el('div', 'pixc-aud-colunas');
      var esq = el('div');
      var g = el('div', 'pixc-detalhe-grade');
      campo(g, 'O.S. de Ativação', a.origem_ixc_id);
      campo(g, 'Protocolo', a.origem_protocolo ? textoComCopiar(a.origem_protocolo, 'protocolo da Ativação') : null);
      campo(g, 'Atendimento da Ativação', det.origem_ticket ? '#' + det.origem_ticket + (String(det.origem_ticket) !== String(a.id_ticket) ? ' (outro atendimento)' : '') : null);
      campo(g, 'Status', a.origem_status ? pillStatus(a.origem_status) : null);
      campo(g, 'Assunto', nomeOuId(a.origem_assunto, a.origem_id_assunto));
      campo(g, 'Técnico que executou', nomeOuId(a.origem_tecnico, a.origem_id_tecnico));
      campo(g, 'Abertura', fmtData(a.origem_data_abertura));
      campo(g, 'Fechamento', fmtData(a.origem_data_fechamento));
      var pl = det.plano;
      if (pl && pl.nome) {
        var pv = el('span', 'pixc-aud-plano', pl.nome);
        var dica = [];
        if (pl.login) dica.push('Login ' + pl.login);
        if (pl.contrato_id) dica.push('Contrato #' + pl.contrato_id + (pl.contrato ? ' (' + pl.contrato + ')' : ''));
        if (dica.length) pv.title = dica.join(' · ');
        if (pl.status && pl.status !== 'A') pv.appendChild(el('small', 'pixc-aud-plano-st', ' (contrato ' + ({ I: 'inativo', P: 'pré-contrato', N: 'negativado', D: 'desistiu', C: 'cancelado' }[pl.status] || pl.status) + ')'));
        campo(g, pl.varios > 1 ? 'Planos (' + pl.varios + ' logins)' : 'Plano contratado', pv);
      }
      esq.appendChild(bloco('Ativação de origem', g));
      if (a.origem_mensagem) esq.appendChild(bloco('Mensagem de abertura da Ativação', texto(a.origem_mensagem)));
      if (a.origem_mensagem_resposta) esq.appendChild(bloco('Resposta do técnico', texto(a.origem_mensagem_resposta)));

      var ul = el('ul', 'pixc-aud-anexos');
      if (!arqs.length) ul.appendChild(el('li', 'pixc-aud-vazio', 'Nenhum anexo na O.S. de Ativação.'));
      arqs.forEach(function (f) {
        var li = el('li'), url = urlAnexo(a, f);
        var nome = f.descricao || f.nome || ('anexo #' + f.id);
        var ic = el('i', 'ti ti-paperclip');
        if (url) {
          var lk = el('a', null, nome); lk.href = url; lk.target = '_blank'; lk.rel = 'noopener noreferrer';
          lk.title = 'Abrir no IXC (é preciso estar logado no IXC da base)';
          li.appendChild(ic); li.appendChild(lk);
        } else { li.appendChild(ic); li.appendChild(el('span', null, nome)); }
        var meta = [f.descricao && f.nome ? f.nome : '', fmtData(f.data)].filter(Boolean).join(' · ');
        if (meta) li.appendChild(el('small', null, meta));
        ul.appendChild(li);
      });
      esq.appendChild(bloco('Anexos da Ativação (' + arqs.length + ')', ul));

      var dir = el('div');
      var tl = el('ol', 'pixc-aud-msgs');
      if (!msgs.length) tl.appendChild(el('li', 'pixc-aud-vazio', 'Sem mensagens na O.S. de Ativação.'));
      msgs.forEach(function (m) {
        var li = el('li');
        var cab = el('div', 'pixc-aud-msg-cab');
        cab.appendChild(el('b', null, fmtData(m.data)));
        if (m.status) cab.appendChild(pillStatus(m.status));
        li.appendChild(cab);
        if (m.mensagem) li.appendChild(el('div', 'pixc-aud-msg-txt', m.mensagem));
        if (m.historico) li.appendChild(el('small', null, m.historico));
        tl.appendChild(li);
      });
      dir.appendChild(bloco('Mensagens da Ativação (' + msgs.length + ')', tl));

      col.appendChild(esq); col.appendChild(dir);
      c.appendChild(col);
    }

    if (a.mensagem) c.appendChild(bloco('Mensagem da Auditoria (O.S. ' + a.ixc_id + ')', texto(a.mensagem)));

    if (hist.length) {
      var dt = el('details', 'pixc-aud-hist');
      dt.setAttribute('data-id', a.id);
      if (st.histAberto[a.id]) dt.open = true;
      dt.appendChild(el('summary', null, 'Histórico do atendimento #' + (a.id_ticket || '?') + ' (' + hist.length + ' mensagens)'));
      var ol = el('ol', 'pixc-aud-msgs');
      hist.forEach(function (m) {
        var li = el('li');
        li.appendChild(el('div', 'pixc-aud-msg-cab')).appendChild(el('b', null, fmtData(m.data)));
        li.appendChild(el('div', 'pixc-aud-msg-txt', m.mensagem));
        ol.appendChild(li);
      });
      dt.appendChild(ol);
      c.appendChild(dt);
    }
    return c;
  }

  function cartao(a, agora) {
    var aberto = st.todasAbertas || !!st.aberto[a.id];
    var card = el('article', 'pixc-aud-card' + (a._semOrigem ? ' sem-origem' : '') + (aberto ? ' aberto' : ''));
    card.style.setProperty('--cor', (st.bases[a.base] || {}).cor || '#64748b');
    var cab = el('button', 'pixc-aud-cab'); cab.type = 'button'; cab.setAttribute('data-id', a.id);
    cab.setAttribute('aria-expanded', aberto ? 'true' : 'false');

    var l1 = el('div', 'pixc-aud-l1');
    l1.appendChild(tagBase(a.base));
    l1.appendChild(el('span', 'pixc-aud-os', 'O.S. ' + a.ixc_id));
    l1.appendChild(pillStatus(a.status));
    if (a.rodada) { var sr = el('span', 'pixc-aud-reaud', 'Reauditoria (' + a.rodada + 'ª)'); sr.title = 'Aberta pelo painel depois que a Ativação reprovada foi finalizada de novo'; l1.appendChild(sr); }
    l1.appendChild(el('span', 'pixc-aud-cliente', nomeOuId(a.cliente, a.id_cliente) || 'cliente não identificado'));
    if (a.condominio || a.id_condominio) l1.appendChild(el('span', 'pixc-aud-cond', nomeOuId(a.condominio, a.id_condominio)));
    cab.appendChild(l1);

    var l2 = el('div', 'pixc-aud-l2');
    var partes = [
      'Auditor: ' + (a.id_tecnico ? nomeOuId(a.tecnico, a.id_tecnico) : 'sem técnico'),
      'aberta há ' + fmtDuracao(a._idade),
      a.id_ticket ? 'atendimento #' + a.id_ticket : 'sem atendimento',
    ].filter(Boolean);
    l2.appendChild(document.createTextNode(partes.join(' · ')));
    if (a.protocolo) { l2.appendChild(document.createTextNode(' · protocolo ' + a.protocolo)); l2.appendChild(botaoCopiar(a.protocolo, 'protocolo da Auditoria')); }
    cab.appendChild(l2);

    var orig = el('div', 'pixc-aud-origem');
    if (a._semOrigem) orig.appendChild(el('span', 'pixc-aud-alerta', 'Sem Ativação finalizada'));
    else {
      orig.appendChild(el('span', null, 'Ativação O.S. ' + a.origem_ixc_id + (a.origem_data_fechamento ? ' · fechada em ' + fmtData(a.origem_data_fechamento) : '')));
      var chips = el('span', 'pixc-aud-chips');
      var c1 = el('span', 'pixc-kpi'); c1.appendChild(el('b', null, a.qtd_arquivos || 0)); c1.appendChild(document.createTextNode(' anexos'));
      var c2 = el('span', 'pixc-kpi'); c2.appendChild(el('b', null, a.qtd_msgs || 0)); c2.appendChild(document.createTextNode(' mensagens'));
      chips.appendChild(c1); chips.appendChild(c2); orig.appendChild(chips);
    }
    orig.appendChild(el('i', 'ti ti-chevron-down pixc-aud-seta'));
    cab.appendChild(orig);

    card.appendChild(cab);
    if (aberto) card.appendChild(corpo(a, agora));
    return card;
  }

  /** Quadro por auditor (0.9.0): recebidas na cota, abertas agora, mais antiga aberta, concluídas em 7 dias. */
  function renderQuadro(q) {
    var sec = $('pixc-quadro');
    if (!sec) return;
    if (!q || !Array.isArray(q.auditores) || !q.auditores.length) { sec.hidden = true; sec.replaceChildren(); return; }
    sec.hidden = false;
    var frag = document.createDocumentFragment();
    var cab = el('div', 'pixc-quadro-cab');
    cab.appendChild(el('b', null, 'Auditores'));
    var modo = !q.ativo ? 'distribuição desligada' : (q.simulacao ? 'distribuição em SIMULAÇÃO (não mexe no IXC)' : 'distribuição ligada');
    cab.appendChild(el('span', 'pixc-quadro-modo' + (q.ativo ? (q.simulacao ? ' sim' : ' on') : ''), modo));
    if (q.ativo && q.pendentes) cab.appendChild(el('span', 'pixc-quadro-pend', q.pendentes + ' aguardando distribuição'));
    frag.appendChild(cab);
    var desde = q.inicio ? fmtData(q.inicio).slice(0, 5) : '';
    var t = el('table', 'pixc-quadro-tab'), th = el('thead'), tr = el('tr');
    ['Auditor', 'Recebidas' + (desde ? ' desde ' + desde : ''), 'Abertas agora', 'Mais antiga aberta', 'Concluídas (7 dias)'].forEach(function (h, i) { tr.appendChild(el('th', i ? 'num' : null, h)); });
    th.appendChild(tr); t.appendChild(th);
    var tb = el('tbody');
    q.auditores.forEach(function (x) {
      var l = el('tr');
      var nome = el('td'); nome.appendChild(document.createTextNode(x.nome));
      if (x.padrao) { var p = el('small', 'pixc-quadro-padrao', ' padrão do processo'); nome.appendChild(p); }
      l.appendChild(nome);
      l.appendChild(el('td', 'num', x.recebidas));
      l.appendChild(el('td', 'num', x.abertas));
      var ma = el('td', 'num', x.mais_antiga_dias == null ? '—' : (x.mais_antiga_dias === 0 ? 'hoje' : x.mais_antiga_dias + (x.mais_antiga_dias === 1 ? ' dia' : ' dias')));
      if (x.mais_antiga) ma.title = 'aberta em ' + fmtData(x.mais_antiga);
      l.appendChild(ma);
      l.appendChild(el('td', 'num', x.concluidas_7d));
      tb.appendChild(l);
    });
    t.appendChild(tb); frag.appendChild(t);
    if (Array.isArray(q.ultimas) && q.ultimas.length) {
      var det = el('details', 'pixc-quadro-ult'); det.open = !!st.quadroAberto;
      det.appendChild(el('summary', null, q.simulacao ? 'Simulação — para quem iria (última rodada de cada base)' : 'Últimas distribuições'));
      var ul = el('ul');
      q.ultimas.forEach(function (u) {
        var li = el('li', u.ok ? null : 'erro', (u.base || '').toUpperCase() + ' · O.S. ' + u.os + ' → ' + u.nome + ' · ' + fmtData(u.quando) + (u.ok ? '' : ' · FALHOU'));
        if (u.detalhe) li.title = u.detalhe;
        ul.appendChild(li);
      });
      det.appendChild(ul);
      det.addEventListener('toggle', function () { st.quadroAberto = det.open; });
      frag.appendChild(det);
    }
    sec.replaceChildren(frag);
  }

  function render() {
    if (!st.dados) return;
    var agora = agoraServidor();
    var todos = Array.isArray(st.dados.auditorias) ? st.dados.auditorias : [];
    todos.forEach(function (a) { enriquecer(a, agora); });
    var semBase = todos.filter(function (a) { return passa(a, st.filtro, true); });
    var lista = semBase.filter(function (a) { return passa(a, st.filtro, false); })
      .sort(function (x, y) { return (y._idade || 0) - (x._idade || 0); });   // mais antigas primeiro
    st.lista = lista;   // 0.12.0: base do CSV
    renderBases(semBase, agora);
    renderResumo(lista, todos.length);
    renderQuadro(st.dados.distribuicao);
    var cont = $('pixc-lista'), frag = document.createDocumentFragment();
    if (!lista.length) {
      frag.appendChild(el('div', 'pixc-vazio pixc-aud-vazio-lista', todos.length ? 'Nenhuma auditoria com esses filtros.'
        : 'Nenhuma auditoria aberta recebida ainda (o workflow "Painel IXC - Auditoria" roda a cada ' + SYNC_MIN + ' min).'));
    }
    Object.keys(st.retorno).forEach(function (id) {
      if (st.retorno[id].ok && !todos.some(function (a) { return String(a.id) === String(id); })) {
        frag.appendChild(el('div', 'pixc-aud-retorno ok', st.retorno[id].mensagem));
      }
    });
    lista.forEach(function (a) { frag.appendChild(cartao(a, agora)); });
    cont.replaceChildren(frag);
    $('pixc-expandir').textContent = st.todasAbertas ? 'Recolher todas' : 'Expandir todas';
    guardar();
  }

  // ------------------------------------------------------------------ CSV (0.12.0)
  function dadosCsv() {
    if (!st.dados || !Array.isArray(st.lista)) return null;
    var D = window.PixcCsv.data, nomes = st.dados.status || {};
    var colunas = ['Base', 'O.S. Auditoria', 'Protocolo', 'Status', 'Reauditoria', 'Cliente', 'Condomínio', 'Auditor', 'Abertura', 'Aberta há',
      'Atendimento', 'O.S. Ativação', 'Protocolo Ativação', 'Status Ativação', 'Técnico da Ativação', 'Fechamento Ativação', 'Plano', 'Anexos', 'Mensagens', 'Última ação'];
    var linhas = st.lista.map(function (a) {
      var pl = (a.detalhe || {}).plano || {}, u = a.ultima_acao;
      return [
        (st.bases[a.base] || {}).nome || a.base, a.ixc_id, a.protocolo, nomes[a.status] || a.status, a.rodada ? a.rodada + 'ª' : '',
        nomeOuId(a.cliente, a.id_cliente), nomeOuId(a.condominio, a.id_condominio), a.id_tecnico ? nomeOuId(a.tecnico, a.id_tecnico) : 'sem técnico',
        D(a.data_abertura), fmtDuracao(a._idade), a.id_ticket,
        a._semOrigem ? 'sem Ativação finalizada' : a.origem_ixc_id, a.origem_protocolo, a.origem_status ? (nomes[a.origem_status] || a.origem_status) : '',
        nomeOuId(a.origem_tecnico, a.origem_id_tecnico), D(a.origem_data_fechamento), pl.nome || '', a.qtd_arquivos || 0, a.qtd_msgs || 0,
        u ? nomeAcao(u.acao) + (u.ok ? '' : ' (falhou)') + ' · ' + (u.usuario || '') + ' · ' + D(u.quando) : ''
      ];
    });
    return { prefixo: 'auditorias-abertas', colunas: colunas, linhas: linhas };
  }
  function renderRelogio() {
    if (!st.carregadoEm) return;
    var seg = Math.round((Date.now() - st.carregadoEm) / 1000);
    $('pixc-atualizado').textContent = st.falhas ? 'sem conexão com o painel — tentando de novo' : 'atualizado há ' + (seg < 60 ? seg + 's' : fmtDuracao(seg * 1000));
    $('pixc-pulso').className = 'pixc-pulso' + (st.falhas ? ' falha' : '');
  }

  // ------------------------------------------------------------------ dados
  var reqId = 0;
  function carregar() {
    var meu = ++reqId;
    fetch(API, { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) { window.location.reload(); throw new Error('sessão expirada'); }
        return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error(j.erro || ('HTTP ' + r.status)); return j; });
      })
      .then(function (j) {
        if (meu !== reqId) return;
        if (!Array.isArray(j.auditorias)) j.auditorias = [];
        if (!Array.isArray(j.bases)) j.bases = [];
        st.dados = j; st.bases = {};
        j.bases.forEach(function (b) { st.bases[b.codigo] = b; });
        st.agora = data(j.agora) || new Date(); st.carregadoEm = Date.now(); st.falhas = 0;
        render();
      })
      .catch(function (e) {
        if (meu !== reqId) return;
        st.falhas++; if (!st.carregadoEm) st.carregadoEm = Date.now();
        if (window.console) console.warn('[painel-ixc auditoria]', e);
      })
      .then(renderRelogio);
  }

  // ------------------------------------------------------------------ eventos
  function ligar() {
    $('pixc-busca').value = st.filtro.busca;
    // 0.13.5.15: a busca só é aplicada no botão Buscar (ou Enter) — digitar não filtra mais sozinho
    var buscarAgora = function () { st.filtro.busca = $('pixc-busca').value; render(); };
    $('pixc-buscar').addEventListener('click', buscarAgora);
    $('pixc-busca').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); buscarAgora(); } });
    var limpar = function () {
      st.filtro = { bases: [], busca: '', semOrigem: false };
      $('pixc-busca').value = ''; render();
    };
    $('pixc-limpar').addEventListener('click', limpar);
    $('pixc-resumo').addEventListener('click', function (e) {
      if (e.target.closest('.pixc-aud-todas')) { st.filtro.bases = []; render(); }
    });
    $('pixc-expandir').addEventListener('click', function () { st.todasAbertas = !st.todasAbertas; if (!st.todasAbertas) st.aberto = {}; render(); });
    if ($('pixc-atualizar')) $('pixc-atualizar').addEventListener('click', carregar);   // 0.12.0: só com "Auditoria → Atualizar"
    if (window.PixcCsv) window.PixcCsv.ligarBotao($('pixc-csv'), dadosCsv);
    $('pixc-bases').addEventListener('click', function (e) {
      var card = e.target.closest('.pixc-base'); if (!card) return;
      var fb = st.filtro, cod = card.getAttribute('data-base'), i = fb.bases.indexOf(cod);
      if (e.ctrlKey || e.metaKey) { if (i >= 0) fb.bases.splice(i, 1); else fb.bases.push(cod); }
      else fb.bases = (i >= 0 && fb.bases.length === 1) ? [] : [cod];
      render();
    });
    $('pixc-bases').addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('pixc-base')) { e.preventDefault(); e.target.click(); }
    });
    $('pixc-lista').addEventListener('click', function (e) {
      var cp = e.target.closest('.pixc-copiar');
      if (cp) { e.preventDefault(); e.stopPropagation(); aoCopiar(cp); return; }   // não abre/fecha o cartão
      var ac = e.target.closest('button[data-acao]');
      if (ac) { if (!ac.disabled) executar(ac.getAttribute('data-id'), ac.getAttribute('data-acao')); return; }
      var rp = e.target.closest('button[data-reprovar]');
      if (rp) { if (!rp.disabled) { var id = rp.getAttribute('data-reprovar'); executar(id, Object.keys(st.marcados[id] || {})); } return; }
      if (e.target.closest('.pixc-aud-motivo')) return;   // a caixa de seleção trata no "change"
      var b = e.target.closest('button.pixc-aud-cab'); if (!b) return;
      var id = b.getAttribute('data-id');
      if (st.todasAbertas) { st.todasAbertas = false; st.aberto = {}; (st.dados.auditorias || []).forEach(function (a) { st.aberto[a.id] = true; }); }
      if (st.aberto[id]) delete st.aberto[id]; else st.aberto[id] = true;
      render();
    });
    $('pixc-lista').addEventListener('change', function (e) {
      if (e.target.matches && e.target.matches('input[data-motivo]')) aoMarcar(e.target);
    });
    $('pixc-lista').addEventListener('keydown', function (e) {
      var cp = e.target.closest && e.target.closest('.pixc-copiar');
      if (cp && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); aoCopiar(cp); }
    });
    // o "Histórico do atendimento" continua aberto depois da atualização automática
    $('pixc-lista').addEventListener('toggle', function (e) {
      var d = e.target; if (!d || !d.classList || !d.classList.contains('pixc-aud-hist')) return;
      var id = d.getAttribute('data-id'); if (d.open) st.histAberto[id] = true; else delete st.histAberto[id];
    }, true);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) carregar(); });
  }

  restaurar();
  ligar();
  carregar();
  setInterval(function () { if (!document.hidden) carregar(); }, INTERVALO_MS);
  setInterval(renderRelogio, 1000);

  window.PainelIxcAuditoria = { _st: st, _csv: dadosCsv, _render: render, _urlAnexo: urlAnexo };   // exposto só para testes
})();
