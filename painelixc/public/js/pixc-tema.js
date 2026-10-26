/* Painel IXC — tema Claro / Escuro (petróleo).
 * 0.13.2: igual ao plugin Tarefas (taskplus): UM botão que alterna. No claro mostra a lua ("clique para o escuro"),
 * no escuro mostra o sol ("clique para o claro"). A escolha fica gravada por usuário no servidor (front/tema.php);
 * o servidor já desenha a página com data-tema-ativo="escuro" quando o usuário escolheu Escuro (sem piscar).
 * Quem tinha "Automático" (0.12) continua seguindo o GLPI até clicar no botão pela primeira vez.
 * Avisa as telas com o evento "pixc:tema" (detail.ativo = 'claro' | 'escuro'), usado pelo Relatório para redesenhar os gráficos.
 */
(function () {
  'use strict';
  var raiz = document.querySelector('.pixc[data-tema]');
  if (!raiz) return;

  var escolhido = norm(raiz.getAttribute('data-tema'));
  var btn = document.getElementById('pixc-tema-btn');

  function norm(t) { return t === 'escuro' || t === 'auto' ? t : 'claro'; }
  function glpiEscuro() {
    var h = document.documentElement, b = document.body || h;
    return h.getAttribute('data-glpi-theme-dark') === '1' || h.getAttribute('data-bs-theme') === 'dark' || b.getAttribute('data-bs-theme') === 'dark';
  }
  function ativo() { return escolhido === 'auto' ? (glpiEscuro() ? 'escuro' : 'claro') : escolhido; }
  function csrf() { var m = document.querySelector('meta[property="glpi:csrf_token"]'); return m ? m.getAttribute('content') : ''; }

  var ultimo = null;
  function aplicar() {
    var a = ativo();
    raiz.setAttribute('data-tema', escolhido);
    raiz.setAttribute('data-tema-ativo', a);
    document.documentElement.classList.toggle('pixc-escuro', a === 'escuro');
    if (btn) {
      var dica = a === 'escuro' ? 'Tema: escuro — clique para o claro' : 'Tema: claro — clique para o escuro';
      var i = btn.querySelector('i'); if (i) i.className = 'ti ' + (a === 'escuro' ? 'ti-sun' : 'ti-moon');
      btn.title = dica; btn.setAttribute('aria-label', dica); btn.setAttribute('aria-pressed', a === 'escuro' ? 'true' : 'false');
    }
    if (a !== ultimo) {
      ultimo = a;
      try { document.dispatchEvent(new CustomEvent('pixc:tema', { detail: { ativo: a, escolhido: escolhido } })); } catch (e) { /* navegador antigo */ }
    }
  }
  function gravar() {
    var url = raiz.getAttribute('data-url-tema');
    if (!url || !window.fetch) return;
    fetch(url, { method: 'POST', credentials: 'same-origin', body: JSON.stringify({ tema: escolhido }),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-Glpi-Csrf-Token': csrf() } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); })
      .catch(function (e) { if (btn) btn.title += ' (não consegui gravar: ' + e.message + ')'; });
  }
  function alternar() {
    escolhido = ativo() === 'escuro' ? 'claro' : 'escuro';   // sai do "Automático" no 1º clique
    aplicar(); gravar();
  }

  if (btn) btn.addEventListener('click', alternar);
  if (window.MutationObserver) {
    new MutationObserver(function () { if (escolhido === 'auto') aplicar(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-glpi-theme', 'data-glpi-theme-dark', 'data-bs-theme'] });
  }
  aplicar();

  window.PixcTema = { ativo: ativo, escolhido: function () { return escolhido; }, alternar: alternar,
    escolher: function (t) { escolhido = norm(t); aplicar(); gravar(); } };
})();
