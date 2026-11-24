// Ponta a ponta (simulador + n8n + banco de teste): técnico 12x36 renomeado no painel aparece com o nome novo.
const { execSync } = require('child_process');
const psql = q => execSync(`PGPASSWORD=ixcteste psql -h 127.0.0.1 -p 5499 -U ixc -d ixc -tAc "${q}"`).toString().trim();
const B = 'http://127.0.0.1:3999', H = { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from('sim:abc').toString('base64') };
const post = async (p, b) => (await fetch(B + p, { method: 'POST', headers: H, body: JSON.stringify(b) })).json();
const get = async p => (await fetch(B + p, { headers: H })).json();
const espera = ms => new Promise(r => setTimeout(r, ms));
let ok = 0; const f = []; const check = (n, c, x) => { if (c) ok++; else { f.push(n); console.log('  ✘', n, x || ''); } };
(async () => {
  psql("DELETE FROM ixc.tecnicos WHERE id_func IN ('99911','99912'); INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone) VALUES ('4B','99911','Juliano Teste','5541900000911'),('4B','99912','Outro Teste','5541900000912')");
  psql("DELETE FROM ixc.escala_dia WHERE empresa='4B' AND id_condominio='199' AND data=(now() AT TIME ZONE 'America/Sao_Paulo')::date; INSERT INTO ixc.escala_dia (data, empresa, id_condominio, tecnico) VALUES ((now() AT TIME ZONE 'America/Sao_Paulo')::date,'4B','199','Juliano')");
  const cad = await get('/sim/cadastro?recarregar=1');
  const auto = Object.values(cad.grupos).find(g => g.nomes.includes('Automação (comandos ixc)')).jid;
  const pergunta = async () => { const s = (await get('/sim/estado')).seq; await post('/sim/enviar', { chat: auto, texto: 'quem está no palladium curitiba?', fone: '5541900000001', nome: 'T' }); await espera(5000); return ((await get('/sim/estado?desde=' + s)).msgs.find(m => m.fromMe && !m.usuario) || {}).texto || ''; };
  let r = await pergunta();
  check('mostra o nome do cadastro', /👤 Juliano Teste — @5541900000911/.test(r), r);
  psql("UPDATE ixc.tecnicos SET nome='Mirandinha', nome_planilha='Juliano' WHERE id_func='99911'");
  r = await pergunta();
  check('renomeado no painel: nome novo', /👤 Mirandinha — @5541900000911/.test(r), r);
  // aviso: chamado atribuido ao renomeado no 12x36 -> sem "folga" falsa
  const s = (await get('/sim/estado')).seq;
  await post('/sim/chamado', { empresa: '4B', id_condominio: '199', id_tecnico: '99911', id_assunto: '990001' });
  const x = await post('/sim/rodar', { wf: '01' });
  check('resumo do botão', /WF 01: \d+ empresas consultadas · [1-9]\d* evento/.test(x.resumo || ''), x.resumo);
  const av = (await get('/sim/estado?desde=' + s)).msgs.filter(m => m.fromMe).map(m => m.texto).join('\n');
  check('aviso sem folga falsa', /Novo chamado — @5541900000911/.test(av) && !/folga/.test(av), av);
  const y = await post('/sim/rodar', { wf: '01' });
  check('resumo sem nada novo', /0 evento\(s\) novo\(s\).*0 mensagens enviadas/.test(y.resumo || ''), y.resumo);
  psql("DELETE FROM ixc.tecnicos WHERE id_func IN ('99911','99912')");
  console.log('ok:', ok, 'falhas:', JSON.stringify(f)); process.exit(f.length ? 1 : 0);
})();
