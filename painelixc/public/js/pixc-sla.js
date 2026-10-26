/* Painel IXC — SLA como o IXC mostra (0.13.5 · P13-8).
 * Regra (documentação do IXC "Gerenciamento de SLA" + validação na BUZZ em 21/10, atendimento 220 / O.S. 368 = -131 % / -132 %):
 *   - o prazo (horas) vem do cadastro do assunto; conta a partir da abertura (AB) ou do agendamento (AG, só O.S.);
 *   - "apenas dias úteis": na O.S. vale o do assunto (S/N; P = padrão da base); no atendimento vale sempre o padrão da base;
 *     cada dia útil vale 24 h e sábado, domingo e feriado nacional não contam;
 *   - dentro do prazo o indicador fica em 100 %; ao atingir o prazo começa a cair (99, 98, …), chega a 0 % no dobro do prazo
 *     e continua negativo depois:  pct = decorrido <= prazo ? 100 : round(200 − decorrido / prazo × 100).
 * PixcSla.calcular(inicio, horas, diasUteis, fim, agora) → { pct, prazo (Date), decorridoH, inicio } ou null.
 */
(function () {
  'use strict';

  function data(s) {
    if (s instanceof Date) return s;
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : null;
  }
  /** Páscoa (Meeus/Jones/Butcher) para Carnaval, Sexta-feira Santa e Corpus Christi. */
  function pascoa(ano) {
    var a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(ano, mes - 1, dia);
  }
  var feriadosCache = {};
  /** Feriados nacionais do ano (chave "MM-DD"). */
  function feriados(ano) {
    if (feriadosCache[ano]) return feriadosCache[ano];
    var f = { '01-01': 1, '04-21': 1, '05-01': 1, '09-07': 1, '10-12': 1, '11-02': 1, '11-15': 1, '11-20': 1, '12-25': 1 };
    var p = pascoa(ano), add = function (dias) { var d = new Date(p); d.setDate(p.getDate() + dias); f[chave(d)] = 1; };
    add(-48); add(-47); add(-2); add(60);   // segunda e terça de Carnaval, Sexta-feira Santa, Corpus Christi
    return (feriadosCache[ano] = f);
  }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function chave(d) { return p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function diaUtil(d) { var w = d.getDay(); return w !== 0 && w !== 6 && !feriados(d.getFullYear())[chave(d)]; }
  function inicioDoDia(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function proximoDia(d) { var n = inicioDoDia(d); n.setDate(n.getDate() + 1); return n; }

  /** Horas corridas entre a e b (b > a), pulando os dias não úteis quando diasUteis. */
  function horasEntre(a, b, diasUteis) {
    if (b <= a) return 0;
    if (!diasUteis) return (b - a) / 36e5;
    var h = 0, cur = a;
    while (cur < b) {
      var fim = proximoDia(cur); if (fim > b) fim = b;
      if (diaUtil(cur)) h += (fim - cur) / 36e5;
      cur = fim;
    }
    return h;
  }
  /** Data em que "horas" (úteis ou corridas) se completam a partir de a. */
  function somarHoras(a, horas, diasUteis) {
    if (!diasUteis) return new Date(a.getTime() + horas * 36e5);
    var resta = horas, cur = a;
    for (var guard = 0; guard < 4000 && resta > 0; guard++) {
      var fim = proximoDia(cur);
      if (diaUtil(cur)) {
        var disp = (fim - cur) / 36e5;
        if (resta <= disp) return new Date(cur.getTime() + resta * 36e5);
        resta -= disp;
      }
      cur = fim;
    }
    return cur;
  }

  function calcular(inicio, horas, diasUteis, fim, agora) {
    var ini = data(inicio); horas = Number(horas) || 0;
    if (!ini || horas <= 0) return null;
    var ate = data(fim) || agora || new Date();
    var decorrido = horasEntre(ini, ate, !!diasUteis);
    var pct = decorrido <= horas ? 100 : Math.round(200 - (decorrido / horas) * 100);
    return { pct: pct, prazo: somarHoras(ini, horas, !!diasUteis), decorridoH: decorrido, inicio: ini, horas: horas, uteis: !!diasUteis, fim: data(fim) };
  }
  /** O.S.: cfg = cadastro do assunto; fim = data de fechamento (resolvidas) ou null (ao vivo). */
  function deOs(c, cfg, agora, fim) {
    if (!cfg) return null;
    if (cfg.ini === 'AG') {
      if (!c.data_agenda) return { pct: null, motivo: 'SLA conta a partir do agendamento — O.S. ainda sem agenda' };
      return calcular(c.data_agenda, cfg.h_os, cfg.uteis_os, fim, agora);   // mesma meta, só muda o início (0.13.5.13)
    }
    return calcular(c.data_abertura, cfg.h_os, cfg.uteis_os, fim, agora);
  }
  function deAtd(a, cfg, agora, fim) {
    if (!cfg) return null;
    return calcular(a.data_abertura, cfg.h_atd, cfg.uteis_atd, fim, agora);   // atendimento: padrão da base (0.13.5.12)
  }
  function cor(pct) {
    if (pct === null || pct === undefined) return '#94a3b8';
    if (pct >= 100) return '#16a34a';
    if (pct >= 50) return '#d97706';
    if (pct > 0) return '#dc2626';
    return '#7e22ce';
  }
  function fmt(d) { return d ? p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) : ''; }
  function fmtH(h) { if (h === null || h === undefined) return ''; var d = Math.floor(h / 24), r = Math.round(h % 24); return (d ? d + 'd ' : '') + r + 'h'; }
  /** Pill para a tabela; r = resultado de calcular/deOs/deAtd (ou null = sem SLA). */
  function pill(r, el) {
    var sp = document.createElement('span');
    if (!r || r.pct === null || r.pct === undefined) {
      sp.className = 'pixc-sla vazio'; sp.textContent = '—';
      sp.title = (r && r.motivo) || 'Sem SLA (assunto sem meta de horas ou base sem token da API)';
      return sp;
    }
    sp.className = 'pixc-sla'; sp.style.setProperty('--c', cor(r.pct));
    sp.textContent = r.pct + ' %';
    sp.title = 'Prazo de ' + r.horas + ' h' + (r.uteis ? ' (só dias úteis)' : ' (corridas)') + ' a partir de ' + fmt(r.inicio) +
      ' · vence em ' + fmt(r.prazo) + ' · decorrido ' + fmtH(r.decorridoH) + (r.fim ? ' · congelado em ' + fmt(r.fim) : '');
    return sp;
  }

  window.PixcSla = { calcular: calcular, deOs: deOs, deAtd: deAtd, pill: pill, cor: cor, horasEntre: horasEntre, somarHoras: somarHoras, diaUtil: diaUtil, feriados: feriados };
})();
