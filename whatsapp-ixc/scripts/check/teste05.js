// Testes da 0.3.0 (Painel do Bot): mensagens de ixc.mensagens e perguntas de ixc.perguntas.
// Uso: node scripts/check/teste05.js <pasta n8n 0.2.6> <pasta n8n 0.3.0> <cfgs.json>
//   cfgs.json = saida das queries dos nos de config (Escala: Buscar Dados, IXC Cmd: Carregar, Carregar Parametros 03,
//   Carregar Config 01/02, Carregar Trocas 04) rodadas num banco com o schema ixc + painelbot/sql/01 (dados ficticios).
// 1) sem texto editado, a 0.3.0 responde IGUAL a 0.2.6 (diferencial em dezenas de entradas);
// 2) com texto editado, usa o do painel e some a linha cuja variavel veio vazia;
// 3) perguntas: frase ligada soma a regex, desligada cala, "so Recados" respeitado.
const fs = require('fs'); const { run } = require('./harness');
const [A, B, CF] = process.argv.slice(2);
const ler = (d, f) => Object.fromEntries(JSON.parse(fs.readFileSync(d + '/' + f + '.json', 'utf8')).nodes.filter(n => n.parameters.jsCode).map(n => [n.name, n.parameters.jsCode]));
const W = (d) => ({ w1: ler(d, '01_IXC_Notificacoes_WhatsApp'), w2: ler(d, '02_IXC_Lembretes_de_Visita'), w3: ler(d, '03_IXC_Comandos_e_Consulta_de_Escala'), w4: ler(d, '04_Escalas_Sync_Planilha') });
const V = W(A), N = W(B);
const CFG = JSON.parse(fs.readFileSync(CF, 'utf8'));
let ok = 0; const falhas = []; const check = (n, c) => c ? ok++ : falhas.push(n);
const clone = (x) => JSON.parse(JSON.stringify(x));
// telefones ficticios nos tecnicos e contatos (o banco de teste tem marcadores)
let k = 10;
const fone = () => '55419990000' + String(k++).padStart(2, '0');
const esc = clone(CFG['03:Escala: Buscar Dados']); esc.tecnicos.forEach(t => t.fone = fone()); esc.setores.forEach(s => s.fone = fone());
esc.param.escala_grupos = 'gA@g.us,gR@g.us'; esc.param.setores_grupo = 'gR@g.us';
esc.escala_base.forEach(b => { if (b.tecnicos) b.tecnicos = b.tecnicos.replace(/\(\d{2}\)\s*[\d-]+|55__TELEFONE__/g, '(41) 99999-0001'); });
const cmd = clone(CFG['03:IXC Cmd: Carregar']); cmd.tecnicos = esc.tecnicos; cmd.param = Object.assign({}, cmd.param, esc.param);
const semMsg = (c) => Object.assign(clone(c), { mensagens: {} });
const PAR = (perg, extra) => [{ json: Object.assign({ waha_url: 'http://waha:3000', waha_session: 's1', grupo_automacao: 'gA@g.us', setores_grupo: 'gR@g.us', perguntas: JSON.stringify(perg) }, extra || {}) }];
const PERG = JSON.parse(CFG['03:Carregar Parametros'].perguntas).map(p => Object.assign({}, p, { ativo: true }));

// ---------------------------------------------------------------- WF 03: escala e setores
const filtro = (codes, texto, grupo, perg) => run(codes.w3['Escala: Filtrar Pergunta'], { item: { json: {} }, nodes: {
  'WAHA: Normalizar': [{ json: { data: { key: { remoteJid: grupo || 'gA@g.us', id: 'X1', participant: '5541900000003@c.us', fromMe: false }, message: { conversation: texto } } } }],
  'Carregar Parametros': PAR(perg || PERG) } });
