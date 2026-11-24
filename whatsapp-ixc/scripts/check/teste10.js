// Testes da 0.5.0 (Painel do Bot 0.4.0): mensagens desativadas e mensagens novas (resposta fixa a frases).
// Uso: node scripts/check/teste10.js <pasta n8n 0.4.3> <pasta n8n 0.5.0> <cfgs.json>
//   cfgs.json = python3 scripts/check/cfgs_do_banco.py <pasta n8n 0.5.0> "psql ... -d <banco>" num banco com
//   whatsapp-ixc/banco/01 + 02 + painelbot/sql/01 da 0.4.0 (sem nada desativado; o teste desativa no proprio cfg).
// Sem nada desativado a 0.5.0 e identica a 0.4.3 (o teste05 com A=0.4.3/B=0.5.0 cobre o diferencial completo).
const fs = require('fs'); const { run } = require('./harness');
const [A, B, CF] = process.argv.slice(2);
const ler = (d, f) => Object.fromEntries(JSON.parse(fs.readFileSync(d + '/' + f + '.json', 'utf8')).nodes.filter(n => n.parameters.jsCode).map(n => [n.name, n.parameters.jsCode]));
const W = d => ({ w1: ler(d, '01_IXC_Notificacoes_WhatsApp'), w2: ler(d, '02_IXC_Lembretes_de_Visita'), w3: ler(d, '03_IXC_Comandos_e_Consulta_de_Escala'), w4: ler(d, '04_Escalas_Sync_Planilha') });
const V = W(A), N = W(B);
const CFG = JSON.parse(fs.readFileSync(CF, 'utf8'));
let ok = 0; const falhas = []; const check = (n, c, x) => { if (c) ok++; else { falhas.push(n); console.log('  ✘', n, x === undefined ? '' : '\n' + x); } };
const clone = x => JSON.parse(JSON.stringify(x));
const off = (cfg, ...ks) => { const c = clone(cfg); c.mensagens = Object.assign({}, c.mensagens || {}); for (const k of ks) c.mensagens[k] = null; return c; };
let k = 10; const fone = () => '55419990000' + String(k++).padStart(2, '0');
const esc = clone(CFG['03:Escala: Buscar Dados']); esc.tecnicos.forEach(t => t.fone = fone()); esc.setores.forEach(s => s.fone = fone());
esc.param.escala_grupos = 'gA@g.us,gR@g.us'; esc.param.setores_grupo = 'gR@g.us';
esc.escala_base.forEach(b => { if (b.tecnicos) b.tecnicos = b.tecnicos.replace(/\(\d{2}\)\s*[\d-]+|55__TELEFONE__/g, '(41) 99999-0001'); });
const PERG = JSON.parse(CFG['03:Carregar Parametros'].perguntas);
check('banco limpo: respostas vazias', CFG['03:Carregar Parametros'].respostas === '[]');
const RESP = [{ chave: 'resp.1', f: ['senha wifi jockey', 'qual a senha do wifi do jockey'], g: 'todos', t: '📶 Wi-fi: *JockeyLojistas*\nDúvidas: (41) 99999-0001' },
  { chave: 'resp.2', f: ['horario do almoxarifado'], g: 'recados', t: 'Abre às 8h.' },
  { chave: 'resp.3', f: ['algum n2 hoje'], g: 'todos', t: 'Resposta fixa do N2.' }];
const PAR = respostas => [{ json: { waha_url: 'http://waha:3000', waha_session: 's1', grupo_automacao: 'gA@g.us', setores_grupo: 'gR@g.us', perguntas: JSON.stringify(PERG), respostas: respostas === undefined ? undefined : JSON.stringify(respostas) } }];
const filtro = (codes, texto, grupo, respostas) => run(codes.w3['Escala: Filtrar Pergunta'], { item: { json: {} }, nodes: {
  'WAHA: Normalizar': [{ json: { data: { key: { remoteJid: grupo || 'gA@g.us', id: 'X1', participant: '5541900000003@c.us', fromMe: false }, message: { conversation: texto } } } }],
  'Carregar Parametros': PAR(respostas) } });
