/* Painel do Bot 0.2.0 — leitura do banco do bot (schema ixc): visão geral, shoppings e escala, técnicos,
 * contatos de setor, mensagens (+ perguntas), parâmetros e últimos envios.
 * Só existem no HTML as seções que o perfil vê; o JSON também só traz essas.
 * 0.2.0: edição de mensagens (salvar, restaurar padrão, histórico) e perguntas (criar, editar, ligar/desligar, excluir).
 * Todo texto vindo do banco entra via textContent; a pré-visualização do WhatsApp escapa o texto antes de formatar.
 */
(function iniciar() {
  'use strict';

  if (document.readyState !== 'complete') { window.addEventListener('load', iniciar); return; }
  var raiz = document.getElementById('pbot');
  if (!raiz) return;

  var API = raiz.getAttribute('data-api');
  var DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
  var DIAS_TXT = { seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex', sab: 'Sáb', dom: 'Dom' };
  var dados = null;
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined && txt !== null) e.textContent = String(txt); return e; }
  function pill(txt, cor) { var s = el('span', 'pbot-st', txt); s.style.setProperty('--c', cor || '#64748b'); return s; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function fone(f) {
    var d = String(f || '').replace(/\D/g, '');
    if (d.length === 12 || d.length === 13) { var dd = d.slice(2, 4), n = d.slice(4); return '(' + dd + ') ' + n.slice(0, n.length - 4) + '-' + n.slice(-4); }
    return f || '';
  }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function normFrase(s) { return norm(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function param(chave) { var p = arr(dados && dados.parametros).filter(function (x) { return x.chave === chave; })[0]; return p ? p.valor : null; }

  function tabela(t, cab, linhas, vazio) {
    if (!t) return;
    t.textContent = '';
    var th = el('thead'), tr = el('tr');
    cab.forEach(function (c) { tr.appendChild(el('th', null, c)); });
    th.appendChild(tr); t.appendChild(th);
    var tb = el('tbody');
    if (!linhas.length) { var r = el('tr'), td = el('td', 'pbot-vazio', vazio || 'Nada para mostrar.'); td.colSpan = cab.length; r.appendChild(td); tb.appendChild(r); }
    linhas.forEach(function (cels) {
      var r = el('tr');
      cels.forEach(function (c) { var td = el('td'); if (c instanceof Node) td.appendChild(c); else td.textContent = c === null || c === undefined ? '' : String(c); r.appendChild(td); });
      tb.appendChild(r);
    });
    t.appendChild(tb);
  }
  function bloco() { var d = el('div'); for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; if (a) d.appendChild(a instanceof Node ? a : el('div', null, a)); } return d; }

  // ---------------------------------------------------------------- visão geral
  function eventosDe(tipos) {
    var r = { ok: 0, falha: 0, ignorado: 0, simulado: 0, ultimo: '' };
    arr(dados.eventos).forEach(function (e) {
      if (tipos.indexOf(e.tipo) < 0 && !(tipos.indexOf('lembrete*') >= 0 && /^lembrete/.test(e.tipo))) return;
      r.ok += +e.ok || 0; r.falha += +e.falha || 0; r.ignorado += +e.ignorado || 0; r.simulado += +e.simulado || 0;
      if (e.ultimo && e.ultimo > r.ultimo) r.ultimo = e.ultimo;
    });
    return r;
  }
  function modo(v) {
    var m = String(v || '').toUpperCase();
    if (m === 'REAL') return pill('REAL — envia nos grupos', '#16a34a');
    if (m === 'SIMULAR') return pill('SIMULAR — só para o número de teste', '#d97706');
    if (m === 'NENHUM') return pill('NENHUM — não envia', '#64748b');
    return pill(m || '—', '#64748b');
  }
  function card(icone, titulo, quando, descricao, chips, rodape) {
    var c = el('div', 'pbot-card');
    var h = el('div', 'pbot-card-cab');
    h.appendChild(el('i', 'ti ' + icone));
    var tt = el('div'); tt.appendChild(el('b', null, titulo)); tt.appendChild(el('div', 'pbot-sub', quando)); h.appendChild(tt);
    c.appendChild(h);
    c.appendChild(el('p', 'pbot-card-desc', descricao));
    var ch = el('div', 'pbot-chips'); chips.forEach(function (x) { if (x) ch.appendChild(x); }); c.appendChild(ch);
    if (rodape) c.appendChild(el('div', 'pbot-card-rod', rodape));
    return c;
  }
  function geral() {
    var f = $('pbot-funcoes'); if (!f) return;
    f.textContent = '';
    var bases = arr(dados.empresas).filter(function (e) { return e.ativo; }).map(function (e) { return e.id; }).join(', ') || '—';
    var n = eventosDe(['notificacao']), l = eventosDe(['lembrete*']);
    var envioLemb = param('envio_lembretes');
    var sync = dados.escala_sync || {}, cont = dados.contagens || {};

    f.appendChild(card('ti-bell-ringing', 'Avisos de chamados', 'workflow 01 · a cada 3 min',
      'Lê os chamados (O.S.) novos, transferidos e assumidos nos IXCs (' + bases + ') e avisa no grupo dos técnicos marcando o responsável. Chamado sem técnico: aviso aos ' + (param('semtec_min') || '10') +
      ' min, reaviso nos horários ' + (param('realerta_horarios') || '—') + ' e "escalado" após ' + Math.round((+param('escalar_min') || 240) / 60) + ' h. Pedido de infra escrito na O.S. vai ao grupo de automação. Assuntos de projeto T.I e financeiros são ignorados.',
      [modo(param('envio')), pill('24 h: ' + n.ok + ' enviados', '#2563eb'), n.simulado ? pill(n.simulado + ' simulados', '#d97706') : null, n.falha ? pill(n.falha + ' falhas', '#dc2626') : null, pill(n.ignorado + ' ignorados', '#64748b')],
      n.ultimo ? 'último registro: ' + n.ultimo : 'sem registros nas últimas 24 h'));

    f.appendChild(card('ti-calendar-time', 'Lembretes de visita', 'workflow 02 · a cada 5 min',
      'Avisa o técnico antes de cada visita agendada na O.S. (1 hora antes e perto do horário)' + (param('lembrete_privado') === 'sim' ? ', no particular do técnico' : ', no grupo') +
      (param('planta_ativo') === 'nao' ? '.' : ', com a planta da loja quando houver.'),
      [modo(envioLemb !== null && envioLemb !== '' ? envioLemb : param('envio')), pill('24 h: ' + l.ok + ' enviados', '#2563eb'), l.simulado ? pill(l.simulado + ' simulados', '#d97706') : null, l.falha ? pill(l.falha + ' falhas', '#dc2626') : null],
      l.ultimo ? 'último registro: ' + l.ultimo : 'sem lembretes nas últimas 24 h'));

    f.appendChild(card('ti-message-chatbot', 'Bot de escalas e comandos', 'workflow 03 · ao receber mensagem no grupo',
      'Responde "quem está no <shopping>?" com o técnico, telefone e horário de hoje e amanhã; responde "algum N2?", "alguém do financeiro?" e outros setores; aceita os comandos "ixc ..." no grupo de automação (com confirmação "ixc ok").',
      [pill((+cont.shoppings || 0) + ' shoppings', '#0891b2'), pill((+cont.tecnicos || 0) + ' técnicos', '#0891b2'), pill((+cont.contatos || 0) + ' contatos de setor', '#0891b2')],
      'sessão do WhatsApp: ' + (param('waha_session') || '—')));

    var trocas = param('escala_trocar_nomes');
    f.appendChild(card('ti-table-import', 'Escala da planilha', 'workflow 04 · de hora em hora (minuto 20)',
      'Lê a aba HOJE da planilha ESCALAS e grava quem trabalha hoje e amanhã nos shoppings 12x36' + (param('escala_ler_porto_belo') === 'nao' ? '' : ' e em Porto Belo/Tijucas') + '. 3 falhas seguidas avisam no grupo de automação.',
      [(+sync.hoje || 0) > 0 ? pill('hoje: ' + sync.hoje + ' registros', '#16a34a') : pill('hoje: sem escala do dia', '#dc2626'),
        pill('amanhã: ' + (+sync.amanha || 0), (+sync.amanha || 0) > 0 ? '#16a34a' : '#d97706'),
        trocas ? pill('trocas: ' + trocas, '#9333ea') : null],
      sync.em ? 'última leitura: ' + String(sync.em).slice(0, 16).replace('T', ' ') : 'nunca leu'));

    tabela($('pbot-empresas'), ['Base', 'Nome', 'Ativa', 'Último evento lido', 'Atualizado', 'Assuntos ignorados', 'Financeiros', 'Sem técnico e sem shopping'],
      arr(dados.empresas).map(function (e) {
        return [e.id, e.nome, e.ativo ? pill('sim', '#16a34a') : pill('não', '#64748b'), e.last_evento_id, e.atualizado || '', e.n_ignorar, e.n_financeiro, e.semtec_sem_local ? 'avisa' : 'ignora'];
      }));
  }

  // ---------------------------------------------------------------- shoppings, técnicos, contatos
  function horariosTxt(h) {
    var grupos = [], ini = null, ant = null, valAnt = null;
    DIAS.forEach(function (d) {
      var v = (h || {})[d] || '';
      if (v === valAnt && ini !== null) { ant = d; return; }
      if (ini !== null && valAnt) grupos.push([ini, ant, valAnt]);
      ini = d; ant = d; valAnt = v;
    });
    if (ini !== null && valAnt) grupos.push([ini, ant, valAnt]);
    return grupos.map(function (g) { return (g[0] === g[1] ? DIAS_TXT[g[0]] : DIAS_TXT[g[0]] + '–' + DIAS_TXT[g[1]]) + ' ' + g[2].replace(/-/g, '–'); }).join(' · ') || 'sem horário';
  }
  function shoppings() {
    if (!$('pbot-shoppings')) return;
    var q = norm($('pbot-busca-loc').value);
    var lista = arr(dados.shoppings).filter(function (s) {
      return !q || norm([s.empresa, s.nome, s.quem.texto, s.equipe, s.tec_nome].join(' ')).indexOf(q) >= 0;
    });
    $('pbot-legenda-loc').textContent = lista.length + ' de ' + arr(dados.shoppings).length + ' shoppings · hoje é ' + DIAS_TXT[dados.dia_hoje] + ' ' + (dados.hora || '');
    tabela($('pbot-shoppings'), ['Base', 'Shopping', 'Tipo', 'Responde hoje', 'Amanhã', 'Hoje atende', 'Horários', 'Observação'],
      lista.map(function (s) {
        var quem = bloco(el('b', null, s.quem.texto), el('small', 'pbot-sub', s.quem.fonte + (s.tec_fone ? ' · ' + fone(s.tec_fone) : '')));
        var tipo = pill(s.tipo, s.tipo === '12x36' ? '#9333ea' : s.tipo === 'escala' ? '#0891b2' : '#64748b');
        var amanha = s.tipo === 'fixo' ? '' : (s.dia_amanha || '—');
        var hHoje = s.horarios[dados.dia_hoje];
        var atende = hHoje ? pill(hHoje.replace(/-/g, '–'), '#16a34a') : pill('não atende', '#64748b');
        return [s.empresa, s.nome, tipo, quem, amanha, atende, horariosTxt(s.horarios), s.obs];
      }), 'Nenhum shopping cadastrado no bot.');
  }
  function tecnicos() {
    if (!$('pbot-tecnicos')) return;
    var q = norm($('pbot-busca-tec').value);
    var lista = arr(dados.tecnicos).filter(function (t) { return !q || norm([t.empresa, t.nome, t.shoppings, t.id_func].join(' ')).indexOf(q) >= 0; });
    tabela($('pbot-tecnicos'), ['Base', 'Id no IXC', 'Nome', 'WhatsApp', 'Técnico padrão em'],
      lista.map(function (t) { return [t.empresa, t.id_func, t.nome, fone(t.fone), t.shoppings || '—']; }), 'Nenhum técnico.');
  }
  function contatos() {
    tabela($('pbot-contatos'), ['Setor', 'Ordem', 'Nome', 'WhatsApp', 'Horários', 'Escala 12x36', 'Ativo', 'Observação'],
      arr(dados.contatos).map(function (c) {
        return [String(c.setor).toUpperCase(), c.ordem, c.nome, fone(c.fone), c.escala ? '—' : horariosTxt(c.horarios), c.escala || '', c.ativo ? pill('sim', '#16a34a') : pill('não', '#64748b'), c.obs];
      }), 'Nenhum contato de setor.');
  }
  function parametros() {
    if (!$('pbot-parametros')) return;
    var lista = arr(dados.parametros).slice().sort(function (a, b) { return (b.principal - a.principal) || (a.chave < b.chave ? -1 : 1); });
    tabela($('pbot-parametros'), ['Parâmetro', 'Valor', 'Para que serve'],
      lista.map(function (p) { return [el('code', null, p.chave), p.valor === '' ? '(vazio)' : p.valor, p.descricao]; }));
    tabela($('pbot-feriados'), ['Data', 'Base', 'Shopping', 'Descrição'],
      arr(dados.feriados).map(function (f) { return [String(f.data).split('-').reverse().join('/'), f.empresa || 'todas', f.id_condominio || 'todos', f.descricao]; }), 'Nenhum feriado cadastrado à frente.');
  }
  function eventos() {
    var cor = { ok: '#16a34a', falha: '#dc2626', ignorado: '#64748b' };
    tabela($('pbot-eventos'), ['Quando', 'Base', 'Tipo', 'Status', 'Motivo', 'Protocolo', 'Mensagem'],
      arr(dados.ultimos).map(function (e) { return [e.em, e.empresa, e.tipo, pill(e.status, cor[e.status]), e.motivo, e.protocolo, e.texto]; }), 'Nenhum envio registrado.');
  }

  // ---------------------------------------------------------------- mensagens
  var GRUPO_CURTO = {
    'Bot de escalas (perguntas no grupo)': 'Bot de escalas',
    'Setores (algum N2? / financeiro? …)': 'Setores',
    'Comandos ixc (alterações pelo grupo)': 'Comandos ixc',
    'Avisos de chamado (grupo do shopping)': 'Avisos de chamado',
    'Lembretes de visita': 'Lembretes',
    'Alertas internos (grupo de automação)': 'Alertas'
  };
  var SETOR_TXT = { n2: 'Suporte N2', financeiro: 'Financeiro', comercial: 'Comercial', compras: 'Compras', rh: 'RH' };
  // valores de exemplo da pré-visualização (fictícios)
  var EXEMPLO = {
    shopping: 'Shopping Exemplo', empresa: 'BASE', regime: ' · 12x36', rotulo: 'Hoje', dia: 'Seg', data: '24/11', horario: '10:00–22:00',
    status: ' · 🟢 em atendimento (até 22:00)', tecnico: 'Técnico A', telefone: '@5541999990001', semana: 'Seg–Sáb 10:00–22:00 · Dom 14:00–20:00',
    inicio: '10:00', fim: '18:00', hora: '10:24', nome: 'Técnico A', quando: 'amanhã', setores: 'Financeiro', alteracao: 'número do Técnico A → (41) 99999-0001',
    busca: 'xpto', marcados: '@5541999990001', tempo: '2h', plantao: 'Técnico B', protocolo: '202611240001', assunto: 'Ativação', cliente: 'Cliente Exemplo Ltda',
    loja: 'Loja 101', resumo: 'Cliente sem sinal desde ontem.', ate: ' (até 11:00)', local: 'Piso L2', loja_nome: 'Loja Exemplo', onde: 'Shopping Exemplo, Loja 101',
    minutos: '10 minutos', visita: 'na *Loja Exemplo*', na_empresa: ' na BASE', janela: 'em 1 hora', erro: 'a planilha não devolveu CSV (acesso mudou?)', grupo: '1203630000000000@g.us'
  };
  var msgFiltro = 'todas', msgSel = null;

  function msgs() { return arr(dados.mensagens && dados.mensagens.itens); }
  function pergs() { return dados.perguntas ? arr(dados.perguntas.itens) : null; }
  function textoAtual(m) { return m.texto !== null && m.texto !== undefined ? m.texto : m.texto_padrao; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  /** Formatação do WhatsApp sobre texto já escapado: *negrito*, _itálico_, ~riscado~; {variavel} vira o valor de exemplo. */
  function whats(s, realce) {
    var h = esc(s)
      .replace(/\{([a-z_]+)\}/g, function (x, v) { return '<span class="pbot-var">' + esc(EXEMPLO[v] !== undefined ? EXEMPLO[v] : v) + '</span>'; })
      .replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|[\s(])_([^_\n]+)_/g, '$1<i>$2</i>').replace(/~([^~\n]+)~/g, '<s>$1</s>');
    return realce ? '<span class="pbot-realce">' + h + '</span>' : h;
  }
  function porChave(k) { return msgs().filter(function (m) { return m.chave === k; })[0]; }

  function msgLista() {
    var itens = $('pbot-msg-itens'), filtros = $('pbot-msg-filtros');
    if (!itens) return;
    var todas = msgs();
    if (dados.mensagens && dados.mensagens.instalado === false) {
      itens.textContent = '';
      var av = el('div', 'pbot-aviso');
      av.appendChild(el('i', 'ti ti-database-off'));
      av.appendChild(bloco(el('b', null, 'Tabelas de mensagens ainda não criadas no banco do bot.'),
        'Rode o painelbot/sql/01-mensagens-perguntas.sql e depois o 02-usuario-painel.sql no Postgres do bot (ver roteiro da 0.1.0).'));
      itens.appendChild(av);
      $('pbot-msg-ed').textContent = '';
      filtros.textContent = '';
      return;
    }
    // filtros
    var cont = { todas: todas.length, personalizadas: todas.filter(function (m) { return m.personalizada; }).length };
    var ordemG = [];
    todas.forEach(function (m) { if (ordemG.indexOf(m.grupo) < 0) ordemG.push(m.grupo); cont[m.grupo] = (cont[m.grupo] || 0) + 1; });
    filtros.textContent = '';
    [['todas', 'Todas']].concat(ordemG.map(function (g) { return [g, GRUPO_CURTO[g] || g]; })).concat([['personalizadas', 'Personalizadas']]).forEach(function (f) {
      var b = el('button', 'pbot-chip' + (msgFiltro === f[0] ? ' ativo' : ''), f[1] + ' ' + (cont[f[0]] || 0));
      b.type = 'button';
      b.addEventListener('click', function () { msgFiltro = f[0]; msgLista(); });
      filtros.appendChild(b);
    });
    // lista
    var q = norm($('pbot-busca-msg').value), ps = pergs() || [];
    var lista = todas.filter(function (m) {
      if (msgFiltro === 'personalizadas' && !m.personalizada) return false;
      if (msgFiltro !== 'todas' && msgFiltro !== 'personalizadas' && m.grupo !== msgFiltro) return false;
      if (!q) return true;
      var alvo = /^setor\.titulo\.(.+)$/.exec(m.chave);
      var frases = alvo ? ps.filter(function (p) { return p.alvo === alvo[1]; }).map(function (p) { return p.frase; }).join(' ') : '';
      return norm([m.chave, m.titulo, textoAtual(m), m.exemplo, frases].join(' ')).indexOf(q) >= 0;
    });
    itens.textContent = '';
    if (!lista.length) { itens.appendChild(el('div', 'pbot-vazio', 'Nenhuma mensagem com esse filtro.')); }
    var g0 = null;
    lista.forEach(function (m) {
      if (m.grupo !== g0) {
        g0 = m.grupo;
        var gh = el('div', 'pbot-msg-grupo'); gh.appendChild(el('span', null, m.grupo)); gh.appendChild(el('span', null, lista.filter(function (x) { return x.grupo === g0; }).length));
        itens.appendChild(gh);
      }
      var it = el('button', 'pbot-msg-item' + (msgSel === m.chave ? ' sel' : ''));
      it.type = 'button';
      it.setAttribute('data-chave', m.chave);
      var t = el('div', 'pbot-msg-t', m.titulo);
      if (m.personalizada) t.appendChild(el('span', 'pbot-tag pers', 'personalizada'));
      it.appendChild(t);
      it.appendChild(el('div', 'pbot-msg-s', textoAtual(m).split('\n')[0]));
      it.addEventListener('click', function () { if (m.chave !== msgSel && !descartar()) return; msgSel = m.chave; msgLista(); });
      itens.appendChild(it);
    });
    if (!msgSel || !lista.some(function (m) { return m.chave === msgSel; })) msgSel = lista.length ? lista[0].chave : null;
    Array.prototype.forEach.call(itens.querySelectorAll('.pbot-msg-item'), function (b) { b.classList.toggle('sel', b.getAttribute('data-chave') === msgSel); });
    if (!sujo || editorDe !== msgSel) msgEditor();   // buscar/filtrar não apaga o que está sendo digitado
  }

  // ---------------------------------------------------------------- 0.2.0: gravação
  var API_ACAO = raiz.getAttribute('data-acao');
  var D = (function () { try { return JSON.parse(raiz.getAttribute('data-direitos') || '{}') || {}; } catch (e) { return {}; } })();
  function pode(area, o) { return !!(D[area] && D[area][o]); }
  function csrf() { var m = document.querySelector('meta[property="glpi:csrf_token"]'); return m ? m.getAttribute('content') : ''; }
  function post(acao, corpo) {
    return fetch(API_ACAO, { method: 'POST', credentials: 'same-origin', body: JSON.stringify(Object.assign({ acao: acao }, corpo || {})),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-Glpi-Csrf-Token': csrf() } })
      .then(function (r) { return r.json().catch(function () { return { ok: false, erro: 'Resposta inválida do servidor (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, erro: 'Falha de rede: ' + e.message }; });
  }
  function aviso(alvo, ok, txt) {
    if (!alvo) return;
    alvo.textContent = txt || ''; alvo.className = 'pbot-retorno' + (txt ? (ok ? ' ok' : ' erro') : '');
  }
  function trocarMensagem(nova) {
    var l = msgs();
    for (var i = 0; i < l.length; i++) if (l[i].chave === nova.chave) { l[i] = nova; return; }
  }
  function trocarPergunta(p, excluir) {
    var l = pergs(); if (!l) return;
    for (var i = 0; i < l.length; i++) if (l[i].id === (excluir ? p : p.id)) { if (excluir) l.splice(i, 1); else l[i] = p; return; }
    if (!excluir) l.push(p);
  }
  var sujo = false, editorDe = null;

  function testarFrase(txt, lista) {
    var n = ' ' + normFrase(txt) + ' ';
    if (normFrase(txt).length > 200) return null;
    for (var i = 0; i < lista.length; i++) {
      var p = lista[i];
      if (p.ativo && n.indexOf(' ' + normFrase(p.frase) + ' ') >= 0) return p;
    }
    return null;
  }
  /** Conferência antes de gravar (o servidor confere de novo). @return {erro, aviso} */
  function conferirFrase(frase, alvo, id) {
    var n = normFrase(frase), l = pergs() || [];
    if (!n) return { erro: 'Escreva a pergunta.' };
    if (String(frase).trim().length > 80) return { erro: 'Máximo 80 caracteres.' };
    if (n.split(' ').length < 2) return { erro: 'Use pelo menos 2 palavras.' };
    for (var i = 0; i < l.length; i++) {
      if (l[i].id === id) continue;
      if (normFrase(l[i].frase) === n) return { erro: l[i].alvo === alvo ? 'Já existe: "' + l[i].frase + '".' : 'Essa frase já aciona ' + SETOR_TXT[l[i].alvo] + '.' };
    }
    for (var j = 0; j < l.length; j++) {
      var o = normFrase(l[j].frase);
      if (l[j].id !== id && l[j].ativo && (n.indexOf(o) >= 0 || o.indexOf(n) >= 0)) return { aviso: 'Parecida com "' + l[j].frase + '" (' + SETOR_TXT[l[j].alvo] + ').' };
    }
    return {};
  }

  function botao(cls, icone, txt, titulo) {
    var b = el('button', 'pbot-bt ' + (cls || '')); b.type = 'button';
    if (icone) b.appendChild(el('i', 'ti ' + icone));
    if (txt) b.appendChild(document.createTextNode(txt));
    if (titulo) { b.title = titulo; b.setAttribute('aria-label', titulo); }
    return b;
  }

  function linhaPergunta(p, alvo, ret, redesenhar) {
    var tr = el('tr');
    var tdF = el('td'), tdO = el('td', null, p.padrao ? 'padrão do bot' : 'adicionada ' + p.criado_em + (p.criado_por ? ' por ' + p.criado_por : '')),
      tdS = el('td'), tdA = el('td', 'pbot-pq-ac');
    tdF.appendChild(el('span', p.ativo ? 'pbot-pq-f' : 'pbot-pq-f inat', p.frase));
    if (p.grupos === 'recados') tdF.appendChild(el('span', 'pbot-tag', 'só Recados'));
    if (pode('perguntas', 'editar')) {
      var sw = el('button', 'pbot-sw' + (p.ativo ? ' on' : '')); sw.type = 'button';
      sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', p.ativo ? 'true' : 'false');
      sw.title = p.ativo ? 'Ligada — clique para desligar' : 'Desligada — clique para ligar';
      sw.setAttribute('aria-label', sw.title);
      sw.addEventListener('click', function () {
        sw.disabled = true;
        post('pergunta_ligar', { id: p.id, ativo: !p.ativo }).then(function (j) {
          if (!j.ok) { aviso(ret, false, j.erro); sw.disabled = false; return; }
          trocarPergunta(j.pergunta); aviso(ret, true, '"' + p.frase + '" ' + (j.pergunta.ativo ? 'ligada.' : 'desligada.')); redesenhar();
        });
      });
      tdS.appendChild(sw);
    } else tdS.appendChild(p.ativo ? pill('ligada', '#16a34a') : pill('desligada', '#64748b'));
    if (!p.padrao && pode('perguntas', 'editar')) {
      var ed = botao('ico', 'ti-pencil', null, 'Editar a pergunta');
      ed.addEventListener('click', function () {
        tdF.textContent = '';
        var inp = el('input', 'form-control form-control-sm'); inp.value = p.frase; inp.maxLength = 80;
        var sel = el('select', 'form-select form-select-sm pbot-pq-grupos');
        [['todos', 'Todos os grupos'], ['recados', 'Só no Recados']].forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; if (p.grupos === o[0]) op.selected = true; sel.appendChild(op); });
        var ok = botao('pri', 'ti-check', 'Salvar'), no = botao('', null, 'Cancelar');
        var lin = el('div', 'pbot-pq-form'); lin.appendChild(inp); lin.appendChild(sel); lin.appendChild(ok); lin.appendChild(no);
        tdF.appendChild(lin); inp.focus();
        no.addEventListener('click', redesenhar);
        ok.addEventListener('click', function () {
          var c = conferirFrase(inp.value, alvo, p.id);
          if (c.erro) { aviso(ret, false, c.erro); return; }
          ok.disabled = true;
          post('pergunta_editar', { id: p.id, frase: inp.value, grupos: sel.value }).then(function (j) {
            if (!j.ok) { aviso(ret, false, j.erro); ok.disabled = false; return; }
            trocarPergunta(j.pergunta); aviso(ret, true, 'Pergunta alterada.'); redesenhar();
          });
        });
      });
      tdA.appendChild(ed);
    }
    if (!p.padrao && pode('perguntas', 'excluir')) {
      var ex = botao('ico perigo', 'ti-trash', null, 'Excluir a pergunta');
      ex.addEventListener('click', function () {
        if (!ex.classList.contains('confirmar')) { ex.classList.add('confirmar'); ex.appendChild(document.createTextNode(' Confirmar?')); return; }
        ex.disabled = true;
        post('pergunta_excluir', { id: p.id }).then(function (j) {
          if (!j.ok) { aviso(ret, false, j.erro); ex.disabled = false; return; }
          trocarPergunta(p.id, true); aviso(ret, true, 'Pergunta "' + p.frase + '" excluída.'); redesenhar();
        });
      });
      tdA.appendChild(ex);
    }
    [tdF, tdO, tdS, tdA].forEach(function (td) { tr.appendChild(td); });
    return tr;
  }

  function blocoPerguntas(m) {
    var caixa = el('div', 'pbot-pq');
    var alvo = /^setor\.titulo\.(.+)$/.exec(m.chave);
    var ps = pergs();
    var cab = el('div', 'pbot-pq-h');
    var tt = el('div');
    cab.appendChild(tt);
    caixa.appendChild(cab);
    if (alvo) {
      alvo = alvo[1];
      tt.appendChild(el('b', null, 'Perguntas que acionam esta resposta'));
      tt.appendChild(el('div', 'pbot-sub', SETOR_TXT[alvo] + (alvo === 'n2' ? ' · responde em qualquer grupo' : ' · responde no grupo Recados (nos outros grupos o bot indica o Recados)') + ' · acento, maiúscula e "?" não importam'));
      if (ps === null) { caixa.appendChild(el('div', 'pbot-pq-nota', 'Seu perfil não tem "Perguntas > Visualizar".')); return caixa; }
      if (dados.perguntas && dados.perguntas.instalado === false) { caixa.appendChild(el('div', 'pbot-pq-nota', 'Tabela de perguntas ainda não criada (rode o 01-mensagens-perguntas.sql).')); return caixa; }
      var ret = el('div', 'pbot-retorno');
      var corpo = el('div');
      var redesenhar = function () {
        corpo.textContent = '';
        var doAlvo = ps.filter(function (p) { return p.alvo === alvo; });
        var t = el('table', 'pbot-pq-tab');
        tabela(t, ['Pergunta', 'Origem', 'Situação', ''], [], 'Nenhuma pergunta cadastrada.');
        var tb = t.querySelector('tbody');
        if (doAlvo.length) { tb.textContent = ''; doAlvo.forEach(function (p) { tb.appendChild(linhaPergunta(p, alvo, ret, redesenhar)); }); }
        corpo.appendChild(t);
        // botões do cabeçalho
        var acoes = cab.querySelector('.pbot-pq-botoes'); if (acoes) acoes.remove();
        acoes = el('div', 'pbot-pq-botoes');
        var desligadas = doAlvo.filter(function (p) { return p.padrao && !p.ativo; }).length;
        if (pode('perguntas', 'editar') && desligadas) {
          var rp = botao('', 'ti-restore', 'Religar padrões (' + desligadas + ')', 'Liga de novo as perguntas padrão do bot que foram desligadas');
          rp.addEventListener('click', function () {
            rp.disabled = true;
            post('perguntas_restaurar', { alvo: alvo }).then(function (j) {
              if (!j.ok) { aviso(ret, false, j.erro); rp.disabled = false; return; }
              ps.forEach(function (p) { if (p.alvo === alvo && p.padrao) p.ativo = true; });
              aviso(ret, true, j.religadas + ' pergunta(s) padrão religada(s).'); redesenhar();
            });
          });
          acoes.appendChild(rp);
        }
        if (pode('perguntas', 'editar')) {
          var nv = botao('pri', 'ti-plus', 'Nova pergunta');
          nv.addEventListener('click', function () { form.hidden = false; nv.disabled = true; fInp.focus(); });
          acoes.appendChild(nv);
        }
        cab.appendChild(acoes);
      };
      // formulário de nova pergunta (só para quem tem Perguntas > Editar)
      var form = el('div', 'pbot-pq-novo'); form.hidden = true;
      form.appendChild(el('label', 'pbot-rot', 'O que a pessoa escreve no grupo'));
      var fInp = el('input', 'form-control'); fInp.maxLength = 80; fInp.placeholder = 'ex.: tem ' + SETOR_TXT[alvo].toLowerCase().replace('suporte ', '') + ' hoje';
      var fSel = el('select', 'form-select pbot-pq-grupos');
      [['todos', 'Todos os grupos do bot'], ['recados', 'Só no grupo Recados']].forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; fSel.appendChild(op); });
      var fChk = el('div', 'pbot-pq-chk');
      var fOk = botao('pri', 'ti-device-floppy', 'Salvar pergunta'), fNo = botao('', null, 'Cancelar');
      var lin = el('div', 'pbot-pq-form'); lin.appendChild(fInp); lin.appendChild(fSel); lin.appendChild(fOk); lin.appendChild(fNo);
      form.appendChild(lin); form.appendChild(fChk);
      form.appendChild(el('div', 'pbot-pq-nota', 'Vale em qualquer parte da mensagem, com as palavras inteiras e nessa ordem. Mensagens com mais de 200 caracteres não acionam o bot.'));
      fInp.addEventListener('input', function () {
        var c = conferirFrase(fInp.value, alvo, 0);
        fChk.textContent = fInp.value.trim() ? (c.erro || c.aviso || 'ok — "' + fInp.value.trim() + '" vai acionar ' + SETOR_TXT[alvo]) : '';
        fChk.className = 'pbot-pq-chk ' + (c.erro ? 'erro' : c.aviso ? 'aviso' : 'ok');
      });
      fNo.addEventListener('click', function () { form.hidden = true; fInp.value = ''; fChk.textContent = ''; redesenhar(); });
      fOk.addEventListener('click', function () {
        var c = conferirFrase(fInp.value, alvo, 0);
        if (c.erro) { aviso(ret, false, c.erro); return; }
        fOk.disabled = true;
        post('pergunta_criar', { alvo: alvo, frase: fInp.value, grupos: fSel.value }).then(function (j) {
          fOk.disabled = false;
          if (!j.ok) { aviso(ret, false, j.erro); return; }
          trocarPergunta(j.pergunta); aviso(ret, true, 'Pergunta "' + j.pergunta.frase + '" criada.');
          form.hidden = true; fInp.value = ''; fChk.textContent = ''; redesenhar();
        });
      });
      if (pode('perguntas', 'editar')) caixa.appendChild(form);
      caixa.appendChild(ret);
      caixa.appendChild(corpo);
      redesenhar();
      var teste = el('div', 'pbot-pq-teste');
      teste.appendChild(el('i', 'ti ti-flask'));
      var inp = el('input', 'form-control'); inp.type = 'text'; inp.maxLength = 300; inp.placeholder = 'Teste uma mensagem: ex. "bom dia, algum n2 disponível?"';
      var res = el('span', 'pbot-pq-res');
      inp.addEventListener('input', function () {
        if (!inp.value.trim()) { res.textContent = ''; res.className = 'pbot-pq-res'; return; }
        var p = testarFrase(inp.value, ps);
        if (p) { res.textContent = 'aciona: ' + SETOR_TXT[p.alvo] + ' (por "' + p.frase + '")'; res.className = 'pbot-pq-res ok'; }
        else { res.textContent = 'não aciona nenhuma resposta de setor'; res.className = 'pbot-pq-res nao'; }
      });
      teste.appendChild(inp); teste.appendChild(res);
      caixa.appendChild(teste);
      caixa.appendChild(el('div', 'pbot-pq-nota', 'As mudanças valem no WhatsApp quando o bot estiver na versão que lê estas perguntas (whatsapp-ixc 0.3.0). Até lá o bot segue as perguntas embutidas.'));
    } else if (/^setor\./.test(m.chave)) {
      tt.appendChild(el('b', null, 'Aparece nas respostas de setor'));
      tt.appendChild(el('div', 'pbot-sub', 'Trecho usado em todas as respostas de setor. As perguntas ficam no título de cada setor:'));
      var ch = el('div', 'pbot-chips pbot-pq-corpo');
      Object.keys(SETOR_TXT).forEach(function (s) {
        var n = ps ? ps.filter(function (p) { return p.alvo === s && p.ativo; }).length : null;
        var b = el('button', 'pbot-chip', SETOR_TXT[s] + (n !== null ? ' · ' + n + ' perguntas' : ''));
        b.type = 'button';
        b.addEventListener('click', function () { if (!descartar()) return; msgSel = 'setor.titulo.' + s; msgFiltro = 'todas'; msgLista(); });
        ch.appendChild(b);
      });
      caixa.appendChild(ch);
    } else if (/^escala\./.test(m.chave)) {
      tt.appendChild(el('b', null, 'Aparece nas respostas de shopping'));
      tt.appendChild(el('div', 'pbot-sub', 'Perguntas como "quem está no <shopping>?", "tem alguém no <shopping>?", "técnico do <shopping>". Os apelidos de cada shopping passam a ser editáveis na 0.3.0.'));
    } else if (/^cmd\./.test(m.chave)) {
      tt.appendChild(el('b', null, 'Resposta de comando'));
      tt.appendChild(el('div', 'pbot-sub', 'Comandos "ixc ..." no grupo de automação' + (m.exemplo ? ' · exemplo: ' + m.exemplo : '')));
    } else {
      tt.appendChild(el('b', null, 'Enviada automaticamente'));
      tt.appendChild(el('div', 'pbot-sub', m.titulo + ' (workflow ' + m.wf + ')'));
    }
    if (alvo || !m.exemplo || /^cmd\./.test(m.chave)) return caixa;
    caixa.appendChild(el('div', 'pbot-pq-nota', 'Exemplo: ' + m.exemplo));
    return caixa;
  }

  function preVisualizacao(m, texto) {
    var wa = el('div', 'pbot-wa');
    var cab = porChave('escala.cabecalho');
    var perg = m.exemplo || (/^setor\./.test(m.chave) ? 'algum n2 disponível?' : '');
    var deGrupo = /^(escala|setor|cmd)\./.test(m.chave);
    if (deGrupo && perg) {
      var q = el('div', 'pbot-wa-q'); q.appendChild(el('small', null, 'Fulano (N1)')); q.appendChild(el('span', null, perg)); wa.appendChild(q);
    }
    var bolha = el('div', 'pbot-wa-bolha');
    var html = '';
    if (deGrupo && perg) html += '<div class="pbot-wa-cit">Fulano: ' + esc(perg) + '</div>';
    if (/^(escala|setor)\./.test(m.chave) && m.chave !== 'escala.cabecalho' && cab) html += whats(textoAtual(cab)) + '\n\n';
    var alvo = /^setor\.titulo\.(.+)$/.exec(m.chave);
    html += whats(texto, true);
    if (alvo) {   // completa a resposta de setor com 2 contatos de exemplo
      var ct = porChave('setor.contato'), sa = porChave('setor.status.atendendo'), sv = porChave('setor.status.volta_hoje');
      if (ct && sa && sv) {
        html += '\n' + whats(textoAtual(ct).replace('{status}', textoAtual(sa)));
        html += '\n' + whats(textoAtual(ct).replace('{nome}', 'Técnico B').replace('{status}', textoAtual(sv)).replace('{horario}', 'Seg–Sex 13:00–22:00').replace('{telefone}', '@5541999990002'));
      }
    }
    bolha.innerHTML = html.replace(/\n/g, '<br>') + '<div class="pbot-wa-hora">10:24</div>';   // texto escapado em esc()/whats()
    wa.appendChild(bolha);
    return wa;
  }

  function descartar() {
    if (!sujo) return true;
    if (window.confirm('Descartar a alteração que não foi salva?')) { sujo = false; return true; }
    return false;
  }

  function msgEditor() {
    var ed = $('pbot-msg-ed'); if (!ed) return;
    ed.textContent = '';
    sujo = false;
    editorDe = msgSel;
    var m = porChave(msgSel);
    if (!m) { ed.appendChild(el('div', 'pbot-vazio', 'Escolha uma mensagem na lista.')); return; }
    var editar = pode('mensagens', 'editar');
    ed.appendChild(el('h3', 'pbot-ed-t', m.titulo));
    var meta = el('div', 'pbot-ed-meta');
    var mi = function (ic, t) { var s = el('span'); s.appendChild(el('i', 'ti ' + ic)); s.appendChild(document.createTextNode(' ' + t)); meta.appendChild(s); };
    mi('ti-git-branch', 'workflow ' + m.wf);
    mi('ti-key', m.chave);
    mi('ti-clock-edit', m.atualizado ? 'alterada ' + m.atualizado + (m.atualizado_por ? ' por ' + m.atualizado_por : '') + (m.personalizada ? '' : ' (voltou ao padrão)') : 'texto padrão do bot');
    ed.appendChild(meta);
    ed.appendChild(blocoPerguntas(m));

    var cols = el('div', 'pbot-ed-cols');
    var esq = el('div');
    esq.appendChild(el('label', 'pbot-rot', 'Texto da mensagem'));
    var ta = el('textarea', 'pbot-ed-texto'); ta.readOnly = !editar; ta.value = textoAtual(m); ta.rows = Math.min(14, Math.max(3, textoAtual(m).split('\n').length + 1));
    ta.maxLength = 3000;
    esq.appendChild(ta);
    var vars = el('div', 'pbot-ed-vars');
    if (m.variaveis.length) {
      vars.appendChild(document.createTextNode(editar ? 'Variáveis (clique para inserir): ' : 'Variáveis: '));
      m.variaveis.forEach(function (v) {
        var c = el(editar ? 'button' : 'code', editar ? 'pbot-var-bt' : null, '{' + v + '}');
        if (editar) {
          c.type = 'button';
          c.addEventListener('click', function () {
            var a = ta.selectionStart || ta.value.length, b = ta.selectionEnd || a;
            ta.value = ta.value.slice(0, a) + '{' + v + '}' + ta.value.slice(b);
            ta.focus(); ta.selectionStart = ta.selectionEnd = a + v.length + 2;
            ta.dispatchEvent(new Event('input'));
          });
        }
        vars.appendChild(c);
      });
    } else vars.appendChild(document.createTextNode('Sem variáveis neste trecho.'));
    esq.appendChild(vars);
    var chk = el('div', 'pbot-ed-chk');
    esq.appendChild(chk);
    esq.appendChild(el('div', 'pbot-ed-fmt', 'WhatsApp: *negrito* · _itálico_ · ~riscado~ · emojis · quebra de linha = Enter'));
    var ret = el('div', 'pbot-retorno'); ret.id = 'pbot-ret-texto';
    if (editar) {
      var bts = el('div', 'pbot-ed-bts');
      var bSalvar = botao('pri', 'ti-device-floppy', 'Salvar'); bSalvar.disabled = true;
      var bRest = botao('', 'ti-arrow-back-up', 'Restaurar padrão'); bRest.disabled = !m.personalizada;
      var bHist = botao('', 'ti-history', 'Histórico');
      bts.appendChild(bSalvar); bts.appendChild(bRest); bts.appendChild(bHist);
      esq.appendChild(bts);
      bSalvar.addEventListener('click', function () {
        bSalvar.disabled = true;
        post('mensagem_salvar', { chave: m.chave, texto: ta.value }).then(function (j) {
          if (!j.ok) { aviso(ret, false, j.erro); bSalvar.disabled = false; return; }
          trocarMensagem(j.mensagem); sujo = false; msgLista();
          aviso($('pbot-ret-texto'), true, j.mensagem.personalizada ? 'Mensagem salva.' : 'Igual ao padrão: a mensagem segue o texto do bot.');
        });
      });
      bRest.addEventListener('click', function () {
        bRest.disabled = true;
        post('mensagem_restaurar', { chave: m.chave }).then(function (j) {
          if (!j.ok) { aviso(ret, false, j.erro); bRest.disabled = false; return; }
          trocarMensagem(j.mensagem); sujo = false; msgLista();
          aviso($('pbot-ret-texto'), true, 'Voltou ao texto padrão do bot.');
        });
      });
      bHist.addEventListener('click', function () { mostrarHistorico(m, esq, bHist); });
    } else if (pode('mensagens', 'ver')) {
      var bH = botao('', 'ti-history', 'Histórico'); esq.appendChild(el('div', 'pbot-ed-bts')).appendChild(bH);
      bH.addEventListener('click', function () { mostrarHistorico(m, esq, bH); });
    }
    esq.appendChild(ret);
    if (m.personalizada) {
      var orig = el('div', 'pbot-ed-orig'); orig.appendChild(document.createTextNode('Texto padrão do bot: ')); orig.appendChild(el('code', null, m.texto_padrao)); esq.appendChild(orig);
    }
    esq.appendChild(el('div', 'pbot-pq-nota', 'O texto salvo vale no WhatsApp quando o bot estiver na versão que lê estes textos (whatsapp-ixc 0.3.0).'));
    var dir = el('div');
    dir.appendChild(el('label', 'pbot-rot', 'Pré-visualização (valores de exemplo)'));
    var pv = preVisualizacao(m, textoAtual(m));
    dir.appendChild(pv);
    cols.appendChild(esq); cols.appendChild(dir);
    ed.appendChild(cols);

    ta.addEventListener('input', function () {
      var atual = textoAtual(m);
      sujo = ta.value !== atual;
      if (bSalvar) bSalvar.disabled = !sujo;
      var novo = preVisualizacao(m, ta.value); pv.replaceWith(novo); pv = novo;
      var usadas = (ta.value.match(/\{([a-z_]+)\}/g) || []).map(function (x) { return x.slice(1, -1); });
      var estranhas = usadas.filter(function (v) { return m.variaveis.indexOf(v) < 0; });
      var sumiram = (m.texto_padrao.match(/\{([a-z_]+)\}/g) || []).map(function (x) { return x.slice(1, -1); }).filter(function (v) { return usadas.indexOf(v) < 0; });
      var msgs2 = [];
      if (!ta.value.trim()) msgs2.push('O texto não pode ficar vazio.');
      if (estranhas.length) msgs2.push('Variável desconhecida: {' + estranhas.join('}, {') + '} — não vai salvar.');
      if (sumiram.length) msgs2.push('Sem {' + sumiram.join('}, {') + '}: essa informação deixa de aparecer' + (sumiram.indexOf('telefone') >= 0 || sumiram.indexOf('marcados') >= 0 ? ' (e a pessoa não é marcada com @)' : '') + '.');
      chk.textContent = msgs2.join(' ');
      chk.className = 'pbot-ed-chk' + (msgs2.length ? (estranhas.length || !ta.value.trim() ? ' erro' : ' aviso') : '');
    });
  }

  function mostrarHistorico(m, onde, bt) {
    var velho = onde.querySelector('.pbot-hist'); if (velho) { velho.remove(); return; }
    bt.disabled = true;
    post('mensagem_historico', { chave: m.chave }).then(function (j) {
      bt.disabled = false;
      var h = el('div', 'pbot-hist');
      if (!j.ok) { h.appendChild(el('div', 'pbot-retorno erro', j.erro)); onde.appendChild(h); return; }
      if (!arr(j.historico).length) h.appendChild(el('div', 'pbot-pq-nota', 'Nenhuma alteração registrada.'));
      arr(j.historico).forEach(function (x) {
        var it = el('div', 'pbot-hist-it');
        it.appendChild(el('div', 'pbot-hist-q', x.quando + (x.quem ? ' · ' + x.quem : '')));
        it.appendChild(el('code', null, x.depois));
        h.appendChild(it);
      });
      onde.insertBefore(h, $('pbot-ret-texto'));
    });
  }

  function render() { geral(); shoppings(); tecnicos(); contatos(); msgLista(); parametros(); eventos(); }

  // ---------------------------------------------------------------- abas e carga
  Array.prototype.forEach.call(raiz.querySelectorAll('.pbot-abas [data-sec]'), function (b) {
    b.addEventListener('click', function () {
      var sec = b.getAttribute('data-sec');
      Array.prototype.forEach.call(raiz.querySelectorAll('.pbot-abas [data-sec]'), function (x) { var a = x === b; x.classList.toggle('ativa', a); x.setAttribute('aria-selected', a ? 'true' : 'false'); });
      Array.prototype.forEach.call(raiz.querySelectorAll('section.pbot-sec'), function (s) { s.hidden = s.getAttribute('data-sec') !== sec; });
    });
  });
  [['pbot-busca-loc', shoppings], ['pbot-busca-tec', tecnicos], ['pbot-busca-msg', msgLista]].forEach(function (p) {
    var i = $(p[0]); if (i) i.addEventListener('input', function () { if (dados) p[1](); });
  });

  function carregar() {
    var st = $('pbot-status'), er = $('pbot-erro');
    st.textContent = 'carregando…';
    fetch(API + '?acao=tudo', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().catch(function () { return { ok: false, erro: 'Resposta inválida do servidor (HTTP ' + r.status + ').' }; }); })
      .then(function (j) {
        if (!j || !j.ok) { er.hidden = false; er.textContent = (j && j.erro) || 'Não foi possível ler o banco do bot.'; st.textContent = 'sem dados'; return; }
        er.hidden = true; dados = j; render();
        st.textContent = 'lido às ' + (j.hora || '');
      })
      .catch(function (e) { er.hidden = false; er.textContent = 'Falha de rede: ' + e.message; st.textContent = 'sem dados'; });
  }
  window.pbot = { dados: function () { return dados; }, recarregar: carregar, testarFrase: testarFrase, conferirFrase: conferirFrase };
  carregar();
})();