const resposta = (codes, P0, cfg) => run(codes.w3['Escala: Montar Resposta'], { item: { json: {} }, nodes: { 'Escala: Filtrar Pergunta': [{ json: P0 }], 'Escala: Buscar Dados': [{ json: { cfg } }] } });
const PERGUNTAS = ['quem está no palladium curitiba?', 'tem alguém no jockey?', 'quem ta no pontal hoje', 'quem está em curitiba?', 'técnico de cascavel', 'quem ta hoje?',
  'tem alguém em pelotas?', 'quem está no sinop amanhã', 'responsável pelo shopping itajaí', 'quem atende no porto belo', 'algum n2?', 'alguém do financeiro?', 'comercial na ativa?',
  'contato do rh', 'alguém de compras?', 'algum n2 disponível e alguém do financeiro?', 'bom dia, quem ta no park shopping?', 'quem está na estação'];
let comparados = 0;
for (const g of ['gA@g.us', 'gR@g.us']) {
  for (const t of PERGUNTAS) {
    const fv = filtro(V, t, g, []), fn = filtro(N, t, g, PERG.filter(p => false));
    check('filtro igual: ' + t + ' @' + g, JSON.stringify(fv) === JSON.stringify(fn));
    if (!fv.length) continue;
    const rv = resposta(V, fv[0].json, semMsg(esc)), rn = resposta(N, fn[0].json, semMsg(esc));
    comparados++;
    const igual = JSON.stringify(rv) === JSON.stringify(rn);
    if (!igual) { console.log('DIF', t, g, '\n--- 0.2.6:\n' + (rv[0] || {}).json?.resposta + '\n--- 0.3.0:\n' + (rn[0] || {}).json?.resposta); }
    check('resposta igual: ' + t + ' @' + g, igual);
  }
}
check('comparou respostas (>= 20)', comparados >= 20);
// com as perguntas padrao do banco (todas ligadas) o filtro segue igual ao da regex
for (const t of PERGUNTAS) check('padrao do banco nao muda: ' + t, JSON.stringify(filtro(V, t, 'gR@g.us', [])) === JSON.stringify(filtro(N, t, 'gR@g.us', PERG)));

// textos editados
const ed = Object.assign(clone(esc), { mensagens: { 'escala.cabecalho': '🤖 *Bot da escala*', 'setor.titulo.n2': '🛠️ *Suporte N2 — quem atende agora*',
  'setor.contato': '👤 {nome} ({telefone})\n🕐 {horario} · {status}', 'escala.shopping.pessoa': '🧑‍🔧 {tecnico} {telefone}' } });
let r = resposta(N, filtro(N, 'algum n2?', 'gA@g.us', PERG)[0].json, ed)[0].json;
check('editado: cabecalho', r.resposta.startsWith('🤖 *Bot da escala*\n\n'));
check('editado: titulo n2', r.resposta.includes('🛠️ *Suporte N2 — quem atende agora*'));
check('editado: contato vira @ mesmo sem 👤 no lugar de antes', /👤 Contato n2 1 \(@55\d{10,11}\)/.test(r.resposta) && r.mentioned.length >= 4);
r = resposta(N, filtro(N, 'quem está no palladium curitiba?', 'gA@g.us', PERG)[0].json, ed)[0].json;
check('editado: pessoa com outro emoji ainda marca', /🧑‍🔧 .+ @55/.test(r.resposta) && r.mentioned.length >= 1);

