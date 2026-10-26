/* Painel IXC — filtros salvos (barra compartilhada pelo painel e pelo relatório).
 *
 * PixcFiltros.montar({ raiz, url, tela, obter, aplicar }) -> Promise<filtroPadrao|null>
 *   raiz    elemento onde a barra é desenhada
 *   url     front/filtros.php
 *   tela    'painel' | 'relatorio'
 *   obter() devolve o objeto de filtro atual da tela (JSON opaco para o servidor)
 *   aplicar(filtro) aplica um objeto salvo na tela
 *   limpar()        (opcional) mesma rotina do botão "Limpar" da tela — chamada ao escolher "— nenhum —"
 *   direitos        (opcional, 0.12.0) {ler, atualizar, criar, deletar} da categoria da tela; ausente = tudo liberado.
 *                   0.13.2: Criar = salvar (novo ou sobrescrevendo um meu) e marcar padrão · Deletar = excluir.
 * PixcFiltros.nenhum(tela) volta a lista para "— nenhum —" sem aplicar nada (o botão "Limpar" da tela chama).
 * A promise resolve com o filtro marcado como padrão (a tela decide aplicar antes da primeira carga).
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined && txt !== null) e.textContent = String(txt); return e; }
  function csrf() { var m = document.querySelector('meta[property="glpi:csrf_token"]'); return m ? m.getAttribute('content') : ''; }

  function montar(o) {
    var raiz = o.raiz, tela = o.tela, url = o.url;
    if (!raiz) return Promise.resolve(null);
    var st = { lista: [], atual: 0, ocupado: false };
    var dir = o.direitos && typeof o.direitos === 'object' ? o.direitos : { ler: true, atualizar: true, criar: true, deletar: true };
    var seq = 0;
    registro[tela] = function () { if (st.atual !== 0) { st.atual = 0; render(); } };

    // ---------------------------------------------------------------- barra
    raiz.replaceChildren();
    var rotulo = el('span', 'pixc-salvos-rotulo'); rotulo.appendChild(el('i', 'ti ti-star me-1')); rotulo.appendChild(document.createTextNode('Filtros salvos'));
    var sel = el('select', 'form-select form-select-sm pixc-salvos-sel'); sel.id = 'pixc-salvos-sel-' + tela; sel.setAttribute('aria-label', 'Filtro salvo');
    var bSalvar = botao('btn-outline-primary', 'ti-device-floppy', 'Salvar…', 'Salvar os filtros atuais'); bSalvar.setAttribute('data-acao', 'salvar');
    var bPadrao = botao('btn-outline-secondary', 'ti-star', 'Padrão', 'Aplicar este filtro ao abrir a tela'); bPadrao.setAttribute('data-acao', 'padrao');
    var bExcluir = botao('btn-outline-danger', 'ti-trash', '', 'Excluir o filtro selecionado'); bExcluir.setAttribute('data-acao', 'excluir');
    var aviso = el('span', 'pixc-salvos-aviso');
    raiz.appendChild(rotulo); raiz.appendChild(sel); raiz.appendChild(bSalvar); raiz.appendChild(bPadrao); raiz.appendChild(bExcluir); raiz.appendChild(aviso);
    bSalvar.hidden = !dir.criar;   // o que o perfil não pode fazer nem aparece
    bPadrao.hidden = !dir.criar;
    bExcluir.hidden = !dir.deletar;

    function botao(cls, icone, txt, title) {
      var b = el('button', 'btn btn-sm ' + cls); b.type = 'button'; b.title = title;
      b.appendChild(el('i', 'ti ' + icone + (txt ? ' me-1' : ''))); if (txt) b.appendChild(document.createTextNode(txt));
      return b;
    }
    function porId(id) { for (var i = 0; i < st.lista.length; i++) if (st.lista[i].id === id) return st.lista[i]; return null; }
    function avisar(msg, erro) { aviso.textContent = msg || ''; aviso.className = 'pixc-salvos-aviso' + (erro ? ' erro' : ''); if (msg) setTimeout(function () { if (aviso.textContent === msg) aviso.textContent = ''; }, 4000); }

    function render() {
      var frag = document.createDocumentFragment();
      frag.appendChild(new Option('— nenhum —', '0'));
      var meus = st.lista.filter(function (f) { return f.meu; }), outros = st.lista.filter(function (f) { return !f.meu; });
      if (meus.length) { var g1 = el('optgroup'); g1.label = 'Meus'; meus.forEach(function (f) { g1.appendChild(new Option((f.padrao ? '★ ' : '') + f.nome + (f.publico ? ' (compartilhado)' : ''), String(f.id))); }); frag.appendChild(g1); }
      if (outros.length) { var g2 = el('optgroup'); g2.label = 'Compartilhados'; outros.forEach(function (f) { g2.appendChild(new Option(f.nome + (f.dono ? ' — ' + f.dono : ''), String(f.id))); }); frag.appendChild(g2); }
      sel.replaceChildren(frag);
      if (!porId(st.atual)) st.atual = 0;
      sel.value = String(st.atual);
      var f = porId(st.atual);
      bPadrao.disabled = !f || !f.meu || !dir.criar; bExcluir.disabled = !f || !f.pode_apagar || !dir.deletar;
      bPadrao.classList.toggle('active', !!(f && f.padrao));
      bPadrao.querySelector('i').className = 'ti me-1 ' + (f && f.padrao ? 'ti-star-filled' : 'ti-star');
      bSalvar.title = f && f.meu ? 'Atualizar "' + f.nome + '" com os filtros atuais (ou salvar como novo)' : 'Salvar os filtros atuais';
    }

    // ---------------------------------------------------------------- servidor
    function chamar(corpo) {
      st.ocupado = true; raiz.classList.add('ocupado');
      var opts = corpo
        ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-Glpi-Csrf-Token': csrf() }, body: JSON.stringify(Object.assign({ tela: tela }, corpo)) }
        : { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' };
      return fetch(url + (corpo ? '' : '?tela=' + encodeURIComponent(tela)), opts)
        .then(function (r) { return r.json().then(function (j) { j._http = r.status; return j; }); })
        .then(function (j) {
          if (Array.isArray(j.lista)) st.lista = j.lista;
          if (!j.ok) throw new Error(j.erro || (j._http === 403 ? 'Sessão expirada ou ação não permitida. Recarregue a página.' : 'HTTP ' + j._http));
          return j;
        })
        .finally(function () { st.ocupado = false; raiz.classList.remove('ocupado'); render(); });
    }

    // ---------------------------------------------------------------- modal de salvar
    function pedirDados(f) {
      // f = filtro selecionado meu (para atualizar) ou null
      return new Promise(function (resolve) {
        var temModal = window.bootstrap && window.bootstrap.Modal;
        if (!temModal) {
          var nome = window.prompt('Nome do filtro:', f ? f.nome : '');
          if (!nome) return resolve(null);
          return resolve({ id: f && f.nome === nome ? f.id : 0, nome: nome, publico: f ? f.publico : false, padrao: f ? f.padrao : false });
        }
        var id = 'pixc-salvos-modal-' + tela;
        var old = $(id); if (old) old.remove();
        var m = el('div', 'modal fade'); m.id = id; m.tabIndex = -1;
        m.innerHTML =
          '<div class="modal-dialog modal-sm modal-dialog-centered"><div class="modal-content">' +
          '<div class="modal-header"><h5 class="modal-title">Salvar filtro</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button></div>' +
          '<div class="modal-body">' +
          '<label class="form-label">Nome</label><input type="text" class="form-control" maxlength="80" data-campo="nome">' +
          (f ? '<div class="form-hint mt-1">Mesmo nome = atualiza "' + escapar(f.nome) + '". Outro nome = salva como novo.</div>' : '') +
          '<label class="form-check mt-3"><input type="checkbox" class="form-check-input" data-campo="publico"><span class="form-check-label">Visível para todos os usuários do painel</span></label>' +
          '<label class="form-check mt-1"><input type="checkbox" class="form-check-input" data-campo="padrao"><span class="form-check-label">Aplicar ao abrir esta tela (meu padrão)</span></label>' +
          '</div>' +
          '<div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button><button type="button" class="btn btn-primary" data-acao="ok"><i class="ti ti-device-floppy me-1"></i> Salvar</button></div>' +
          '</div></div>';
        document.body.appendChild(m);
        var iNome = m.querySelector('[data-campo=nome]'), iPub = m.querySelector('[data-campo=publico]'), iPad = m.querySelector('[data-campo=padrao]');
        iNome.value = f ? f.nome : ''; iPub.checked = !!(f && f.publico); iPad.checked = !!(f && f.padrao);
        var modal = new window.bootstrap.Modal(m); var resultado = null;
        var ok = function () {
          var nome = iNome.value.trim(); if (!nome) { iNome.classList.add('is-invalid'); iNome.focus(); return; }
          resultado = { id: f && f.nome === nome ? f.id : 0, nome: nome, publico: iPub.checked, padrao: iPad.checked };
          modal.hide();
        };
        m.querySelector('[data-acao=ok]').addEventListener('click', ok);
        iNome.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
        m.addEventListener('shown.bs.modal', function () { iNome.focus(); iNome.select(); });
        m.addEventListener('hidden.bs.modal', function () { m.remove(); resolve(resultado); });
        modal.show();
      });
    }
    function escapar(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    // ---------------------------------------------------------------- eventos
    sel.addEventListener('change', function () {
      st.atual = +sel.value || 0; render();
      var f = porId(st.atual);
      if (f) { try { o.aplicar(f.filtro); avisar('Filtro "' + f.nome + '" aplicado.'); } catch (e) { avisar('Não foi possível aplicar: ' + e.message, true); } }
      else if (typeof o.limpar === 'function') { try { o.limpar(); avisar('Filtros limpos.'); } catch (e) { avisar('Não foi possível limpar: ' + e.message, true); } }
    });
    bSalvar.addEventListener('click', function () {
      if (st.ocupado) return;
      var f = porId(st.atual);
      if (!dir.criar) return;
      pedirDados(f && f.meu ? f : null).then(function (d) {
        if (!d) return;
        var filtro; try { filtro = o.obter(); } catch (e) { avisar('Não consegui ler os filtros atuais.', true); return; }
        return chamar({ acao: 'salvar', id: d.id, nome: d.nome, filtro: filtro, publico: d.publico ? 1 : 0, padrao: d.padrao ? 1 : 0 })
          .then(function (j) { st.atual = j.id || 0; render(); avisar('Filtro "' + d.nome + '" salvo.'); })
          .catch(function (e) { avisar(e.message, true); });
      });
    });
    bPadrao.addEventListener('click', function () {
      var f = porId(st.atual); if (!f || !f.meu || st.ocupado || !dir.criar) return;
      chamar({ acao: 'padrao', id: f.id, ligar: f.padrao ? 0 : 1 })
        .then(function () { avisar(f.padrao ? 'Deixou de ser o padrão.' : '"' + f.nome + '" agora abre por padrão.'); })
        .catch(function (e) { avisar(e.message, true); });
    });
    bExcluir.addEventListener('click', function () {
      var f = porId(st.atual); if (!f || !f.pode_apagar || st.ocupado || !dir.deletar) return;
      if (!window.confirm('Excluir o filtro "' + f.nome + '"' + (f.publico ? ' (compartilhado com todos)' : '') + '?')) return;
      chamar({ acao: 'excluir', id: f.id }).then(function () { st.atual = 0; render(); avisar('Filtro excluído.'); }).catch(function (e) { avisar(e.message, true); });
    });

    // ---------------------------------------------------------------- carga inicial
    render();
    return chamar(null).then(function () {
      var padrao = null;
      st.lista.forEach(function (f) { if (f.padrao) padrao = f; });
      if (padrao) { st.atual = padrao.id; render(); return padrao.filtro; }
      return null;
    }).catch(function (e) { avisar('Filtros salvos indisponíveis: ' + e.message, true); return null; });
  }

  var registro = {};
  function nenhum(tela) { if (registro[tela]) registro[tela](); }

  window.PixcFiltros = { montar: montar, nenhum: nenhum };
})();