const resposta = (codes, P0, cfg) => run(codes.w3['Escala: Montar Resposta'], { item: { json: {} }, nodes: { 'Escala: Filtrar Pergunta': [{ json: P0 }], 'Escala: Buscar Dados': [{ json: { cfg } }] } });
const pergunta = (codes, t, cfg, g, respostas) => { const f = filtro(codes, t, g, respostas); return f.length ? resposta(codes, f[0].json, cfg) : null; };

// ---------------- WF 03: mensagens novas
let f = filtro(N, 'Bom dia! Qual a senha do Wi-Fi do Jockey?', 'gA@g.us', RESP);
check('filtro: acha a mensagem nova', f.length === 1 && f[0].json.resposta_chave === 'resp.1' && f[0].json.resposta_fixa.startsWith('📶'), JSON.stringify(f));
let r = resposta(N, f[0].json, esc)[0].json;
check('resposta: cabecalho + texto', r.resposta === '🤖 *Resposta automática do bot de escalas*\n\n📶 Wi-fi: *JockeyLojistas*\nDúvidas: @5541999990001', r.resposta);
check('resposta: telefone vira mencao e cita a pergunta', JSON.stringify(r.mentioned) === '["5541999990001"]' && r.quoted.key.id === 'X1' && r.grupo === 'gA@g.us');
check('palavras inteiras (wifijockey nao)', filtro(N, 'senha wifijockey', 'gA@g.us', RESP).length === 0);
check('ordem importa', filtro(N, 'jockey wifi senha', 'gA@g.us', RESP).length === 0);
check('mais de 200 caracteres nao aciona', filtro(N, 'senha wifi jockey ' + 'x'.repeat(200), 'gA@g.us', RESP).filter(x => x.json.resposta_chave).length === 0);
check('so Recados: no Recados aciona', filtro(N, 'qual o horario do almoxarifado?', 'gR@g.us', RESP)[0].json.resposta_chave === 'resp.2');
check('so Recados: em outro grupo nao', filtro(N, 'qual o horario do almoxarifado?', 'gA@g.us', RESP).length === 0);
f = filtro(N, 'algum n2 hoje?', 'gA@g.us', RESP);
check('prioridade sobre setor', f.length === 1 && f[0].json.resposta_chave === 'resp.3' && !f[0].json.setores);
check('sem a mensagem nova: segue setor', (filtro(N, 'algum n2 hoje?', 'gA@g.us', [])[0].json.setores || []).includes('n2'));
f = filtro(N, 'senha wifi jockey', 'gX@g.us', RESP);
check('grupo fora de escala_grupos: filtro acha, resposta nao sai', f.length === 1 && resposta(N, f[0].json, esc).length === 0);
check('comando ixc nao vira resposta fixa', filtro(N, 'ixc senha wifi jockey', 'gA@g.us', RESP).length === 0);
check('cabecalho desativado: so o texto', resposta(N, filtro(N, 'senha wifi jockey', 'gA@g.us', RESP)[0].json, off(esc, 'escala.cabecalho'))[0].json.resposta.startsWith('📶 Wi-fi'));
check('texto vazio: nao responde', resposta(N, Object.assign(filtro(N, 'senha wifi jockey', 'gA@g.us', RESP)[0].json, { resposta_fixa: '  ' }), esc).length === 0);
check('respostas ausente (banco antigo) = 0.4.3', JSON.stringify(filtro(N, 'quem está no jockey?', 'gA@g.us', undefined)) === JSON.stringify(filtro(V, 'quem está no jockey?', 'gA@g.us')));
check('respostas com lixo nao quebra', filtro(N, 'quem está no jockey?', 'gA@g.us', [{ f: null }, { chave: 'x' }]).length === 1);