// perguntas do painel
const P2 = PERG.concat([{ alvo: 'n2', frase_norm: 'preciso de um n2', grupos: 'todos', ativo: true }, { alvo: 'rh', frase_norm: 'falar com o rh', grupos: 'recados', ativo: true }]);
check('frase nova aciona', JSON.stringify((filtro(N, 'Bom dia, PRECISO de um N2 urgente', 'gA@g.us', P2)[0] || {}).json?.setores) === '["n2"]');
check('frase nova: 0.2.6 nao acionava', !(filtro(V, 'Bom dia, PRECISO de um N2 urgente', 'gA@g.us', [])[0] || {}).json?.setores);
check('so Recados: fora nao aciona', !(filtro(N, 'quero falar com o rh', 'gA@g.us', P2)[0] || {}).json?.setores);
check('so Recados: no Recados aciona', JSON.stringify((filtro(N, 'quero falar com o rh', 'gR@g.us', P2)[0] || {}).json?.setores) === '["rh"]');
const P3 = PERG.map(p => p.frase_norm === 'n2 on' ? Object.assign({}, p, { ativo: false }) : p);
check('padrao desligada cala a regex', !(filtro(N, 'n2 on?', 'gA@g.us', P3)[0] || {}).json?.setores);
check('desligada mas outra ligada na frase -> aciona', JSON.stringify((filtro(N, 'n2 on? algum n2?', 'gA@g.us', P3)[0] || {}).json?.setores) === '["n2"]');
check('regex continua (opcao a): frase fora do banco', JSON.stringify((filtro(N, 'alguém aí do time do financeiro?', 'gR@g.us', P3)[0] || {}).json?.setores) === '["financeiro"]');
check('sem tabela/vazio = igual 0.2.6', JSON.stringify(filtro(N, 'algum n2?', 'gA@g.us', [])) === JSON.stringify(filtro(V, 'algum n2?', 'gA@g.us', [])));
check('perguntas invalidas nao derrubam', filtro(N, 'algum n2?', 'gA@g.us', 'lixo').length === 1);

