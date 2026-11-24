// Texto editado no Painel do Bot (ixc.mensagens) vale no aviso seguinte, pelo simulador.
const { execSync } = require('child_process');
const psql = q => execSync(`PGPASSWORD=ixcteste psql -h 127.0.0.1 -p 5499 -U ixc -d ixc -tAc "${q}"`).toString().trim();
const B = 'http://127.0.0.1:3999', H = { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from('sim:abc').toString('base64') };
const post = async (p, b) => (await fetch(B + p, { method: 'POST', headers: H, body: JSON.stringify(b) })).json();
const get = async p => (await fetch(B + p, { headers: H })).json();
const espera = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let ok = 0; const f = [];
  psql("UPDATE ixc.mensagens SET texto = '📣 CHAMADO NOVO (editado no painel) — {marcados}' WHERE chave = 'aviso.novo'");
  const cad = await get('/sim/cadastro'); const loc = cad.locais.find(l => l.empresa === 'PONTO'); const tec = cad.tecnicos.find(t => t.empresa === 'PONTO' && t.fone);
  const seq = (await get('/sim/estado')).seq;
  const c = await post('/sim/chamado', { empresa: 'PONTO', id_condominio: loc.id, id_tecnico: tec.id, id_assunto: '990002', loja: '144' });
  await post('/sim/rodar', { wf: '01' }); await espera(8000);
  const m = (await get('/sim/estado?desde=' + seq)).msgs.filter(x => x.fromMe);
  (m.some(x => x.texto.startsWith('📣 CHAMADO NOVO (editado no painel) — @')) ? ok++ : f.push('texto editado'));
  psql("UPDATE ixc.mensagens SET texto = NULL WHERE chave = 'aviso.novo'");
  console.log(m.map(x => x.texto).join('\n--\n'));
  console.log('ok:', ok, 'falhas:', JSON.stringify(f)); process.exit(f.length ? 1 : 0);
})();