// ---------------- WF 03: desativadas
const PS = ['quem está no jockey?', 'quem está no palladium curitiba?', 'algum n2?', 'alguém do financeiro?', 'quem ta hoje?', 'quem está em curitiba?'];
for (const t of PS) {
  const a = pergunta(V, t, esc, 'gR@g.us'), b = pergunta(N, t, esc, 'gR@g.us', []);
  check('sem desativar: igual 0.4.3 — ' + t, JSON.stringify(a) === JSON.stringify(b));
}
let x = pergunta(N, 'quem está no jockey?', off(esc, 'escala.cabecalho'), 'gA@g.us', [])[0].json.resposta;
check('cabecalho desativado: sem cabecalho e sem linha em branco no topo', x.startsWith('🏬') || x.startsWith('🏢') || /^\S/.test(x), JSON.stringify(x.slice(0, 40)));
check('… e o resto igual', x === pergunta(V, 'quem está no jockey?', esc, 'gA@g.us')[0].json.resposta.replace('🤖 *Resposta automática do bot de escalas*\n\n', '').replace(/\n{3,}/g, '\n\n').trim());
x = pergunta(N, 'algum n2?', off(esc, 'setor.titulo.n2'), 'gA@g.us', [])[0].json.resposta;
check('titulo do setor desativado: sem a linha, contatos ficam', !/Suporte N2/.test(x) && /👤/.test(x) && !/\n\n\n/.test(x), x);
x = pergunta(N, 'alguém do financeiro?', off(esc, 'setor.ir_recados'), 'gA@g.us', []);
check('ir_recados desativado fora do Recados: nao responde', x.length === 0, JSON.stringify(x));
check('ir_recados ativo: responde', pergunta(N, 'alguém do financeiro?', esc, 'gA@g.us', []).length === 1);
x = pergunta(N, 'quem está no jockey?', off(esc, 'escala.shopping.pessoa'), 'gA@g.us', [])[0].json.resposta;
check('trecho do meio desativado: sem 3 quebras seguidas', !/\n\n\n/.test(x) && !/👤/.test(x), x);

// ---------------- WF 03: comandos ixc
const cmd = clone(CFG['03:IXC Cmd: Carregar']); cmd.tecnicos = esc.tecnicos; cmd.param = Object.assign({}, cmd.param, esc.param);
const interp = (codes, args, cfg) => run(codes.w3['IXC Cmd: Interpretar'], { item: { json: {} }, nodes: { 'IXC Cmd: Filtrar': [{ json: { args, autor: 'x', texto: 'ixc ' + args } }], 'IXC Cmd: Carregar': [{ json: { cfg } }] } })[0].json;
const fin = (codes, d, cfg) => run(codes.w3['IXC Cmd: Finalizar'], { item: { json: {} }, nodes: { 'IXC Cmd: Interpretar': [{ json: d }], 'IXC Cmd: Filtrar': [{ json: { autor: 'x', texto: 't' } }], 'IXC Cmd: Carregar': [{ json: { cfg } }] } });
let d = interp(N, 'blabla xyz', off(cmd, 'cmd.nao_entendi'));
check('cmd desativado: resposta vazia', d.resposta === '', JSON.stringify(d));
check('cmd desativado: Finalizar nao segue (sem "Feito.")', fin(N, d, off(cmd, 'cmd.nao_entendi')).length === 0);
d = interp(N, 'blabla xyz', cmd);
check('cmd ativo: igual 0.4.3', JSON.stringify(fin(N, d, cmd)) === JSON.stringify(fin(V, interp(V, 'blabla xyz', cmd), cmd)) && fin(N, d, cmd).length === 1);
const dN = { acao: { acao: 'numero', fone: '5541999990001' }, resumo: 'número de Fulano', fone_validar: null };
check('cmd.pendente desativado: ainda registra (sql segue)', /registrar_comando/.test(fin(N, dN, off(cmd, 'cmd.pendente'))[0].json.sql));