// ---------------------------------------------------------------- WF 03: comandos ixc
const interp = (codes, args, cfg) => run(codes.w3['IXC Cmd: Interpretar'], { item: { json: {} }, nodes: { 'IXC Cmd: Filtrar': [{ json: { args, autor: 'x', texto: 'ixc ' + args } }], 'IXC Cmd: Carregar': [{ json: { cfg } }] } })[0].json;
for (const a of ['ajuda', '', 'lista', 'lista 4B', 'tecnicos', 'tecnicos PONTO', 'shopping xyzabc tecnico fulano', 'numero ninguem 41 99999-0000', 'blabla', 'feriados', 'quem xptoabc']) {
  check('cmd igual: ' + a, JSON.stringify(interp(V, a, semMsg(cmd))) === JSON.stringify(interp(N, a, semMsg(cmd))));
}
const q1 = interp(N, 'quem palladium curitiba', semMsg(cmd)).resposta;
check('ixc quem: formato da escala (negrito)', /\*Hoje \(/.test(q1) && /\*Amanhã \(/.test(q1));
check('cmd editado', interp(N, 'blabla', Object.assign(semMsg(cmd), { mensagens: { 'cmd.nao_entendi': 'Hã? Manda *ixc ajuda*.' } })).resposta === 'Hã? Manda *ixc ajuda*.');
const fin = (codes, d, wa, cfg) => run(codes.w3['IXC Cmd: Finalizar'], { item: wa, nodes: { 'IXC Cmd: Interpretar': [{ json: d }], 'IXC Cmd: Filtrar': [{ json: { autor: 'x', texto: 't' } }], 'IXC Cmd: Carregar': [{ json: { cfg } }] } })[0].json;
const dN = { acao: { acao: 'numero', fone: '5541999990001' }, resumo: 'número de Fulano', fone_validar: '5541999990001' };
for (const wa of [{ json: { numberExists: true, chatId: '5541999990001@c.us' } }, { json: { numberExists: false } }, { json: {} }]) {
  check('finalizar igual', JSON.stringify(fin(V, dN, wa, semMsg(cmd))) === JSON.stringify(fin(N, dN, wa, semMsg(cmd))));
}
check('finalizar editado', fin(N, dN, { json: {} }, Object.assign(semMsg(cmd), { mensagens: { 'cmd.pendente': '✏️ {alteracao} — confirme com *ixc ok*' } })).resposta.startsWith('✏️ número de Fulano\n⚠️'));

// ---------------------------------------------------------------- WF 01: avisos
const c1 = semMsg(CFG['01:Carregar Config']); c1.param.envio = 'REAL';
const montar = (codes, d, cfg) => run(codes.w1['Montar Mensagem'], { items: [{ json: { registros: [{ assunto: 'Ativação' }] } }], nodes: { 'Rotear': [{ json: d }], 'Carregar Config': [{ json: { cfg } }] } })[0].json.texto;
const base1 = { empresa: '4B', id_chamado: '10', evento: '1', grupo_jid: 'g@g.us', marcar: ['5541999990001'], nome: null, shopping: null, sem_tecnico: false, mensagem: 'Bom dia, cliente sem sinal desde ontem.', primeira: true,
  chamado: { protocolo: '202611240001', apartamento: '101', id_condominio: '199' }, cliente: { razao: 'CLIENTE EXEMPLO LTDA', fantasia: 'Loja Exemplo', telefone_celular: '(41) 99999-0002', id_condominio: '199' } };
const casos1 = [
  Object.assign({}, base1, { evento_emoji: '🆕', evento_label: 'Novo chamado', evento_chave: 'aviso.novo' }),
  Object.assign({}, base1, { evento_emoji: '📨', evento_label: 'Chamado transferido', evento_chave: 'aviso.transferido', cliente: {} , mensagem: '' }),
  Object.assign({}, base1, { evento_emoji: '👤', evento_label: 'Chamado assumido', evento_chave: 'aviso.assumido', marcar: [], nome: 'Fulano' }),
  Object.assign({}, base1, { evento_emoji: '⚠️', evento_label: 'Chamado sem técnico há 10+ min', evento_chave: 'aviso.sem_tecnico', sem_tecnico: true, shopping: 'Palladium Curitiba' }),
  Object.assign({}, base1, { evento_emoji: '⚠️', evento_label: 'Chamado segue sem técnico há 2h', evento_chave: 'aviso.segue_sem_tecnico', tempo: '2h', sem_tecnico: true }),
  Object.assign({}, base1, { evento_emoji: '🚨', evento_label: 'Chamado segue sem técnico há 1d 3h (escalado)', evento_chave: 'aviso.escalado', tempo: '1d 3h', sem_tecnico: true, shopping: 'X' }),
  Object.assign({}, base1, { evento_emoji: '🆕', evento_label: 'Novo chamado', evento_chave: 'aviso.novo', folga: 'Fulano está de folga hoje — plantão no Palladium Curitiba: Beltrano', folga_v: { tecnico: 'Fulano', shopping: 'Palladium Curitiba', plantao: 'Beltrano' }, shopping: 'Palladium Curitiba' }),
  Object.assign({}, base1, { evento_emoji: '🏗️', evento_label: 'Pedido de infra — Fulano', evento_chave: null, marcar: [] }),
  Object.assign({}, base1, { evento_emoji: '🆕', evento_label: 'Novo chamado', evento_chave: 'aviso.novo', cliente: { razao: 'X', fantasia: 'Y', complemento: 'LOJA 36' }, chamado: { protocolo: '1' } }),
];
casos1.forEach((d, i) => { const a = montar(V, d, c1), b = montar(N, d, c1); if (a !== b) console.log('DIF aviso', i, '\n' + a + '\n---\n' + b); check('aviso igual #' + i, a === b); });
const t1 = montar(N, Object.assign({}, casos1[1]), Object.assign(clone(c1), { mensagens: { 'aviso.transferido': '📨 *Transferido* para {marcados}', 'aviso.corpo': '🎫 {protocolo}\n👤 {cliente}\n💬 {resumo}' } }));
check('aviso editado: linhas vazias somem', t1 === '📨 *Transferido* para @5541999990001\n🎫 202611240001');
const sim = (codes, cfg) => run(codes.w1['Anexar Planta'], { items: [{ json: { ok: false, motivo: 'x' } }], nodes: { 'Carregar Config': [{ json: { cfg } }], 'Montar Mensagem': [{ json: { texto: 'oi', grupo_jid: 'g@g.us', mentioned: [], planta: null } }] } })[0].json;
const cS = Object.assign(clone(c1), {}); cS.param.envio = 'SIMULAR'; cS.param.envio_teste_para = '5541900000001';
check('simulacao igual', JSON.stringify(sim(V, cS)) === JSON.stringify(sim(N, cS)));

// ---------------------------------------------------------------- WF 02: lembretes
const c2 = semMsg(CFG['02:Carregar Config']); c2.param.envio = 'REAL'; c2.param.planta_ativo = 'sim';
const lemb = (codes, d, cfg) => run(codes.w2['Montar Lembrete'], { items: [{ json: { registros: [{ assunto: 'Visita técnica' }] } }], nodes: { 'Rotear Lembrete': [{ json: d }], 'Carregar Config': [{ json: { cfg } }] } }).map(x => x.json.texto);
const base2 = { empresa: 'PONTO', marcar: ['5549900000002'], grupo_jid: 'g@g.us', shopping: 'Pátio Chapecó', nome: null, sem_tecnico: false,
  cliente: { razao: 'COLCHOES EXEMPLO', fantasia: 'Ortobom', id_condominio: '84', telefone_celular: '(49) 99999-0000' },
  chamado: { id: '1183', protocolo: '1183', data_agenda: '2026-10-28 14:00:00', data_agenda_final: '2026-10-28 15:00:00', id_condominio: '84', apartamento: 'SALA 102', referencia: 'Piso L1' } };
const casos2 = [Object.assign({}, base2, { tipo: 'lembrete_1h', janela: 'em 1 hora' }), Object.assign({}, base2, { tipo: 'lembrete_10min', faltam: 10, janela: 'em 10 min' }),
  Object.assign({}, base2, { tipo: 'lembrete_10min', faltam: 1, marcar: [], sem_tecnico: true, cliente: {} }), Object.assign({}, base2, { tipo: 'lembrete_1h', janela: 'em 1 hora', sem_tecnico: true, marcar: [], shopping: null, cliente: {} }),
  Object.assign({}, base2, { tipo: 'lembrete_1h', janela: 'em 1 hora', privado: true, marcar: [] })];
casos2.forEach((d, i) => { const a = JSON.stringify(lemb(V, d, c2)), b = JSON.stringify(lemb(N, d, c2)); if (a !== b) console.log('DIF lembrete', i, '\n' + a + '\n---\n' + b); check('lembrete igual #' + i, a === b); });
const cS2 = clone(c2); cS2.param.envio = 'SIMULAR'; cS2.param.envio_teste_para = '5541900000001';
check('lembrete simulacao igual', JSON.stringify(lemb(V, casos2[0], cS2)) === JSON.stringify(lemb(N, casos2[0], cS2)));
check('lembrete editado', lemb(N, casos2[1], Object.assign(clone(c2), { mensagens: { 'lembrete.10min': '⏰ Visita {visita} às {hora}!\n{marcados}' } }))[0].startsWith('⏰ Visita na *Ortobom* às '));

// ---------------------------------------------------------------- WF 04: alerta
const alerta = (codes, msg) => { const st = { falhas: 2 }; return run(codes.w4['Montar Escala'], { item: { json: {} }, static_: st, nodes: {
  'Baixar aba HOJE': [{ json: { data: '<html>erro</html>' } }], 'Carregar Trocas': [{ json: { escala_trocar_nomes: '', escala_ler_porto_belo: 'sim', msg_alerta_planilha: msg } }] } })[0].json.alerta; };
check('alerta igual sem edicao', alerta(V, null) === alerta(N, null) && /falhou 3x/.test(alerta(N, null)));
check('alerta editado', alerta(N, '🚨 Planilha fora: {erro}').startsWith('🚨 Planilha fora: '));

console.log('ok:', ok, 'falhas:', JSON.stringify(falhas, null, 0)); process.exit(falhas.length ? 1 : 0);
