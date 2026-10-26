/* Painel IXC — dropdown múltiplo com caixa de busca visível (Select2 do GLPI) */
(function () {
  'use strict';
  // A lista fica presa ao <body> (AttachBody) e não acompanha a rolagem da página: ao rolar fora dela, fecha.
  var rolagemLigada = false, rolagemPropria = 0;   // rolagemPropria: até quando ignorar (rolagem feita pelo próprio componente)
  function fecharAoRolar() {
    if (rolagemLigada) return;
    rolagemLigada = true;
    document.addEventListener('scroll', function (e) {
      var alvo = e.target;
      if (Date.now() < rolagemPropria) return;                                                       // rolagem feita por nós
      if (alvo && alvo.nodeType === 1 && alvo.closest && alvo.closest('.select2-dropdown')) return;   // rolando a própria lista
      var aberto = document.querySelector('select.select2-hidden-accessible[aria-expanded="true"], .select2-container--open');
      if (!aberto) return;
      var $ = window.jQuery;
      $('select.select2-hidden-accessible').each(function () { if ($(this).data('select2') && $(this).data('select2').isOpen()) $(this).select2('close'); });
    }, true);
  }
  // O Select2 vira a lista para cima quando falta espaço abaixo na janela; aqui a lista abre SEMPRE para baixo
  // (a própria lista rola). Refaz só o cálculo de posição do AttachBody quando ele escolheu "acima".
  var adaptadorCache = null;
  function adaptadorSempreAbaixo(Base) {
    if (adaptadorCache) return adaptadorCache;
    function Adaptador() { Base.apply(this, arguments); }
    Adaptador.prototype = Object.create(Base.prototype);
    Adaptador.prototype.constructor = Adaptador;
    Adaptador.prototype._positionDropdown = function () {
      Base.prototype._positionDropdown.call(this);
      var $dd = this.$dropdown, $c = this.$container;
      if (!$dd || !$dd.hasClass('select2-dropdown--above')) return;
      $dd.removeClass('select2-dropdown--above').addClass('select2-dropdown--below');
      $c.removeClass('select2-container--above').addClass('select2-container--below');
      var off = $c.offset(), top = off.top + $c.outerHeight(false), left = off.left;
      var $pai = this.$dropdownParent;
      if ($pai && $pai[0] && $pai[0].tagName.toLowerCase() !== 'body') { var po = $pai.offset(); top -= po.top; left -= po.left; }
      this.$dropdownContainer.css({ top: top, left: left });
      // se a lista ficou fora da janela, rola a página o suficiente para ela aparecer (sem fechar)
      var r = this.$dropdownContainer[0].getBoundingClientRect(), sobra = r.bottom - window.innerHeight + 8;
      if (sobra > 0 && !this._pixcRolou) {
        this._pixcRolou = true; setTimeout(function (self) { self._pixcRolou = false; }, 900, this);
        rolagemPropria = Date.now() + 900;
        window.scrollBy({ top: sobra, behavior: 'smooth' });
      }
    };
    adaptadorCache = Adaptador;
    return Adaptador;
  }
  window.PixcSelect = {
    /** Monta o Select2 múltiplo com busca dentro da lista. opts: { placeholder, onChange, badgeAttr } */
    montar: function (sel, opts) {
      var $ = window.jQuery;
      if (!$ || !$.fn || !$.fn.select2 || sel.classList.contains('select2-hidden-accessible')) return false;
      opts = opts || {};
      var cfg = {
        width: opts.width || '100%', placeholder: opts.placeholder || sel.getAttribute('data-placeholder') || '',
        closeOnSelect: false, dropdownAutoWidth: false, dropdownCssClass: 'pixc-lista',
        language: { noResults: function () { return 'Nada encontrado'; }, searching: function () { return 'Procurando…'; } },
        templateResult: function (o) {
          if (!o.id) return o.text;
          var n = o.element && o.element.getAttribute(opts.badgeAttr || 'data-n');
          var d = document.createElement('span'); d.className = 'pixc-op';
          var t = document.createElement('span'); t.className = 'pixc-op-t'; t.textContent = o.text; t.title = o.text; d.appendChild(t);
          if (n) { var b = document.createElement('span'); b.className = 'pixc-op-n'; b.textContent = n; d.appendChild(b); }
          return $(d);
        }
      };
      // caixa de busca dentro da lista (em vez de digitar no meio das etiquetas)
      try {
        var req = $.fn.select2.amd.require;
        var Utils = req('select2/utils'), Dropdown = req('select2/dropdown'), DropdownSearch = req('select2/dropdown/search'),
          AttachBody = req('select2/dropdown/attachBody'), Multiple = req('select2/selection/multiple'),
          Placeholder = req('select2/selection/placeholder'), EventRelay = req('select2/selection/eventRelay');
        cfg.dropdownAdapter = adaptadorSempreAbaixo(Utils.Decorate(Utils.Decorate(Dropdown, DropdownSearch), AttachBody));
        cfg.selectionAdapter = Utils.Decorate(Utils.Decorate(Multiple, Placeholder), EventRelay);
      } catch (e) { /* fica com a busca padrão do Select2 */ }
      var $s = $(sel);
      $s.select2(cfg);
      $s.on('select2:open', function () {
        var dd = document.querySelector('.select2-container--open .select2-dropdown'); if (dd) dd.classList.add('pixc-lista');   // Select2 4.1 ignora dropdownCssClass
        var campo = document.querySelector('.select2-container--open .select2-search__field');
        if (campo) { campo.setAttribute('placeholder', 'Buscar…'); campo.setAttribute('aria-label', 'Buscar na lista'); setTimeout(function () { campo.focus(); }, 0); }
      });
      fecharAoRolar();
      return true;
    },
    /** Marca valores sem disparar a cascata (quem chama controla o "silêncio"). */
    setar: function (sel, vals) {
      Array.prototype.forEach.call(sel.options, function (o) { o.selected = vals.indexOf(o.value) >= 0; });
      if (window.jQuery && sel.classList.contains('select2-hidden-accessible')) window.jQuery(sel).trigger('change.select2');
    }
  };
})();
