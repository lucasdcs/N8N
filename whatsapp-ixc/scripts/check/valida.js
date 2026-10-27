// Valida sintaxe dos nos de codigo e das expressoes ={{ }} dos JSON adaptados
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2]; let erros = 0, n = 0, e = 0;
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
  const w = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const nomes = new Set(w.nodes.map(x => x.name));
  for (const [k, v] of Object.entries(w.connections)) {
    if (!nomes.has(k)) { console.log(`${f}: conexao de no inexistente: ${k}`); erros++; }
    for (const o of v.main || []) for (const c of o) if (!nomes.has(c.node)) { console.log(`${f}: conexao para no inexistente: ${c.node}`); erros++; }
  }
  for (const nd of w.nodes) {
    const p = nd.parameters || {};
    if (p.jsCode) { n++; try { new vm.Script(`(async function(){\n${p.jsCode}\n})`, { filename: `${f}::${nd.name}` }); } catch (ex) { erros++; console.log(`${f} :: ${nd.name}: ${ex.message}`); } }
    const exprs = [];
    const walk = (x) => { if (typeof x === 'string') { for (const m of x.matchAll(/\{\{([\s\S]*?)\}\}/g)) exprs.push(m[1]); } else if (x && typeof x === 'object') Object.values(x).forEach(walk); };
    walk(p);
    for (const ex of exprs) { e++; try { new vm.Script(`(${ex})`, { filename: `${f}::${nd.name}::expr` }); } catch (er) { erros++; console.log(`${f} :: ${nd.name} :: expressao: ${er.message}\n   ${ex.slice(0, 200)}`); } }
    // referencias $('Nome') apontam para nos existentes?
    for (const m of JSON.stringify(p).matchAll(/\$\('([^']+)'\)/g)) if (!nomes.has(m[1])) { erros++; console.log(`${f} :: ${nd.name}: referencia a no inexistente $('${m[1]}')`); }
  }
}
console.log(`nos de codigo: ${n}, expressoes: ${e}, erros: ${erros}`);
process.exit(erros ? 1 : 0);