// ---------------- WF 01: avisos
const c1 = clone(CFG['01:Carregar Config']); c1.param.envio = 'REAL'; c1.mensagens = {};
const montar = (codes, dd, cfg) => run(codes.w1['Montar Mensagem'], { items: [{ json: { registros: [{ assunto: 'Ativação' }] } }], nodes: { 'Rotear': [{ json: dd }], 'Carregar Config': [{ json: { cfg } }] } });
const base1 = { empresa: '4B', id_chamado: '10', evento: '1', grupo_jid: 'g@g.us', marcar: ['5541999990001'], nome: null, shopping: 'Palladium Curitiba', sem_tecnico: false, mensagem: 'Cliente sem sinal.', primeira: true,
  chamado: { protocolo: '202611240001', apartamento: '101', id_condominio: '199' }, cliente: { razao: 'CLIENTE EXEMPLO LTDA', fantasia: 'Loja Exemplo', telefone_celular: '(41) 99999-0002', id_condominio: '199' },
  evento_emoji: '🆕', evento_label: 'Novo chamado', evento_chave: 'aviso.novo', folga: 'F', folga_v: { tecnico: 'Fulano', shopping: 'Palladium Curitiba', plantao: 'Beltrano' } };
check('aviso sem desativar: igual 0.4.3', JSON.stringify(montar(V, base1, c1)) === JSON.stringify(montar(N, base1, c1)));
let t1 = montar(N, base1, off(c1, 'aviso.folga'))[0].json.texto;
check('aviso.folga desativado: sem a linha e sem linha em branco', !/folga/.test(t1) && !/\n\n/.test(t1) && t1.startsWith('🆕'), t1);
t1 = montar(N, base1, off(c1, 'aviso.corpo', 'aviso.folga'))[0].json.texto;
check('corpo desativado: so o cabecalho', t1.split('\n').length === 1 && t1.startsWith('🆕'), t1);
const anexar = (codes, texto, cfg) => run(codes.w1['Anexar Planta'], { items: [{ json: { ok: false } }], nodes: { 'Carregar Config': [{ json: { cfg } }], 'Montar Mensagem': [{ json: { texto, grupo_jid: 'g@g.us', mentioned: [], planta: null } }] } });
check('Anexar Planta: texto vazio nao envia', anexar(N, '', c1).length === 0 && anexar(N, ' \n', c1).length === 0);
check('Anexar Planta: texto normal igual 0.4.3', JSON.stringify(anexar(N, 'oi', c1)) === JSON.stringify(anexar(V, 'oi', c1)));
const cS = clone(c1); cS.param.envio = 'SIMULAR'; cS.param.envio_teste_para = '5541900000001';
check('simulacao igual 0.4.3', JSON.stringify(anexar(N, 'oi', cS)) === JSON.stringify(anexar(V, 'oi', cS)));
check('cabecalho de simulacao desativado: so o texto', anexar(N, 'oi', off(cS, 'envio.simulacao'))[0].json.corpo.text === 'oi');
// Rotear: tipo de aviso desativado = ignorado
const cR = { empresas: [{ id: 'CACTA', nome: 'Cacta' }], tecnicos: [{ empresa: 'CACTA', id_func: '12', nome: 'Juliano', fone: '5541900000012', grupo: null }],
  locais: [{ empresa: 'CACTA', id_condominio: '263', nome: 'Jockey Plaza', grupo: 'gJ@g.us', marcar_sem_tec: [] }], funcionarios: [], param: { aviso_privado: 'nao' }, pendentes: [], lembretes: [], mensagens: {}, escala_hoje: [] };   // modo grupo (0.6.0: padrao = particular)
const rotear = (codes, cfg) => run(codes.w1['Rotear'], { items: [{ json: { registros: [{ id: '5', razao: 'Cli', id_condominio: '263' }] } }], nodes: {
  'Carregar Config': [{ json: { cfg } }],
  'Processar Eventos': [{ json: { empresa: 'CACTA', id_evento: '8', id_chamado: '77', id_tecnico: '12', mensagem: 'x' } }],
  'Buscar Chamado': [{ json: { registros: [{ id: '77', protocolo: 'P77', id_condominio: '263', id_tecnico: '12', id_assunto: '1', data_abertura: '2026-01-01 00:00:00' }] } }] } })[0].json;
