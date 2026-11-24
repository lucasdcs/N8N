// Ponta a ponta: simulador + n8n local com os 4 workflows [SIM] publicados + banco de teste local.
const B = 'http://127.0.0.1:3999', H = { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from('sim:abc').toString('base64') };
let ok = 0; const falhas = []; const check = (n, c, extra) => { if (c) ok++; else { falhas.push(n); if (extra) console.log('  ✘', n, extra); } };
const post = async (p, b) => (await fetch(B + p, { method: 'POST', headers: H, body: JSON.stringify(b) })).json();
const get = async p => (await fetch(B + p, { headers: H })).json();
const espera = ms => new Promise(r => setTimeout(r, ms));
let seq = 0;
async function novas(ms) { await espera(ms); const st = await get('/sim/estado?desde=' + seq); seq = st.seq; return st.msgs.filter(m => m.fromMe && !m.usuario); }
(async () => {
  await post('/sim/limpar', { o: 'ixc' }); await post('/sim/limpar', { o: 'conversas' });
  const cad = await get('/sim/cadastro?recarregar=1');
  const auto = Object.values(cad.grupos).find(g => g.nomes.includes('Automação (comandos ixc)')).jid;
  seq = (await get('/sim/estado')).seq;
  // WF 03: pergunta de escala
  let m = await post('/sim/enviar', { chat: auto, texto: 'quem está no jockey?', fone: '5541900000001', nome: 'Teste' });
  check('webhook WF03 200', m.n8n === 200, m.n8n_erro);
  let r = await novas(5000);
  check('WF03 respondeu a escala', r.length === 1 && /Jockey/i.test(r[0].texto) && r[0].chat === auto, JSON.stringify(r).slice(0, 300));
  check('resposta cita a pergunta', r[0] && r[0].reply_to === m.id, r[0] && r[0].reply_to);
  console.log('---- escala:\n' + (r[0] || {}).texto);
  // WF 03: comando
  await post('/sim/enviar', { chat: auto, texto: 'ixc ajuda', fone: '5541900000001', nome: 'Teste' });
  r = await novas(5000);
  check('ixc ajuda respondeu', r.length === 1 && /ixc/i.test(r[0].texto), JSON.stringify(r).slice(0, 200));
  // comando com numero -> check-exists
  const tec = cad.tecnicos.find(t => t.empresa === '4B' && t.fone);
  await post('/sim/enviar', { chat: auto, texto: 'ixc cancelar', fone: '5541900000001', nome: 'Teste' }); await novas(3000);
  // WF 01: chamado com tecnico
  const loc = cad.locais.find(l => l.empresa === '4B');
  const c1 = await post('/sim/chamado', { empresa: '4B', id_condominio: loc.id, id_assunto: '990001', id_tecnico: tec.id, loja: '102', mensagem: 'Sem internet na loja', cliente: 'Loja Teste' });
  let x = await post('/sim/rodar', { wf: '01' }); check('rodar 01 = 200', x.status === 200, JSON.stringify(x));
  r = await novas(8000);
  check('aviso de novo chamado no grupo do shopping', r.length >= 1 && r.some(z => z.chat === loc.grupo && /Novo chamado/.test(z.texto) && z.texto.includes(c1.protocolo)), JSON.stringify(r).slice(0, 400));
  check('aviso marca o tecnico', r.some(z => (z.mentions || []).includes(tec.fone.replace(/\D/g, '') + '@c.us')), JSON.stringify(r.map(z => z.mentions)));
  console.log('---- aviso:\n' + ((r.find(z => /Novo/.test(z.texto)) || {}).texto));
  // rodar de novo: nada novo
  await post('/sim/rodar', { wf: '01' }); r = await novas(7000);
  check('sem repeticao', r.length === 0, JSON.stringify(r).slice(0, 300));
  // transferir
  const tec2 = cad.tecnicos.find(t => t.empresa === '4B' && t.fone && t.id !== tec.id);
  await post('/sim/acao', { empresa: '4B', id: c1.id, acao: 'envelhecer', minutos: 30 });
  await post('/sim/acao', { empresa: '4B', id: c1.id, acao: 'transferir', id_tecnico: tec2.id });
  await post('/sim/rodar', { wf: '01' }); r = await novas(8000);
  check('aviso de transferido', r.some(z => /transferido/i.test(z.texto)), JSON.stringify(r).slice(0, 300));
  // sem tecnico 12 min
  const c2 = await post('/sim/chamado', { empresa: '4B', id_condominio: loc.id, id_assunto: '990001', id_tecnico: '0', aberto_ha: 12, mensagem: 'Ninguém pegou' });
  await post('/sim/rodar', { wf: '01' }); r = await novas(8000);
  check('aviso sem tecnico', r.some(z => /sem técnico/.test(z.texto) && z.texto.includes(c2.protocolo)), JSON.stringify(r).slice(0, 400));
  // WAHA fora -> falha gravada; volta -> reenvio
  await post('/sim/acao', { empresa: '4B', id: c2.id, acao: 'assumir', id_tecnico: tec.id });
  await post('/sim/opcoes', { wahaFora: true });
  await post('/sim/rodar', { wf: '01' }); r = await novas(8000);
  check('com WAHA fora nada chega', r.length === 0);
  await post('/sim/opcoes', { wahaFora: false });
  await post('/sim/rodar', { wf: '01' }); r = await novas(9000);
  check('reenvio depois que o WAHA volta', r.some(z => /assumido/i.test(z.texto)), JSON.stringify(r).slice(0, 300));
  // WF 02: lembrete de 1h e de 10 min
  await post('/sim/acao', { empresa: '4B', id: c1.id, acao: 'agendar', minutos: 55 });
  await post('/sim/acao', { empresa: '4B', id: c2.id, acao: 'agendar', minutos: 8 });
  x = await post('/sim/rodar', { wf: '02' }); r = await novas(9000);
  check('lembretes (2)', r.length === 2, JSON.stringify(r).slice(0, 500));
  check('lembrete no particular do tecnico', r.some(z => z.chat.endsWith('@c.us')), JSON.stringify(r.map(z => z.chat)));
  console.log('---- lembretes:\n' + r.map(z => z.chat + ': ' + z.texto).join('\n--\n'));
  await post('/sim/rodar', { wf: '02' }); r = await novas(7000);
  check('lembrete nao repete', r.length === 0);
  console.log('ok:', ok, 'falhas:', JSON.stringify(falhas)); process.exit(falhas.length ? 1 : 0);
})();
