// Workflow: Escalas - Sync planilha ESCALAS (aba HOJE) (WAHA)
// No: Montar Escala

// Le a aba HOJE da planilha ESCALAS (export CSV) e monta o SQL de ixc.escala_dia: quem trabalha hoje/amanha
// nos shoppings 12x36 e em Porto Belo/Tijucas. Substitui o script do CT106 (regra de 27/09/2026).
// 3 falhas seguidas -> 1 aviso no grupo de automação.
const st = $getWorkflowStaticData('global');
const PREFIXOS = { 'PALLADIUM CURITIBA': ['4B', '199'], 'FOZ': ['4B', '201'], 'JOCKEY': ['CACTA', '263'], 'CASCAVEL': ['CACTA', '260'] };
const PB = { 'porto belo': ['PONTO', '134'], 'tijucas': ['PONTO', '144'] };

function lerCsv(t) {
  const linhas = []; let lin = [], cel = '', aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') { cel += '"'; i++; }
      else if (c === '"') aspas = false;
      else cel += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { lin.push(cel); cel = ''; }
    else if (c === '\n') { lin.push(cel); linhas.push(lin); lin = []; cel = ''; }
    else if (c !== '\r') cel += c;
  }
  if (cel || lin.length) { lin.push(cel); linhas.push(lin); }
  return linhas;
}
const celula = (v, i, j) => ((v[i] || [])[j] || '').trim();
function achar(v, texto) {
  for (let i = 0; i < v.length; i++) for (let j = 0; j < v[i].length; j++)
    if (v[i][j].trim().toUpperCase().startsWith(texto.toUpperCase())) return [i, j];
  return null;
}
const hojeIso = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10);
const addDia = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function dataDe(txt) {  // "27/09" -> ISO, ano pelo mais proximo de hoje
  const m = String(txt).match(/^(\d{1,2})\/(\d{1,2})/);
  if (!m) throw new Error('data inválida no cabeçalho: "' + txt + '"');
  const [y, mes] = [+hojeIso.slice(0, 4), +hojeIso.slice(5, 7)];
  const ano = y + (+m[2] < mes - 6 ? 1 : +m[2] > mes + 6 ? -1 : 0);
  return ano + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
}
const titulo = s => s.toLowerCase().replace(/(^|\s)\S/g, x => x.toUpperCase());

try {
  const r = $('Baixar aba HOJE').first().json;
  let txt = typeof r.data === 'string' ? r.data : '';
  // 0.1.1: parametro escala_trocar_nomes = 'Quem Saiu=Quem Cobre;Outro=Substituto' (nome inteiro, sem diferenciar maiusculas)
  // 0.1.2: validade opcional 'De=Para@AAAA-MM-DD' (a troca vale ate essa data, inclusive; depois e ignorada sozinha)
  const trocasTxt = String((($('Carregar Trocas').first() || {}).json || {}).escala_trocar_nomes || '');
  for (const par of trocasTxt.split(';').map(x => x.trim()).filter(Boolean)) {
    const [regra, ate] = par.split('@').map(x => (x || '').trim());
    if (ate && /^\d{4}-\d{2}-\d{2}$/.test(ate) && hojeIso > ate) continue;
    const [de, para] = regra.split('=').map(x => (x || '').trim());
    if (!de || !para) continue;
    txt = txt.replace(new RegExp('(^|[^\\p{L}])' + de.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}])', 'giu'), '$1' + para);
  }
  if (!txt || /<html/i.test(txt.slice(0, 300))) throw new Error('a planilha não devolveu CSV (acesso mudou?)' + (r.error ? ': ' + JSON.stringify(r.error).slice(0, 150) : ''));
  const v = lerCsv(txt);
  const linhas = [];
  for (const cab of ['QUEM TRABALHA HOJE', 'QUEM TRABALHA AMANH']) {
    const p = achar(v, cab);
    if (!p) throw new Error('cabeçalho não encontrado: ' + cab);
    const [i, j] = p, dia = dataDe(celula(v, i, j + 1));
    for (let k = i + 1; celula(v, k, j) && !celula(v, k, j).startsWith('#'); k++) {
      const t = celula(v, k, j);
      const [pre, nome = ''] = t.split(/\s*-\s*/);
      const loc = PREFIXOS[pre.trim().toUpperCase()];
      if (!loc || !nome.trim()) throw new Error('linha não reconhecida na aba HOJE: ' + t);
      linhas.push([dia, loc[0], loc[1], titulo(nome.replace('(N2)', '').replace(/\s+/g, ' ').trim())]);
    }
  }
  for (const [cab, delta] of [['Hoje em Porto Belo', 0], ['Amanhã em Porto Belo', 1]]) {
    const p = achar(v, cab);
    if (!p) { if (delta === 0) throw new Error('cabeçalho não encontrado: ' + cab); continue; }
    const t = celula(v, p[0] + 1, p[1]);
    if (!t) continue;
    // Formatos: "X atende Porto Belo e Tijucas" | "X em/atende Porto Belo e Y em/atende Tijucas" | "Ninguém".
    // (A troca fixa de nome que existia aqui foi removida em 27/10/2026: a formula da aba HOJE foi corrigida em 03/10.)
    const t2 = t;
    if (/^ningu/i.test(t2)) continue;
    const m = t2.match(/^(.+?)\s+(?:em|atende)\s+Porto Belo\s+e\s+(.+?)\s+(?:em|atende)\s+Tijucas/i);
    const pares = m ? [[PB['porto belo'], m[1]], [PB['tijucas'], m[2]]]
      : Object.entries(PB).filter(([k]) => t2.toLowerCase().includes(k)).map(([, loc]) => [loc, t2.split(' atende')[0]]);
    for (const [loc, nome] of pares) linhas.push([addDia(hojeIso, delta), loc[0], loc[1], nome.trim()]);
  }
  if (!linhas.length) throw new Error('nenhum técnico lido da aba HOJE');
  const lit = s => "'" + String(s).replace(/'/g, "''") + "'";
  const dias = [...new Set(linhas.map(l => l[0]))];
  const sql = 'BEGIN;\nDELETE FROM ixc.escala_dia WHERE data IN (' + dias.map(lit).join(',') + ');\n' +
    linhas.map(l => "INSERT INTO ixc.escala_dia (data, empresa, id_condominio, tecnico, fonte) VALUES (" + l.map(lit).join(',') + ", 'planilha ESCALAS aba HOJE (n8n)') ON CONFLICT DO NOTHING;").join('\n') +
    '\nCOMMIT;';
  st.falhas = 0;
  return [{ json: { sql, resumo: linhas.map(l => l.join(' ')).join('; '), alerta: null } }];
} catch (e) {
  st.falhas = (st.falhas || 0) + 1;
  return [{ json: { sql: 'SELECT 1', resumo: 'FALHA ' + st.falhas + ': ' + e.message,
    alerta: st.falhas === 3 ? '⚠️ Leitura da planilha ESCALAS falhou 3x seguidas (quem está no shopping pode ficar desatualizado): ' + e.message : null } }];
}

