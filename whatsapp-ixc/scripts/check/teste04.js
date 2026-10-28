// WF 04: leitura da aba HOJE (CSV sintetico, nomes ficticios) e trocas de nome (escala_trocar_nomes)
const fs = require('fs'); const { run } = require('./harness');
const dir = process.argv[2] || 'n8n';
const w = JSON.parse(fs.readFileSync(dir + '/04_Escalas_Sync_Planilha.json', 'utf8'));
const code = Object.fromEntries(w.nodes.filter(n => n.parameters.jsCode).map(n => [n.name, n.parameters.jsCode]));
const hoje = new Date(); const amanha = new Date(hoje.getTime() + 86400000);
const dm = d => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
const csv = [
  '"","","QUEM TRABALHA HOJE","' + dm(hoje) + '","","","QUEM TRABALHA AMANHÃ","' + dm(amanha) + '","","","Hoje em Porto Belo e Tijucas","","Amanhã em Porto Belo e Tijucas"',
  '"","","PALLADIUM CURITIBA- ALFA  (N2)","","","","PALLADIUM CURITIBA - BRAVO (N2)","","","","Saiu atende Porto Belo e Tijucas","","Saiu atende Porto Belo e Cobre atende Tijucas"',
  '"","","JOCKEY - CHARLIE ","","","","JOCKEY - DELTA","","","","","",""',
  '"","","FOZ - ECHO ","","","","FOZ - FOXTROT","","","","","",""',
  '"","","CASCAVEL - GOLF ","","","","CASCAVEL - HOTEL","","","","","",""',
].join('\n');
let ok = 0, falhas = []; const check = (n, c) => c ? ok++ : falhas.push(n);
const nodes = (trocas) => ({ 'Baixar aba HOJE': [{ json: { data: csv } }], 'Carregar Trocas': [{ json: { escala_trocar_nomes: trocas } }] });
let r = run(code['Montar Escala'], { item: { json: {} }, nodes: nodes('Saiu=Cobre'), static_: {} });
check('quem saiu nao aparece', !/'Saiu'/.test(r[0].json.sql));
check('Porto Belo e Tijucas com quem cobre (4x)', (r[0].json.sql.match(/'Cobre'/g) || []).length === 4);
check('12x36 lidos', /'4B','199','Alfa'/.test(r[0].json.sql) && /'CACTA','260','Hotel'/.test(r[0].json.sql) && /'4B','201','Foxtrot'/.test(r[0].json.sql));
check('sem alerta', r[0].json.alerta === null);
const iso = d => d.toISOString().slice(0, 10);
r = run(code['Montar Escala'], { item: { json: {} }, nodes: nodes('Saiu=Cobre@' + iso(amanha)), static_: {} });
check('troca com validade futura vale', !/'Saiu'/.test(r[0].json.sql));
r = run(code['Montar Escala'], { item: { json: {} }, nodes: nodes('Saiu=Cobre@' + iso(new Date(hoje.getTime() - 86400000))), static_: {} });
check('troca vencida e ignorada', /'PONTO','134','Saiu'/.test(r[0].json.sql));
r = run(code['Montar Escala'], { item: { json: {} }, nodes: nodes('Alfa=Zulu@' + iso(hoje) + ';Saiu=Cobre'), static_: {} });
check('vale ate a data inclusive + combinacao', /'4B','199','Zulu'/.test(r[0].json.sql) && /'Cobre'/.test(r[0].json.sql));
r = run(code['Montar Escala'], { item: { json: {} }, nodes: nodes(''), static_: {} });
check('sem trocas = planilha como esta', /'PONTO','134','Saiu'/.test(r[0].json.sql));
r = run(code['Montar Escala'], { item: { json: {} }, nodes: { 'Baixar aba HOJE': [{ json: { data: '<html>login' } }], 'Carregar Trocas': [{ json: { escala_trocar_nomes: '' } }] }, static_: { falhas: 2 } });
check('3a falha gera alerta', r[0].json.alerta && r[0].json.alerta.startsWith('⚠️'));
console.log('ok:', ok, 'falhas:', falhas); process.exit(falhas.length ? 1 : 0);