const r0 = rotear(N, cR);
check('Rotear ativo: igual 0.4.3', JSON.stringify(r0) === JSON.stringify(rotear(V, cR)) && r0.ignorado === false);
const r1 = rotear(N, off(cR, r0.evento_chave));
check('Rotear: tipo desativado = ignorado com motivo', r1.ignorado === true && r1.motivo === 'aviso desativado no Painel do Bot (' + r0.evento_chave + ')' && r1.id_chamado === '77', JSON.stringify(r1));
check('Rotear: outro tipo desativado nao afeta', rotear(N, off(cR, 'aviso.escalado')).ignorado === false);
const cP = clone(cR); delete cP.param.aviso_privado;   // 0.6.0+: modo particular (padrao)
if (/PRIVADO_/.test(N.w1['Rotear'])) check('Rotear particular: tipo desativado tambem vira ignorado com o motivo', rotear(N, off(cP, r0.evento_chave)).motivo === 'aviso desativado no Painel do Bot (' + r0.evento_chave + ')');

// ---------------- WF 02: lembretes
const c2 = clone(CFG['02:Carregar Config']); c2.param.envio = 'REAL'; c2.param.planta_ativo = 'sim'; c2.mensagens = {};
const lemb = (codes, dd, cfg) => run(codes.w2['Montar Lembrete'], { items: [{ json: { registros: [{ assunto: 'Visita técnica' }] } }], nodes: { 'Rotear Lembrete': [{ json: dd }], 'Carregar Config': [{ json: { cfg } }] } });
const base2 = { empresa: 'PONTO', marcar: ['5549900000002'], grupo_jid: 'g@g.us', shopping: 'Pátio Chapecó', nome: null, sem_tecnico: false,
  cliente: { razao: 'COLCHOES EXEMPLO', fantasia: 'Ortobom', id_condominio: '84', telefone_celular: '(49) 99999-0000' },
  chamado: { id: '1183', protocolo: '1183', data_agenda: '2026-10-28 14:00:00', data_agenda_final: '2026-10-28 15:00:00', id_condominio: '84', apartamento: 'SALA 102', referencia: 'Piso L1' } };
const l1h = Object.assign({}, base2, { tipo: 'lembrete_1h', janela: 'em 1 hora' }), l10 = Object.assign({}, base2, { tipo: 'lembrete_10min', faltam: 10, janela: 'em 10 min' });
check('lembrete sem desativar: igual 0.4.3', JSON.stringify(lemb(N, l1h, c2)) === JSON.stringify(lemb(V, l1h, c2)) && JSON.stringify(lemb(N, l10, c2)) === JSON.stringify(lemb(V, l10, c2)));
check('lembrete 1h desativado: nao sai', lemb(N, l1h, off(c2, 'lembrete.1h')).length === 0);
check('… o de 10 min continua', lemb(N, l10, off(c2, 'lembrete.1h')).length === 1);
const cS2 = clone(c2); cS2.param.envio = 'SIMULAR'; cS2.param.envio_teste_para = '5541900000001';
check('lembrete desativado em SIMULAR tambem nao sai', lemb(N, l10, off(cS2, 'lembrete.10min')).length === 0);
check('lembrete SIMULAR igual 0.4.3', JSON.stringify(lemb(N, l1h, cS2)) === JSON.stringify(lemb(V, l1h, cS2)));

// ---------------- WF 04: alerta
const alerta = (codes, extra) => { const st = { falhas: 2 }; const r = run(codes.w4['Montar Escala'], { item: { json: {} }, static_: st, nodes: {
  'Baixar aba HOJE': [{ json: { data: '<html>erro</html>' } }], 'Carregar Trocas': [{ json: Object.assign({ escala_trocar_nomes: '', escala_ler_porto_belo: 'sim', msg_alerta_planilha: null }, extra) }] } })[0].json; return [r.alerta, st.falhas]; };
check('alerta ativo: igual 0.4.3', JSON.stringify(alerta(N, { alerta_planilha_off: false })) === JSON.stringify(alerta(V, {})) && /falhou 3x/.test(alerta(N, {})[0]));
const al = alerta(N, { alerta_planilha_off: true });
check('alerta desativado: sem alerta, contagem continua', al[0] === null && al[1] === 3);

console.log('ok:', ok, 'falhas:', JSON.stringify(falhas)); process.exit(falhas.length ? 1 : 0);
