/* Painel IXC — exportação CSV feita no navegador (0.12.0).
 * Exporta exatamente as linhas que a tela está mostrando com os filtros aplicados (todas as páginas, não só a atual).
 *
 * PixcCsv.baixar(prefixo, colunas, linhas)
 *   prefixo  início do nome do arquivo (ex.: 'os-abertas') — recebe a data/hora no fim
 *   colunas  ['Base', 'O.S.', ...]
 *   linhas   [[...], [...]]  (valores null/undefined viram vazio)
 * Formato pensado para o Excel em português: separador ";", UTF-8 com BOM, quebra de linha CRLF.
 */
(function () {
  'use strict';

  /** Texto de uma célula, protegido contra fórmula (=, +, -, @ no começo viram texto) e com aspas escapadas. */
  function celula(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/\r\n?/g, '\n');
    if (/^[=+\-@\t]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
    if (/[";\n]/.test(s) || /^\s|\s$/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function texto(colunas, linhas) {
    var out = [colunas.map(celula).join(';')];
    (linhas || []).forEach(function (l) { out.push((l || []).map(celula).join(';')); });
    return '﻿' + out.join('\r\n') + '\r\n';
  }
  function carimbo(d) {
    d = d || new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }
  function nomeArquivo(prefixo) {
    return String(prefixo || 'painel-ixc').replace(/[^\w.-]+/g, '-') + '_' + carimbo() + '.csv';
  }
  function baixar(prefixo, colunas, linhas) {
    var blob = new Blob([texto(colunas, linhas)], { type: 'text/csv;charset=utf-8' });
    var nome = nomeArquivo(prefixo);
    if (window.navigator && window.navigator.msSaveOrOpenBlob) { window.navigator.msSaveOrOpenBlob(blob, nome); return nome; }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nome; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
    return nome;
  }
  /** "AAAA-MM-DD HH:MM:SS" → "DD/MM/AAAA HH:MM" (o Excel reconhece como data). */
  function data(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s || '');
    if (!m) return '';
    return m[3] + '/' + m[2] + '/' + m[1] + (m[4] ? ' ' + m[4] + ':' + m[5] : '');
  }
  /** Liga um botão de exportar. Sem linhas, o botão avisa por 2 s ("Nada para exportar") em vez de baixar um arquivo vazio. */
  function ligarBotao(botao, gerar) {
    if (!botao) return;
    botao.addEventListener('click', function () {
      var r = gerar();
      if (!r || !r.linhas || !r.linhas.length) {
        if (botao.dataset.pixcTexto === undefined) botao.dataset.pixcTexto = botao.innerHTML;
        botao.textContent = 'Nada para exportar'; botao.disabled = true;
        setTimeout(function () { botao.innerHTML = botao.dataset.pixcTexto; botao.disabled = false; }, 2000);
        return;
      }
      baixar(r.prefixo, r.colunas, r.linhas);
    });
  }

  window.PixcCsv = { baixar: baixar, texto: texto, celula: celula, data: data, nomeArquivo: nomeArquivo, ligarBotao: ligarBotao };
})();
