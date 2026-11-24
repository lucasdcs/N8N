/* Painel do Bot 0.4.0 — leitura do banco do bot (schema ixc): visão geral, shoppings e escala, técnicos,
 * contatos de setor, mensagens (+ perguntas), parâmetros e últimos envios.
 * Só existem no HTML as seções que o perfil vê; o JSON também só traz essas.
 * 0.4.1: aba Variáveis ({nome} = valor fixo nas mensagens novas) e {shopping} na frase da mensagem nova.
 * 0.4.0: Mensagens — mensagens novas (resposta no grupo a frases escolhidas: criar/editar/excluir) e ativar/desativar qualquer mensagem.
 * 0.3.0: cadastros (shoppings com escala e apelidos, técnicos, contatos de setor) com novo/editar/excluir.
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
    var eS = pode('escala', 'editar'), xS = pode('escala', 'excluir');
    barra('pbot-shoppings', 'Novo shopping', eS ? function () { formShopping(null); } : null);
    tabela($('pbot-shoppings'), ['Base', 'Shopping', 'Tipo', 'Responde hoje', 'Amanhã', 'Hoje atende', 'Horários', 'Observação'].concat(eS || xS ? [''] : []),
      lista.map(function (s) {
        var quem = bloco(el('b', null, s.quem.texto), el('small', 'pbot-sub', s.quem.fonte + (s.tec_fone ? ' · ' + fone(s.tec_fone) : '')));
        var tipo = pill(s.tipo, s.tipo === '12x36' ? '#9333ea' : s.tipo === 'escala' ? '#0891b2' : '#64748b');
        var amanha = s.tipo === 'fixo' ? '' : (s.dia_amanha || '—');
        var hHoje = s.horarios[dados.dia_hoje];
        var atende = hHoje ? pill(hHoje.replace(/-/g, '–'), '#16a34a') : pill('não atende', '#64748b');
        var linha = [s.empresa, s.nome, tipo, quem, amanha, atende, horariosTxt(s.horarios), s.obs];
        if (eS || xS) linha.push(acoesLinha(eS, xS, function () { formShopping(s); }, function (x) {
          excluirEm('shopping_excluir', { empresa: s.empresa, id_condominio: s.id_condominio }, 'Shopping "' + s.nome + '" excluído.', x); }, s.nome));
        return linha;
      }), 'Nenhum shopping cadastrado no bot.');
  }
  function tecnicos() {
    if (!$('pbot-tecnicos')) return;
    var q = norm($('pbot-busca-tec').value);
    var lista = arr(dados.tecnicos).filter(function (t) { return !q || norm([t.empresa, t.nome, t.shoppings, t.id_func].join(' ')).indexOf(q) >= 0; });
    var eT = pode('cadastros', 'editar'), xT = pode('cadastros', 'excluir');
    barra('pbot-tecnicos', 'Novo técnico', eT ? function () { formTecnico(null); } : null);
    tabela($('pbot-tecnicos'), ['Base', 'Id no IXC', 'Nome', 'Na planilha', 'WhatsApp', 'Técnico padrão em', 'Marcado sem técnico em'].concat(eT || xT ? [''] : []),
      lista.map(function (t) {
        var l = [t.empresa, t.id_func, t.nome, t.nome_planilha || '—', fone(t.fone), t.shoppings || '—', t.marcado_em || '—'];
        if (eT || xT) l.push(acoesLinha(eT, xT, function () { formTecnico(t); }, function (x) {
          excluirEm('tecnico_excluir', { empresa: t.empresa, id_func: t.id_func }, 'Técnico "' + t.nome + '" excluído.', x); }, t.nome));
        return l;
      }), 'Nenhum técnico.');
  }
  function contatos() {
    var eC = pode('cadastros', 'editar'), xC = pode('cadastros', 'excluir');
    barra('pbot-contatos', 'Novo contato', eC ? function () { formContato(null); } : null);
    tabela($('pbot-contatos'), ['Setor', 'Ordem', 'Nome', 'WhatsApp', 'Horários', 'Escala 12x36', 'Ativo', 'Observação'].concat(eC || xC ? [''] : []),
      arr(dados.contatos).map(function (c) {
        var l = [String(c.setor).toUpperCase(), c.ordem, c.nome, fone(c.fone), c.escala ? '—' : horariosTxt(c.horarios), c.escala || '', c.ativo ? pill('sim', '#16a34a') : pill('não', '#64748b'), c.obs];
        if (eC || xC) l.push(acoesLinha(eC, xC, function () { formContato(c); }, function (x) {
          excluirEm('contato_excluir', { id: c.id }, 'Contato "' + c.nome + '" excluído.', x); }, c.nome));
        return l;
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
    'Alertas internos (grupo de automação)': 'Alertas',
    'Mensagens novas (respostas no grupo)': 'Novas'
  };
  var NOVA = '__nova__';   // msgSel do formulário de mensagem nova
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
    var cont = { todas: todas.length, personalizadas: todas.filter(function (m) { return m.personalizada; }).length, desativadas: todas.filter(function (m) { return m.ativo === false; }).length };
    var ordemG = [];
    todas.forEach(function (m) { if (ordemG.indexOf(m.grupo) < 0) ordemG.push(m.grupo); cont[m.grupo] = (cont[m.grupo] || 0) + 1; });
    filtros.textContent = '';
    // 0.4.0: botão "Nova mensagem" (Mensagens > Editar, banco com as colunas da 0.4.0)
    var topo = $('pbot-msg-topo');
    if (!topo) { topo = el('div', 'pbot-msg-topo'); topo.id = 'pbot-msg-topo'; filtros.parentNode.insertBefore(topo, filtros); }
    topo.textContent = '';
    if (pode('mensagens', 'editar') && dados.mensagens && dados.mensagens.colunas040) {
      var bn = botao('pri', 'ti-plus', 'Nova mensagem', 'Resposta automática no grupo quando alguém escreve uma das frases que você escolher');
      bn.addEventListener('click', function () { if (msgSel !== NOVA && !descartar()) return; msgSel = NOVA; msgLista(); });
      topo.appendChild(bn);
    } else if (pode('mensagens', 'editar') && dados.mensagens && dados.mensagens.colunas040 === false) {
      topo.appendChild(el('div', 'pbot-pq-nota', 'Para criar e desativar mensagens, rode o painelbot/sql/01-mensagens-perguntas.sql desta versão no banco do bot.'));
    }
    [['todas', 'Todas']].concat(ordemG.map(function (g) { return [g, GRUPO_CURTO[g] || g]; })).concat([['personalizadas', 'Personalizadas']]).concat(cont.desativadas ? [['desativadas', 'Desativadas']] : []).forEach(function (f) {
      var b = el('button', 'pbot-chip' + (msgFiltro === f[0] ? ' ativo' : ''), f[1] + ' ' + (cont[f[0]] || 0));
      b.type = 'button';
      b.addEventListener('click', function () { msgFiltro = f[0]; msgLista(); });
      filtros.appendChild(b);
    });
    // lista
    var q = norm($('pbot-busca-msg').value), ps = pergs() || [];
    var lista = todas.filter(function (m) {
      if (msgFiltro === 'personalizadas' && !m.personalizada) return false;
      if (msgFiltro === 'desativadas' && m.ativo !== false) return false;
      if (msgFiltro !== 'todas' && msgFiltro !== 'personalizadas' && msgFiltro !== 'desativadas' && m.grupo !== msgFiltro) return false;
      if (!q) return true;
      var alvo = /^setor\.titulo\.(.+)$/.exec(m.chave);
      var frases = alvo ? ps.filter(function (p) { return p.alvo === alvo[1]; }).map(function (p) { return p.frase; }).join(' ') : '';
      return norm([m.chave, m.titulo, textoAtual(m), m.exemplo, frases, arr(m.frases).join(' ')].join(' ')).indexOf(q) >= 0;
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
      if (m.ativo === false) { t.appendChild(el('span', 'pbot-tag off', 'desativada')); it.classList.add('off'); }
      it.appendChild(t);
      it.appendChild(el('div', 'pbot-msg-s', textoAtual(m).split('\n')[0]));
      it.addEventListener('click', function () { if (m.chave !== msgSel && !descartar()) return; msgSel = m.chave; msgLista(); });
      itens.appendChild(it);
    });
    if (msgSel !== NOVA && (!msgSel || !lista.some(function (m) { return m.chave === msgSel; }))) msgSel = lista.length ? lista[0].chave : null;
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
    var nv = msgs().filter(function (m) { return m.nova && arr(m.frases).some(function (f) { return normFrase(f) === n; }); })[0];   // 0.4.0
    if (nv) return { erro: 'Essa frase já aciona a mensagem nova "' + nv.titulo + '".' };
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
    if (pode('perguntas', 'excluir')) {
      var ex = botao('ico perigo', 'ti-trash', null, p.padrao ? 'Excluir (pergunta padrão: some da lista e o bot para de responder; volta em "Restaurar padrões")' : 'Excluir a pergunta');
      ex.addEventListener('click', function () {
        if (!ex.classList.contains('confirmar')) { ex.classList.add('confirmar'); ex.appendChild(document.createTextNode(' Confirmar?')); return; }
        ex.disabled = true;
        post('pergunta_excluir', { id: p.id }).then(function (j) {
          if (!j.ok) { aviso(ret, false, j.erro); ex.disabled = false; return; }
          trocarPergunta(p.id, true);
          if (p.padrao && dados.perguntas) { dados.perguntas.excluidas = dados.perguntas.excluidas || {}; dados.perguntas.excluidas[p.alvo] = (dados.perguntas.excluidas[p.alvo] || 0) + 1; }
          aviso(ret, true, 'Pergunta "' + p.frase + '" excluída.' + (p.padrao ? ' (padrão: volta em "Restaurar padrões")' : '')); redesenhar();
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
        var desligadas = doAlvo.filter(function (p) { return p.padrao && !p.ativo; }).length + (((dados.perguntas || {}).excluidas || {})[alvo] || 0);
        if (pode('perguntas', 'editar') && desligadas) {
          var rp = botao('', 'ti-restore', 'Restaurar padrões (' + desligadas + ')', 'Liga de novo as perguntas padrão do bot desligadas e traz de volta as excluídas');
          rp.addEventListener('click', function () {
            rp.disabled = true;
            post('perguntas_restaurar', { alvo: alvo }).then(function (j) {
              if (!j.ok) { aviso(ret, false, j.erro); rp.disabled = false; return; }
              ps.forEach(function (p) { if (p.alvo === alvo && p.padrao) p.ativo = true; });
              var tinha = ((dados.perguntas || {}).excluidas || {})[alvo];
              aviso(ret, true, j.religadas + ' pergunta(s) padrão restaurada(s).');
              if (tinha) carregar(); else redesenhar();   // as excluídas não estão na tela: recarrega
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
      caixa.appendChild(el('div', 'pbot-pq-nota', 'As mudanças valem na próxima mensagem do grupo. Frase usada por uma mensagem nova (Mensagens > Nova mensagem) tem prioridade sobre o setor.'));
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
      tt.appendChild(el('div', 'pbot-sub', 'Perguntas como "quem está no <shopping>?", "tem alguém no <shopping>?", "técnico do <shopping>". Os apelidos de cada shopping ficam em Shoppings e escala.'));
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
    if (msgSel === NOVA) { editorNova(ed, null); return; }
    var m = porChave(msgSel);
    if (!m) { ed.appendChild(el('div', 'pbot-vazio', 'Escolha uma mensagem na lista.')); return; }
    if (m.nova) { editorNova(ed, m); return; }
    var editar = pode('mensagens', 'editar');
    ed.appendChild(cabecalhoEditor(m));
    var meta = el('div', 'pbot-ed-meta');
    var mi = function (ic, t) { var s = el('span'); s.appendChild(el('i', 'ti ' + ic)); s.appendChild(document.createTextNode(' ' + t)); meta.appendChild(s); };
    mi('ti-git-branch', 'workflow ' + m.wf);
    mi('ti-key', m.chave);
    mi('ti-clock-edit', m.atualizado ? 'alterada ' + m.atualizado + (m.atualizado_por ? ' por ' + m.atualizado_por : '') + (m.personalizada ? '' : ' (voltou ao padrão)') : 'texto padrão do bot');
    ed.appendChild(meta);
    if (m.ativo === false) ed.appendChild(notaDesativada());
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
    esq.appendChild(el('div', 'pbot-pq-nota', 'O texto salvo vale na próxima mensagem do bot. Desativar (no topo) deixa este trecho vazio; mensagem inteira vazia não é enviada (whatsapp-ixc 0.5.0).'));
    var dir = el('div');
    dir.appendChild(el('label', 'pbot-rot', 'Pré-visualização (valores de exemplo)'));
    var pv = preVisualizacao(m, textoAtual(m));
    dir.appendChild(pv);
    if (m.ativo === false) dir.classList.add('pbot-pv-off');
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

  // ---------------------------------------------------------------- 0.4.0: ativar/desativar e mensagens novas
  function notaDesativada() {
    var n = el('div', 'pbot-aviso pbot-msg-off');
    n.appendChild(el('i', 'ti ti-message-off'));
    n.appendChild(bloco(el('b', null, 'Desativada'), 'O bot não usa este texto: o trecho fica vazio. Se a mensagem inteira ficar vazia, ela não é enviada (whatsapp-ixc 0.5.0).'));
    return n;
  }
  /** Título + chave Ativa/Desativada (Mensagens > Editar; banco com as colunas da 0.4.0). */
  function cabecalhoEditor(m) {
    var h = el('div', 'pbot-ed-cab');
    h.appendChild(el('h3', 'pbot-ed-t', m.titulo));
    if (!(dados.mensagens && dados.mensagens.colunas040)) return h;
    var lado = el('div', 'pbot-ed-ativa');
    if (pode('mensagens', 'editar')) {
      var sw = el('button', 'pbot-sw' + (m.ativo !== false ? ' on' : '')); sw.type = 'button';
      sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', m.ativo !== false ? 'true' : 'false');
      sw.title = m.ativo !== false ? 'Ativa — clique para desativar' : 'Desativada — clique para ativar';
      sw.setAttribute('aria-label', sw.title);
      var rot = el('span', null, m.ativo !== false ? 'Ativa' : 'Desativada');
      sw.addEventListener('click', function () {
        if (sujo && !descartar()) return;
        sw.disabled = true;
        post('mensagem_ligar', { chave: m.chave, ativo: m.ativo === false }).then(function (j) {
          if (!j.ok) { sw.disabled = false; var r = $('pbot-ret-texto'); aviso(r, false, j.erro); return; }
          trocarMensagem(j.mensagem); sujo = false; msgLista();
          aviso($('pbot-ret-texto'), true, j.mensagem.ativo ? 'Mensagem ativada.' : 'Mensagem desativada.');
        });
      });
      lado.appendChild(rot); lado.appendChild(sw);
    } else lado.appendChild(m.ativo !== false ? pill('ativa', '#16a34a') : pill('desativada', '#64748b'));
    h.appendChild(lado);
    return h;
  }
  function msgsNovas() { return msgs().filter(function (m) { return m.nova; }); }
  /** Frase normalizada; com {shopping}, as partes em volta (0.4.1). */
  function normNova(f) {
    var m = String(f || '').split(/\{[^}]*\}/);
    if (m.length < 2) return normFrase(f);
    var a = normFrase(m[0]), b = normFrase(m.slice(1).join(' '));
    return ((a ? a + ' ' : '') + '{shopping}' + (b ? ' ' + b : '')).trim();
  }
  /**
   * Mensagem do grupo como o bot compara (whatsapp-ixc 0.5.0/0.6.2): normal e sem hífen ("Wi-Fi" também vale como "wifi").
   * Com {shopping}: as palavras antes e depois na ordem; o que fica no lugar é o shopping. @return false | {shopping: texto}
   */
  function bateFrase(txt, f) {
    var n = normNova(f); if (!n || normFrase(txt).length > 200) return false;
    var hs = [' ' + normFrase(txt) + ' ', ' ' + normFrase(String(txt).replace(/-/g, '')) + ' '];
    for (var i = 0; i < 2; i++) {
      var h = hs[i];
      if (n.indexOf('{shopping}') < 0) { if (h.indexOf(' ' + n + ' ') >= 0) return { shopping: null }; continue; }
      var p = n.split('{shopping}'), a = p[0].trim(), b = p[1].trim(), resto = h;
      if (a) { var k = h.indexOf(' ' + a + ' '); if (k < 0) continue; resto = h.slice(k + a.length + 1); }
      if (b) { var j = resto.indexOf(' ' + b + ' '); if (j < 0) continue; resto = resto.slice(0, j); }
      return { shopping: resto.trim() };
    }
    return false;
  }
  function vars() { return arr(dados && dados.variaveis); }
  function nomesVars() { return vars().map(function (v) { return v.nome; }); }
  function linhasFrases(t) { return String(t || '').split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean); }
  /** Conferência das frases de uma mensagem nova (o servidor confere de novo). @return {erro, aviso} */
  function conferirNova(frases, chave) {
    var l = linhasFrases(frases), vistos = {};
    if (!l.length) return { erro: 'Escreva pelo menos uma frase.' };
    if (l.length > 10) return { erro: 'No máximo 10 frases.' };
    var ps = pergs() || [], avisos = [];
    for (var i = 0; i < l.length; i++) {
      var n = normNova(l[i]), vs = (l[i].match(/\{([^}]*)\}/g) || []);
      if (!normFrase(l[i])) return { erro: '"' + l[i] + '": escreva a frase.' };
      if (l[i].length > 80) return { erro: '"' + l[i] + '": máximo 80 caracteres.' };
      if (vs.some(function (v) { return v.slice(1, -1).trim().toLowerCase() !== 'shopping'; })) return { erro: '"' + l[i] + '": na frase só vale a variável {shopping}.' };
      if (vs.length > 1) return { erro: '"' + l[i] + '": use {shopping} uma vez só.' };
      if (n.replace('{shopping}', ' ').trim().split(/\s+/).filter(Boolean).length < 2) return { erro: '"' + l[i] + '": use pelo menos 2 palavras' + (vs.length ? ' além do {shopping}.' : '.') };
      if (vistos[n]) continue; vistos[n] = 1;
      var outra = msgsNovas().filter(function (m) { return m.chave !== chave && arr(m.frases).some(function (f) { return normNova(f) === n; }); })[0];
      if (outra) return { erro: '"' + l[i] + '" já aciona a mensagem "' + outra.titulo + '".' };
      var pq = ps.filter(function (p) { return normFrase(p.frase) === n; })[0];
      if (pq) return { erro: '"' + l[i] + '" já aciona ' + SETOR_TXT[pq.alvo] + ' (Perguntas).' };
      var par = ps.filter(function (p) { var o = normFrase(p.frase); return p.ativo && (n.indexOf(o) >= 0 || o.indexOf(n) >= 0); })[0];
      if (par) avisos.push('"' + l[i] + '" parece com "' + par.frase + '" (' + SETOR_TXT[par.alvo] + '): esta mensagem tem prioridade.');
      if (/-/.test(l[i])) avisos.push('Dica: escreva "' + l[i].replace(/-/g, '') + '" (sem hífen): assim vale para quem escreve com ou sem hífen.');
    }
    return avisos.length ? { aviso: avisos[0] } : {};
  }
  /** Qual mensagem nova ativa uma mensagem do grupo aciona (mesma regra do bot). */
  function testarNova(txt, grupoRecados) {
    return msgsNovas().filter(function (m) {
      return m.ativo !== false && (m.grupos !== 'recados' || grupoRecados) && arr(m.frases).some(function (f) { return bateFrase(txt, f); });
    })[0] || null;
  }
  /** Texto da mensagem nova com os valores (como o bot): {shopping} = exemplo; variável desativada = vazio (linha só com ela some). */
  function preencherNova(texto, shopping) {
    var V = {}; vars().forEach(function (v) { V[v.nome] = v.ativo === false ? '' : v.valor; });
    if (shopping !== undefined) V.shopping = shopping;
    return String(texto || '').split('\n').map(function (l) {
      var ks = (l.match(/\{([a-z_]+)\}/g) || []).map(function (x) { return x.slice(1, -1); }).filter(function (k) { return k in V; });
      if (ks.length && ks.every(function (k) { return V[k] === ''; }) && !/[\p{L}\p{N}]/u.test(l.replace(/\{[a-z_]+\}/g, ''))) return null;
      var out = l.replace(/\{([a-z_]+)\}/g, function (x, k) { return k in V ? V[k] : x; });
      return ks.some(function (k) { return V[k] === ''; }) ? out.replace(/[\s—·:-]+$/u, '') : out;   // igual ao M() do bot
    }).filter(function (l) { return l !== null; }).join('\n');
  }
  function preVisualizacaoNova(frases, texto) {
    var wa = el('div', 'pbot-wa');
    var perg = (linhasFrases(frases)[0] || 'frase que aciona').replace(/\{[^}]*\}/, 'jockey');
    var q = el('div', 'pbot-wa-q'); q.appendChild(el('small', null, 'Fulano (N1)')); q.appendChild(el('span', null, perg)); wa.appendChild(q);
    var bolha = el('div', 'pbot-wa-bolha'), cab = porChave('escala.cabecalho');
    var html = '<div class="pbot-wa-cit">Fulano: ' + esc(perg) + '</div>';
    if (cab && cab.ativo !== false) html += whats(textoAtual(cab)) + '\n\n';
    var temSh = linhasFrases(frases).some(function (f) { return /\{[^}]*\}/.test(f); });
    html += esc(preencherNova(texto || '…', temSh ? 'Jockey Plaza' : undefined)).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|[\s(])_([^_\n]+)_/g, '$1<i>$2</i>').replace(/~([^~\n]+)~/g, '<s>$1</s>');
    bolha.innerHTML = html.replace(/\n/g, '<br>') + '<div class="pbot-wa-hora">10:24</div>';   // texto escapado em esc()/whats()
    wa.appendChild(bolha);
    if (temSh) wa.appendChild(el('div', 'pbot-pq-nota', 'Exemplo com "jockey". Sem shopping reconhecido na pergunta, o bot responde uma vez para cada shopping.'));
    return wa;
  }

  /** Editor de mensagem nova (m = null: formulário de criação). */
  function editorNova(ed, m) {
    var editar = pode('mensagens', 'editar');
    if (m) ed.appendChild(cabecalhoEditor(m)); else ed.appendChild(el('h3', 'pbot-ed-t', 'Nova mensagem'));
    var meta = el('div', 'pbot-ed-meta');
    var mi = function (ic, t) { var s2 = el('span'); s2.appendChild(el('i', 'ti ' + ic)); s2.appendChild(document.createTextNode(' ' + t)); meta.appendChild(s2); };
    mi('ti-message-plus', 'resposta automática no grupo');
    if (m) {
      mi('ti-key', m.chave);
      mi('ti-user', 'criada ' + m.criado_em + (m.criado_por ? ' por ' + m.criado_por : ''));
      if (m.atualizado) mi('ti-clock-edit', 'alterada ' + m.atualizado + (m.atualizado_por ? ' por ' + m.atualizado_por : ''));
    }
    ed.appendChild(meta);
    if (m && m.ativo === false) ed.appendChild(notaDesativada());

    var cols = el('div', 'pbot-ed-cols');
    var esq = el('div'), dir = el('div');
    var campo = function (rot, elem, ajuda) { esq.appendChild(el('label', 'pbot-rot', rot)); esq.appendChild(elem); if (ajuda) esq.appendChild(el('div', 'pbot-pq-nota', ajuda)); return elem; };
    var iNome = campo('Nome (só aparece no painel)', el('input', 'form-control'));
    iNome.maxLength = 80; iNome.placeholder = 'ex.: Senha do wi-fi do Jockey'; iNome.value = m ? m.titulo : ''; iNome.readOnly = !editar;
    var iFr = campo('Quando responder: o que a pessoa escreve no grupo (uma frase por linha, até 10)', el('textarea', 'pbot-ed-texto pbot-nv-frases'),
      'Vale em qualquer parte da mensagem, com as palavras inteiras e nessa ordem; acento, maiúscula e "?" não importam. Mínimo 2 palavras. Mensagem com mais de 200 caracteres não aciona. Use {shopping} no lugar do nome do shopping (ex.: "qual a holding do {shopping}"): vale para qualquer shopping ou apelido; sem shopping reconhecido, responde para todos.');
    iFr.rows = 3; iFr.placeholder = 'qual a senha do wifi do jockey\nsenha wifi jockey'; iFr.value = m ? arr(m.frases).join('\n') : ''; iFr.readOnly = !editar;
    var iGr = el('select', 'form-select pbot-pq-grupos'); iGr.disabled = !editar;
    [['todos', 'Em todos os grupos do bot'], ['recados', 'Só no grupo Recados']].forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; if ((m ? m.grupos : 'todos') === o[0]) op.selected = true; iGr.appendChild(op); });
    campo('Onde', iGr);
    var iTx = campo('Texto da resposta', el('textarea', 'pbot-ed-texto'));
    iTx.maxLength = 3000; iTx.rows = 6; iTx.value = m ? m.texto_padrao : ''; iTx.readOnly = !editar;
    // 0.4.1: variáveis (clique para inserir)
    var vBox = el('div', 'pbot-ed-vars');
    var desenharVars = function () {
      vBox.textContent = '';
      var lista = (linhasFrases(iFr.value).some(function (f) { return /\{[^}]*\}/.test(f); }) ? ['shopping'] : []).concat(nomesVars());
      if (!lista.length) { vBox.appendChild(document.createTextNode('Sem variáveis: crie na aba Variáveis (e use {shopping} na frase para ter {shopping} no texto).')); return; }
      vBox.appendChild(document.createTextNode(editar ? 'Variáveis (clique para inserir): ' : 'Variáveis: '));
      lista.forEach(function (v) {
        var c = el(editar ? 'button' : 'code', editar ? 'pbot-var-bt' : null, '{' + v + '}');
        var info = vars().filter(function (x) { return x.nome === v; })[0];
        c.title = v === 'shopping' ? 'nome do shopping da pergunta' : (info ? (info.ativo === false ? '(desativada) ' : '') + info.valor : '');
        if (editar) c.type = 'button', c.addEventListener('click', function () {
          var a = iTx.selectionStart || iTx.value.length, b = iTx.selectionEnd || a;
          iTx.value = iTx.value.slice(0, a) + '{' + v + '}' + iTx.value.slice(b); iTx.focus(); iTx.selectionStart = iTx.selectionEnd = a + v.length + 2;
          iTx.dispatchEvent(new Event('input'));
        });
        vBox.appendChild(c);
      });
    };
    esq.appendChild(vBox); desenharVars();
    esq.appendChild(el('div', 'pbot-ed-fmt', 'WhatsApp: *negrito* · _itálico_ · ~riscado~ · emojis · quebra de linha = Enter · telefone (dd) nnnnn-nnnn vira @'));
    var chk = el('div', 'pbot-ed-chk'); esq.appendChild(chk);
    var ret = el('div', 'pbot-retorno'); ret.id = 'pbot-ret-texto';
    var bSalvar = null;
    if (editar) {
      var bts = el('div', 'pbot-ed-bts');
      bSalvar = botao('pri', 'ti-device-floppy', m ? 'Salvar' : 'Criar mensagem'); bSalvar.disabled = true;
      bts.appendChild(bSalvar);
      if (!m) {
        var bCanc = botao('', null, 'Cancelar');
        bCanc.addEventListener('click', function () { if (!descartar()) return; sujo = false; msgSel = null; msgLista(); });
        bts.appendChild(bCanc);
      }
      if (m) { var bH = botao('', 'ti-history', 'Histórico'); bH.addEventListener('click', function () { mostrarHistorico(m, esq, bH); }); bts.appendChild(bH); }
      if (m && pode('mensagens', 'excluir')) {
        var bEx = botao('perigo', 'ti-trash', 'Excluir');
        bEx.addEventListener('click', function () {
          if (!bEx.classList.contains('confirmar')) { bEx.classList.add('confirmar'); bEx.appendChild(document.createTextNode(' — confirmar?')); return; }
          bEx.disabled = true;
          post('mensagem_excluir', { chave: m.chave }).then(function (j) {
            if (!j.ok) { aviso(ret, false, j.erro); bEx.disabled = false; return; }
            var l = msgs(); for (var i = 0; i < l.length; i++) if (l[i].chave === m.chave) { l.splice(i, 1); break; }
            sujo = false; msgSel = null; msgLista();
            aviso($('pbot-ret-texto'), true, 'Mensagem "' + m.titulo + '" excluída.');
          });
        });
        bts.appendChild(bEx);
      }
      esq.appendChild(bts);
      bSalvar.addEventListener('click', function () {
        var c = conferirNova(iFr.value, m ? m.chave : '');
        if (c.erro) { aviso(ret, false, c.erro); return; }
        bSalvar.disabled = true;
        var corpo = { titulo: iNome.value, texto: iTx.value, frases: linhasFrases(iFr.value), grupos: iGr.value };
        if (m) corpo.chave = m.chave;
        post(m ? 'mensagem_editar_nova' : 'mensagem_nova', corpo).then(function (j) {
          if (!j.ok) { aviso(ret, false, j.erro); bSalvar.disabled = false; return; }
          if (m) trocarMensagem(j.mensagem); else dados.mensagens.itens.unshift(j.mensagem);
          sujo = false; msgSel = j.mensagem.chave; if (!m) msgFiltro = 'todas'; msgLista();
          aviso($('pbot-ret-texto'), true, m ? 'Mensagem salva.' : 'Mensagem criada. Ela responde no WhatsApp com o whatsapp-ixc 0.5.0.');
        });
      });
    } else if (m && pode('mensagens', 'ver')) {
      var bH2 = botao('', 'ti-history', 'Histórico'); esq.appendChild(el('div', 'pbot-ed-bts')).appendChild(bH2);
      bH2.addEventListener('click', function () { mostrarHistorico(m, esq, bH2); });
    }
    esq.appendChild(ret);
    // teste
    var teste = el('div', 'pbot-pq-teste');
    teste.appendChild(el('i', 'ti ti-flask'));
    var tIn = el('input', 'form-control'); tIn.type = 'text'; tIn.maxLength = 300; tIn.placeholder = 'Teste uma mensagem do grupo: ex. "bom dia, qual a senha do wifi do jockey?"';
    var tRes = el('span', 'pbot-pq-res');
    var testar = function () {
      if (!tIn.value.trim()) { tRes.textContent = ''; tRes.className = 'pbot-pq-res'; return; }
      var l = linhasFrases(iFr.value);
      var esta = null; l.some(function (f) { esta = bateFrase(tIn.value, f); return !!esta; });
      var outra = testarNova(tIn.value, true);
      if (esta) {
        tRes.textContent = 'aciona esta mensagem' + (esta.shopping !== null ? (esta.shopping ? ' · shopping: "' + esta.shopping + '" (o bot confere nos nomes e apelidos; sem shopping reconhecido, responde todos)' : ' · sem shopping: responde todos') : '') + (iGr.value === 'recados' ? ' (só no Recados)' : '');
        tRes.className = 'pbot-pq-res ok';
      }
      else if (outra && (!m || outra.chave !== m.chave)) { tRes.textContent = 'aciona outra: "' + outra.titulo + '"'; tRes.className = 'pbot-pq-res nao'; }
      else { tRes.textContent = 'não aciona esta mensagem'; tRes.className = 'pbot-pq-res nao'; }
    };
    tIn.addEventListener('input', testar);
    teste.appendChild(tIn); teste.appendChild(tRes);
    esq.appendChild(teste);
    esq.appendChild(el('div', 'pbot-pq-nota', 'Tem prioridade sobre as respostas de escala e de setor. Vale no WhatsApp com o whatsapp-ixc 0.5.0.'));
    dir.appendChild(el('label', 'pbot-rot', 'Pré-visualização'));
    var pv = preVisualizacaoNova(iFr.value, iTx.value);
    dir.appendChild(pv);
    if (m && m.ativo === false) dir.classList.add('pbot-pv-off');
    cols.appendChild(esq); cols.appendChild(dir);
    ed.appendChild(cols);
    var mudou = function () {
      var orig = m ? [m.titulo, arr(m.frases).join('\n'), m.grupos, m.texto_padrao] : ['', '', 'todos', ''];
      var agora = [iNome.value.trim(), linhasFrases(iFr.value).join('\n'), iGr.value, iTx.value.replace(/\s+$/, '')];
      sujo = agora.some(function (v, i) { return v !== orig[i]; }) && (m !== null || agora[0] + agora[1] + agora[3] !== '');
      var c = iFr.value.trim() ? conferirNova(iFr.value, m ? m.chave : '') : {};
      var temSh = linhasFrases(iFr.value).some(function (f2) { return /\{[^}]*\}/.test(f2); });
      var usadas = (iTx.value.match(/\{([a-z_]+)\}/g) || []).map(function (x2) { return x2.slice(1, -1); });
      var desconh = usadas.filter(function (v) { return v === 'shopping' ? !temSh : nomesVars().indexOf(v) < 0; });
      var falta = !iNome.value.trim() ? 'Falta o nome.' : !linhasFrases(iFr.value).length ? 'Falta pelo menos uma frase.' : !iTx.value.trim() ? 'Falta o texto.'
        : desconh.indexOf('shopping') >= 0 ? 'Para usar {shopping} no texto, coloque {shopping} na frase.'
        : desconh.length ? 'Variável que não existe: {' + desconh.join('}, {') + '} — crie na aba Variáveis.' : '';
      desenharVars();
      chk.textContent = c.erro || falta || c.aviso || '';
      chk.className = 'pbot-ed-chk' + (c.erro || falta ? ' erro' : c.aviso ? ' aviso' : '');
      if (bSalvar) bSalvar.disabled = !sujo || !!(c.erro || falta);
      var novo = preVisualizacaoNova(iFr.value, iTx.value); pv.replaceWith(novo); pv = novo;
      testar();
    };
    [iNome, iFr, iTx].forEach(function (x) { x.addEventListener('input', mudou); });
    iGr.addEventListener('change', mudou);
    if (!m && editar) iNome.focus();
  }

  // ---------------------------------------------------------------- 0.4.1: aba Variáveis
  var varEditando = null;   // null = sem formulário; '' = nova; 'nome' = editando
  function variaveis() {
    var t = $('pbot-variaveis'); if (!t) return;
    var podeE = pode('mensagens', 'editar'), podeX = pode('mensagens', 'excluir');
    var sem040 = dados.mensagens && dados.mensagens.colunas040 === false;
    barra('pbot-variaveis', 'Nova variável', podeE && !sem040 ? function () { varEditando = ''; formVariavel(); } : null);
    var ret = $('pbot-var-ret');
    if (!ret) { ret = el('div', 'pbot-retorno'); ret.id = 'pbot-var-ret'; t.parentNode.parentNode.insertBefore(ret, t.parentNode); }
    tabela(t, ['Variável', 'Valor', 'Descrição', 'Usada em', 'Situação', ''], vars().map(function (v) {
      var sit;
      if (podeE) {
        sit = el('button', 'pbot-sw' + (v.ativo !== false ? ' on' : '')); sit.type = 'button';
        sit.setAttribute('role', 'switch'); sit.setAttribute('aria-checked', v.ativo !== false ? 'true' : 'false');
        sit.title = v.ativo !== false ? 'Ativa — clique para desativar (o trecho fica vazio nas mensagens)' : 'Desativada — clique para ativar';
        sit.setAttribute('aria-label', sit.title);
        sit.addEventListener('click', function () {
          sit.disabled = true;
          post('variavel_ligar', { nome: v.nome, ativo: v.ativo === false }).then(function (j) {
            if (!j.ok) { aviso($('pbot-var-ret'), false, j.erro); sit.disabled = false; return; }
            trocarVariavel(j.variavel); variaveis(); aviso($('pbot-var-ret'), true, '{' + v.nome + '} ' + (j.variavel.ativo ? 'ativada.' : 'desativada.'));
          });
        });
      } else sit = v.ativo !== false ? pill('ativa', '#16a34a') : pill('desativada', '#64748b');
      var nome = el('code', 'pbot-var-nome', '{' + v.nome + '}');
      var val = el('div', 'pbot-var-valor', v.valor);
      var usos = arr(v.usos).length ? arr(v.usos).map(function (u) { return u.titulo; }).join(', ') : '—';
      var ac = acoesLinha(podeE, podeX, function () { varEditando = v.nome; formVariavel(); }, function (bx) {
        post('variavel_excluir', { nome: v.nome }).then(function (j) {
          if (!j.ok) { aviso($('pbot-var-ret'), false, j.erro); bx.disabled = false; bx.classList.remove('confirmar'); bx.lastChild.remove(); return; }
          dados.variaveis = vars().filter(function (x) { return x.nome !== v.nome; }); variaveis(); aviso($('pbot-var-ret'), true, '{' + v.nome + '} excluída.');
        });
      }, '{' + v.nome + '}');
      return [nome, val, v.descricao || '', usos, sit, ac];
    }), sem040 ? 'Rode o painelbot/sql/01-mensagens-perguntas.sql da 0.4.0 no banco do bot.' : 'Nenhuma variável. Crie com "Nova variável" e use {nome} no texto das mensagens novas.');
    if (varEditando === null) { var f0 = $('pbot-var-form'); if (f0) f0.textContent = ''; }
  }
  function trocarVariavel(v) {
    var l = vars(); for (var i = 0; i < l.length; i++) if (l[i].nome === v.nome) { l[i] = v; return; }
    l.push(v); l.sort(function (a, b) { return a.nome < b.nome ? -1 : 1; }); dados.variaveis = l;
  }
  function formVariavel() {
    var box = $('pbot-var-form'); if (!box) return;
    box.textContent = '';
    var v = varEditando ? vars().filter(function (x) { return x.nome === varEditando; })[0] : null;
    var f = el('div', 'pbot-form pbot-var-f');
    f.appendChild(el('h4', null, v ? 'Editar {' + v.nome + '}' : 'Nova variável'));
    var lin = function (rot, e, ajuda) { f.appendChild(el('label', 'pbot-rot', rot)); f.appendChild(e); if (ajuda) f.appendChild(el('div', 'pbot-pq-nota', ajuda)); return e; };
    var iN = lin('Nome', el('input', 'form-control'), v ? 'O nome não muda (as mensagens usam {' + v.nome + '}). Para trocar, crie outra e ajuste as mensagens.' : 'Só letras minúsculas sem acento, números e _ (ex.: holding, senha_wifi). No texto: {nome}.');
    iN.maxLength = 30; iN.value = v ? v.nome : ''; iN.readOnly = !!v; iN.placeholder = 'holding';
    var iV = lin('Valor', el('textarea', 'pbot-ed-texto'), 'Texto que entra no lugar de {nome}. Aceita *negrito*, emojis e quebra de linha; não aceita outra {variável}.');
    iV.rows = 3; iV.maxLength = 1000; iV.value = v ? v.valor : '';
    var iD = lin('Descrição (só no painel)', el('input', 'form-control')); iD.maxLength = 80; iD.value = v ? v.descricao : '';
    var r = el('div', 'pbot-retorno');
    var bts = el('div', 'pbot-ed-bts');
    var ok = botao('pri', 'ti-device-floppy', v ? 'Salvar' : 'Criar variável'), no = botao('', null, 'Cancelar');
    bts.appendChild(ok); bts.appendChild(no);
    if (v) { var bh = botao('', 'ti-history', 'Histórico'); bts.appendChild(bh); bh.addEventListener('click', function () { mostrarHistoricoVar(v.nome, f, bh); }); }
    f.appendChild(bts); f.appendChild(r);
    box.appendChild(f);
    (v ? iV : iN).focus();
    no.addEventListener('click', function () { varEditando = null; box.textContent = ''; });
    ok.addEventListener('click', function () {
      var nome = iN.value.trim().replace(/^\{|\}$/g, '').toLowerCase();
      if (!v && !/^[a-z][a-z0-9_]{1,29}$/.test(nome)) { aviso(r, false, 'Nome: só letras minúsculas sem acento, números e _, começando com letra (2 a 30).'); return; }
      if (!iV.value.trim()) { aviso(r, false, 'Escreva o valor.'); return; }
      ok.disabled = true;
      post(v ? 'variavel_editar' : 'variavel_criar', { nome: v ? v.nome : nome, valor: iV.value, descricao: iD.value }).then(function (j) {
        ok.disabled = false;
        if (!j.ok) { aviso(r, false, j.erro); return; }
        trocarVariavel(j.variavel); varEditando = null; variaveis(); box.textContent = '';
        aviso($('pbot-var-ret'), true, '{' + j.variavel.nome + '} ' + (v ? 'salva.' : 'criada: use {' + j.variavel.nome + '} no texto das mensagens novas.'));
      });
    });
  }
  function mostrarHistoricoVar(nome, onde, bt) {
    var velho = onde.querySelector('.pbot-hist'); if (velho) { velho.remove(); return; }
    bt.disabled = true;
    post('variavel_historico', { nome: nome }).then(function (j) {
      bt.disabled = false;
      var h = el('div', 'pbot-hist');
      if (!j.ok) { h.appendChild(el('div', 'pbot-retorno erro', j.erro)); onde.appendChild(h); return; }
      arr(j.historico).forEach(function (x) { var it = el('div', 'pbot-hist-it'); it.appendChild(el('div', 'pbot-hist-q', x.quando + (x.quem ? ' · ' + x.quem : ''))); it.appendChild(el('code', null, x.depois)); h.appendChild(it); });
      onde.appendChild(h);
    });
  }

  // ---------------------------------------------------------------- 0.3.0: cadastros (shoppings, técnicos, contatos)
  var APOIO = function () { return dados.apoio || { empresas: [], grupos: [], pessoas: [], setores: [] }; };

  /** Barra acima da tabela (botão "Novo …"). */
  function barra(idTabela, rotulo, aoClicar) {
    var t = $(idTabela); if (!t) return;
    var wrap = t.parentNode, id = idTabela + '-barra', b = $(id);
    if (!b) { b = el('div', 'pbot-barra'); b.id = id; wrap.parentNode.insertBefore(b, wrap); }
    b.textContent = '';
    if (!aoClicar) return;
    var bt = botao('pri', 'ti-plus', rotulo); bt.addEventListener('click', aoClicar); b.appendChild(bt);
  }
  /** Lápis + lixeira (2 cliques) de uma linha. */
  function acoesLinha(podeEditar, podeExcluir, aoEditar, aoExcluir, rotulo) {
    var d = el('div', 'pbot-acoes-linha');
    if (podeEditar) { var e = botao('ico', 'ti-pencil', null, 'Editar ' + rotulo); e.addEventListener('click', aoEditar); d.appendChild(e); }
    if (podeExcluir) {
      var x = botao('ico perigo', 'ti-trash', null, 'Excluir ' + rotulo);
      x.addEventListener('click', function () {
        if (!x.classList.contains('confirmar')) { x.classList.add('confirmar'); x.appendChild(document.createTextNode(' Confirmar?')); return; }
        x.disabled = true; aoExcluir(x);
      });
      d.appendChild(x);
    }
    return d;
  }
  function avisoTopo(ok, txt) {
    var a = $('pbot-retorno-topo');
    if (!a) { a = el('div', 'pbot-retorno'); a.id = 'pbot-retorno-topo'; var er = $('pbot-erro'); er.parentNode.insertBefore(a, er); }
    aviso(a, ok, txt);
    if (ok) setTimeout(function () { if (a.textContent === txt) aviso(a, true, ''); }, 6000);
  }
  function excluirEm(acao, corpo, msgOk, x) {
    post(acao, corpo).then(function (j) {
      if (!j.ok) { avisoTopo(false, j.erro); x.disabled = false; x.classList.remove('confirmar'); x.lastChild.remove(); return; }
      avisoTopo(true, msgOk + (j.aviso || '')); carregar();
    });
  }

  /**
   * Formulário em janela. campos: [{k, rot, tipo: text|num|select|lista|multi|horarios|textarea|check|grupo, opcoes, dica, fixo, largo}]
   * aoSalvar(valores) -> Promise<{ok, erro}>.
   */
  function formulario(titulo, campos, valores, aoSalvar) {
    var fundo = el('div', 'pbot-modal-fundo'), m = el('div', 'pbot-modal'), ent = {};
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', titulo);
    var cab = el('div', 'pbot-modal-cab'); cab.appendChild(el('h4', null, titulo));
    var fx = botao('ico', 'ti-x', null, 'Fechar'); cab.appendChild(fx); m.appendChild(cab);
    var grade = el('div', 'pbot-form');
    campos.forEach(function (c) {
      var bx = el('div', 'pbot-campo' + (c.largo ? ' largo' : '')); bx.setAttribute('data-k', c.k);
      bx.appendChild(el('label', 'pbot-rot', c.rot));
      var v = valores[c.k], inp;
      if (c.tipo === 'select') {
        inp = el('select', 'form-select');
        (typeof c.opcoes === 'function' ? c.opcoes(valores) : c.opcoes).forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; if (String(v) === String(o[0])) op.selected = true; inp.appendChild(op); });
      } else if (c.tipo === 'multi') {
        inp = el('div', 'pbot-multi');
        var sel = (v || []).map(String);
        c.opcoes().forEach(function (o) {
          var lb = el('label', 'pbot-multi-it'), ck = el('input'); ck.type = 'checkbox'; ck.value = o[0]; ck.checked = sel.indexOf(String(o[0])) >= 0;
          lb.appendChild(ck); lb.appendChild(document.createTextNode(' ' + o[1])); inp.appendChild(lb);
        });
        sel.filter(function (f) { return !c.opcoes().some(function (o) { return String(o[0]) === f; }); }).forEach(function (f) {
          var lb = el('label', 'pbot-multi-it'), ck = el('input'); ck.type = 'checkbox'; ck.value = f; ck.checked = true;
          lb.appendChild(ck); lb.appendChild(document.createTextNode(' ' + fone(f) + ' (fora do cadastro)')); inp.appendChild(lb);
        });
      } else if (c.tipo === 'horarios') {
        inp = el('div', 'pbot-horarios');
        DIAS.forEach(function (d) {
          var cel = el('div'); cel.appendChild(el('span', 'pbot-sub', DIAS_TXT[d]));
          var i = el('input', 'form-control form-control-sm'); i.value = ((v || {})[d] || ''); i.placeholder = c.varios ? '08:00-18:00' : '10:00-22:00'; i.setAttribute('data-dia', d);
          cel.appendChild(i); inp.appendChild(cel);
        });
        var cp = botao('', 'ti-copy', 'Copiar Seg para Ter–Sex'); cp.addEventListener('click', function () {
          var s = inp.querySelector('[data-dia="seg"]').value; ['ter', 'qua', 'qui', 'sex'].forEach(function (d) { inp.querySelector('[data-dia="' + d + '"]').value = s; });
        });
        inp.appendChild(cp);
      } else if (c.tipo === 'textarea') {
        inp = el('textarea', 'form-control'); inp.rows = 2; inp.value = v || '';
      } else if (c.tipo === 'check') {
        inp = el('label', 'pbot-multi-it'); var ck2 = el('input'); ck2.type = 'checkbox'; ck2.checked = !!v; inp.appendChild(ck2); inp.appendChild(document.createTextNode(' ' + (c.texto || 'sim')));
      } else {
        inp = el('input', 'form-control'); inp.value = v === undefined || v === null ? '' : v;
        if (c.tipo === 'num') inp.inputMode = 'numeric';
        if (c.tipo === 'grupo') {
          var dl = el('datalist'); dl.id = 'pbot-dl-' + c.k; APOIO().grupos.forEach(function (g) { var o = el('option'); o.value = g.jid; o.label = g.quem; dl.appendChild(o); });
          inp.setAttribute('list', dl.id); bx.appendChild(dl);
        }
      }
      if (c.fixo) { inp.disabled = true; Array.prototype.forEach.call(inp.querySelectorAll ? inp.querySelectorAll('input,select') : [], function (x) { x.disabled = true; }); }
      bx.appendChild(inp); ent[c.k] = { c: c, inp: inp };
      if (c.dica) bx.appendChild(el('div', 'pbot-dica', c.dica));
      grade.appendChild(bx);
    });
    m.appendChild(grade);
    var ret = el('div', 'pbot-retorno'); m.appendChild(ret);
    var rod = el('div', 'pbot-modal-rod'), sv = botao('pri', 'ti-device-floppy', 'Salvar'), cn = botao('', null, 'Cancelar');
    rod.appendChild(cn); rod.appendChild(sv); m.appendChild(rod);
    fundo.appendChild(m); raiz.appendChild(fundo);
    var fechar = function () { fundo.remove(); };
    fx.addEventListener('click', fechar); cn.addEventListener('click', fechar);
    function ler() {
      var o = {};
      Object.keys(ent).forEach(function (k) {
        var c = ent[k].c, inp = ent[k].inp;
        if (c.tipo === 'multi') o[k] = Array.prototype.filter.call(inp.querySelectorAll('input'), function (x) { return x.checked; }).map(function (x) { return x.value; });
        else if (c.tipo === 'horarios') { o[k] = {}; Array.prototype.forEach.call(inp.querySelectorAll('input'), function (x) { o[k][x.getAttribute('data-dia')] = x.value.trim(); }); }
        else if (c.tipo === 'check') o[k] = inp.querySelector('input').checked;
        else if (c.tipo === 'lista') o[k] = inp.value.split(/[,;\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
        else o[k] = inp.value.trim();
      });
      return o;
    }
    // campos que dependem de outro (ex.: técnico padrão depende da base)
    campos.forEach(function (c) {
      if (!c.depende) return;
      var de = ent[c.depende].inp;
      de.addEventListener('change', function () {
        var alvo = ent[c.k].inp, atual = alvo.value; alvo.textContent = '';
        c.opcoes(ler()).forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; if (o[0] === atual) op.selected = true; alvo.appendChild(op); });
      });
    });
    sv.addEventListener('click', function () {
      sv.disabled = true; aviso(ret, true, 'gravando…');
      aoSalvar(ler()).then(function (j) {
        if (!j.ok) { aviso(ret, false, j.erro); sv.disabled = false; return; }
        fechar(); avisoTopo(true, j.msg || 'Gravado.'); carregar();
      });
    });
    var primeiro = m.querySelector('input:not([disabled]),select:not([disabled])'); if (primeiro) primeiro.focus();
    return { fundo: fundo, ler: ler };
  }

  function opEmpresas() { return [['', '— escolha —']].concat(APOIO().empresas.map(function (e) { return [e.id, e.id + ' · ' + e.nome]; })); }
  function opTecnicosDa(v) {
    return [['', '— nenhum (marca a lista abaixo) —']].concat(arr(dados.tecnicos).filter(function (t) { return t.empresa === v.empresa; }).map(function (t) { return [t.id_func, t.nome + ' (id ' + t.id_func + ')']; }));
  }
  function opPessoas() { return APOIO().pessoas.map(function (p) { return [p.fone, p.nome + (p.empresa ? ' · ' + p.empresa : '') + ' · ' + fone(p.fone)]; }); }
  function apelidosDe(chave, sozinho) {
    return arr(dados.apelidos && dados.apelidos.itens).filter(function (a) { return a.alvos.indexOf(chave) >= 0 && (sozinho ? a.alvos.length === 1 : a.alvos.length > 1); });
  }

  function formShopping(s) {
    var novo = !s, chave = s ? s.empresa + ':' + s.id_condominio : '';
    var compart = s ? apelidosDe(chave, false).map(function (a) { return a.apelido; }) : [];
    var camposS = [
      { k: 'empresa', rot: 'Base (IXC)', tipo: 'select', opcoes: opEmpresas, fixo: !novo },
      { k: 'id_condominio', rot: 'ID do condomínio no IXC', tipo: 'num', fixo: !novo, dica: novo ? 'O mesmo id do condomínio do cliente no IXC (é por ele que o aviso de chamado acha o shopping).' : null },
      { k: 'nome', rot: 'Nome do shopping', tipo: 'text' },
      { k: 'grupo', rot: 'Grupo do WhatsApp (avisos de chamado)', tipo: 'grupo', largo: true, dica: 'Escolha um grupo já usado ou cole o id do grupo (…@g.us).' },
      { k: 'tec_padrao', rot: 'Técnico padrão', tipo: 'select', opcoes: opTecnicosDa, depende: 'empresa', dica: 'Quem o bot responde nos shoppings fixos.' },
      { k: 'tipo', rot: 'Tipo de escala', tipo: 'select', opcoes: [['fixo', 'fixo (técnico padrão)'], ['12x36', '12x36 (planilha ESCALAS)'], ['escala', 'escala (equipe)']] },
      { k: 'horarios', rot: 'Horário de atendimento (vazio = não atende)', tipo: 'horarios', largo: true },
      { k: 'equipe', rot: 'Equipe (12x36 / escala)', tipo: 'text', largo: true, dica: 'Usada quando a planilha não tem o dia. Ex.: Fulano (41) 99999-0000; Beltrano (41) 98888-0000' },
      { k: 'marcar_sem_tec', rot: 'Marcar quando o chamado está sem técnico', tipo: 'multi', opcoes: opPessoas, largo: true },
      { k: 'marcar_escalar', rot: 'Marcar também quando escala (reaviso escalado)', tipo: 'multi', opcoes: opPessoas, largo: true },
      { k: 'apelidos', rot: 'Apelidos (como perguntam no grupo)', tipo: 'lista', largo: true,
        dica: 'Separados por vírgula, ex.: palladium, palladium cwb. ' + (compart.length ? 'Também responde por (cidade/rede, não muda aqui): ' + compart.join(', ') + '.' : '') + ' Valem no WhatsApp a partir do whatsapp-ixc 0.4.0.' },
      { k: 'obs', rot: 'Observação (aparece na resposta do bot)', tipo: 'text', largo: true },
    ];
    var v = novo ? { tipo: 'fixo', horarios: {}, marcar_sem_tec: [], marcar_escalar: [], apelidos: '' } : {
      empresa: s.empresa, id_condominio: s.id_condominio, nome: s.nome, grupo: s.grupo, tec_padrao: s.tec_padrao, tipo: s.tipo, horarios: s.horarios,
      equipe: s.equipe, obs: s.obs, marcar_sem_tec: s.marcar_sem_tec ? s.marcar_sem_tec.split(',') : [], marcar_escalar: s.marcar_escalar ? s.marcar_escalar.split(',') : [],
      apelidos: apelidosDe(chave, true).map(function (a) { return a.apelido; }).join(', ') };
    if (dados.apelidos && dados.apelidos.instalado === false) camposS = camposS.filter(function (c) { return c.k !== 'apelidos'; });
    return formulario(novo ? 'Novo shopping' : 'Editar ' + s.nome, camposS, v, function (d) {
      if (!novo) { d.empresa = s.empresa; d.id_condominio = s.id_condominio; }
      return post('shopping_salvar', { novo: novo, dados: d }).then(function (j) { if (j.ok) j.msg = 'Shopping "' + d.nome + '" ' + (novo ? 'criado.' : 'salvo.'); return j; });
    });
  }
  function formTecnico(t) {
    var novo = !t;
    return formulario(novo ? 'Novo técnico' : 'Editar ' + t.nome, [
      { k: 'empresa', rot: 'Base (IXC)', tipo: 'select', opcoes: opEmpresas, fixo: !novo },
      { k: 'id_func', rot: 'ID do colaborador no IXC', tipo: 'num', fixo: !novo, dica: novo ? 'O id do técnico no IXC da base: é por ele que o bot sabe quem foi atribuído no chamado.' : null },
      { k: 'nome', rot: 'Nome', tipo: 'text', dica: 'É o nome que o bot mostra, inclusive nos shoppings 12x36.' },
      { k: 'nome_planilha', rot: 'Nome na planilha ESCALAS (opcional)', tipo: 'text', dica: 'Como ele aparece na planilha dos 12x36. Preencha se o nome acima não começa igual ao da planilha (ex.: "Juliano"). Vazio = usa o nome.' },
      { k: 'fone', rot: 'WhatsApp', tipo: 'text', dica: 'DDD + número, ex.: 41 99999-0000. Trocar aqui troca também nas listas de marcação dos shoppings.' },
      { k: 'grupo', rot: 'Grupo do técnico (opcional)', tipo: 'grupo', largo: true, dica: 'Usado quando o chamado não tem shopping.' },
    ], novo ? {} : { empresa: t.empresa, id_func: t.id_func, nome: t.nome, nome_planilha: t.nome_planilha || '', fone: t.fone ? fone(t.fone) : '', grupo: t.grupo }, function (d) {
      if (!novo) { d.empresa = t.empresa; d.id_func = t.id_func; }
      return post('tecnico_salvar', { novo: novo, dados: d }).then(function (j) { if (j.ok) j.msg = 'Técnico "' + d.nome + '" ' + (novo ? 'criado.' : 'salvo.'); return j; });
    });
  }
  function formContato(c) {
    var novo = !c;
    var op12 = [['', '— horário próprio (abaixo) —']].concat(arr(dados.shoppings).filter(function (s) { return s.tipo !== 'fixo'; }).map(function (s) { return [s.empresa + ':' + s.id_condominio, 'segue a 12x36 de ' + s.nome]; }));
    return formulario(novo ? 'Novo contato de setor' : 'Editar ' + c.nome, [
      { k: 'setor', rot: 'Setor', tipo: 'select', opcoes: APOIO().setores.map(function (s) { return [s, SETOR_TXT[s] || s]; }) },
      { k: 'ordem', rot: 'Ordem na resposta', tipo: 'num' },
      { k: 'nome', rot: 'Nome', tipo: 'text' },
      { k: 'fone', rot: 'WhatsApp', tipo: 'text', dica: 'DDD + número. É marcado com @ na resposta.' },
      { k: 'escala', rot: 'Escala', tipo: 'select', opcoes: op12, largo: true },
      { k: 'horarios', rot: 'Horário (vazio = não atende; vários: 08:00-12:00,13:00-18:00)', tipo: 'horarios', varios: true, largo: true },
      { k: 'obs', rot: 'Observação', tipo: 'text', largo: true },
      { k: 'ativo', rot: 'Ativo', tipo: 'check', texto: 'aparece nas respostas do bot' },
    ], novo ? { setor: 'n2', ordem: 0, ativo: true, horarios: {} } : { setor: c.setor, ordem: c.ordem, nome: c.nome, fone: c.fone ? fone(c.fone) : '', escala: c.escala, horarios: c.horarios, obs: c.obs, ativo: c.ativo },
    function (d) {
      d.id = novo ? 0 : c.id;
      return post('contato_salvar', { dados: d }).then(function (j) { if (j.ok) j.msg = 'Contato "' + d.nome + '" ' + (novo ? 'criado.' : 'salvo.'); return j; });
    });
  }

  function render() { geral(); shoppings(); tecnicos(); contatos(); msgLista(); variaveis(); parametros(); eventos(); }

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
    return fetch(API + '?acao=tudo', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
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
