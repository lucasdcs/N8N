// Workflow: WhatsApp - Comandos ixc e consulta de escala (WAHA)
// No: Escala: Montar Resposta

// Interpreta o comando "ixc ..." de forma deterministica (sem IA) contra a config do banco (schema ixc).
// Saida: { resposta } para consulta/erro, ou { acao, resumo } para registrar pendente, ou { aplicar/cancelar: true }.
let cfg = $('Escala: Buscar Dados').first().json.cfg;
if (typeof cfg === 'string') cfg = JSON.parse(cfg);
const f = { args: '' };
const args = f.args;
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const A = norm(args);
const EMP = Object.fromEntries((cfg.empresas || []).map(e => [e.id, e.nome]));
const TEC = cfg.tecnicos || [], LOC = cfg.locais || [], P = cfg.param || {};
const out = o => [{ json: Object.assign({ resposta: null, acao: null, resumo: null, aplicar: false, cancelar: false, fone_validar: null }, o) }];

const AJUDA = [
  '🛠️ *Comandos IXC* (só valem depois de *ixc ok*)',
  '',
  '*ixc lista* [empresa ou shopping] — quem é marcado em cada shopping',
  '*ixc tecnicos* [empresa] — técnicos e números',
  '*ixc quem* <shopping ou técnico> — quem atende, horário, hoje e amanhã (*ixc quem hoje* = todos)',
  '',
  '*ixc shopping* <shopping> *tecnico* <técnico> — troca o técnico do shopping',
  '*ixc numero* <técnico> <telefone> — troca o número do técnico',
  '*ixc incluir* <técnico ou telefone> *em* <shopping> — marca também essa pessoa quando o chamado ficar sem técnico',
  '*ixc remover* <técnico ou telefone> *de* <shopping>',
  '*ixc novo tecnico* <empresa> <id no IXC> <nome> <telefone>',
  '',
  '*ixc ok* — aplica a alteração pendente · *ixc cancelar* — descarta',
  '',
  'Ex.: _ixc shopping Tijucas tecnico Joao_ · _ixc numero Fulano 41 99999-0000_',
].join('\n');

function fmtFone(x) {
  const d = String(x || '').replace(/\D/g, '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : d;
}
function lerFone(s) {
  let d = String(s || '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return /^55\d{10,11}$/.test(d) ? d : null;
}
function nomeFone(emp, fone) {
  const t = TEC.find(t => t.fone === fone && (!emp || t.empresa === emp)) || TEC.find(t => t.fone === fone);
  if (t) return t.nome;
  if (fone === P.supervisor_fone) return (P.supervisor_nome || 'Supervisor') + ' (supervisor)';
  if (fone === P.coordenador_fone) return (P.coordenador_nome || 'Coordenador') + ' (coordenador)';
  return fmtFone(fone);
}
// Acha 1 shopping pelo nome (aceita "4B Palladium" pra desambiguar)
function acharLocal(q, emp) {
  let s = norm(q);
  if (!s) return { erro: 'Faltou o shopping.' };
  const pref = Object.keys(EMP).find(e => s.startsWith(norm(e) + ' '));
  if (pref && !emp) { emp = pref; s = s.slice(norm(pref).length + 1); }
  const cand = LOC.filter(l => !emp || l.empresa === emp);
  let hits = cand.filter(l => norm(l.nome) === s);
  if (!hits.length) hits = cand.filter(l => norm(l.nome).includes(s));
  if (!hits.length) hits = cand.filter(l => s.split(' ').every(p => norm(l.nome).includes(p)));
  if (hits.length === 1) return { loc: hits[0] };
  if (!hits.length) return { erro: 'Não achei o shopping "' + q + '". Veja os nomes com *ixc lista*.' };
  return { erro: 'Mais de um shopping bate com "' + q + '":\n' + hits.map(l => '• ' + l.empresa + ' ' + l.nome).join('\n') + '\nEscreva com a empresa na frente, ex.: _' + hits[0].empresa + ' ' + hits[0].nome + '_' };
}
// Acha 1 tecnico pelo nome (opcionalmente dentro de uma empresa)
function acharTec(q, emp) {
  let s = norm(q);
  if (!s) return { erro: 'Faltou o técnico.' };
  const pref = Object.keys(EMP).find(e => s.startsWith(norm(e) + ' '));
  if (pref && !emp) { emp = pref; s = s.slice(norm(pref).length + 1); }
  const cand = TEC.filter(t => !emp || t.empresa === emp);
  let hits = cand.filter(t => norm(t.nome) === s);
  if (!hits.length) hits = cand.filter(t => s.split(' ').every(p => norm(t.nome).split(' ').some(w => w.startsWith(p))));
  if (hits.length === 1) return { tec: hits[0] };
  if (!hits.length) return { erro: 'Não achei o técnico "' + q + '"' + (emp ? ' na ' + emp : '') + '. Veja com *ixc tecnicos*' + (emp ? ' ' + emp : '') + ' (técnico novo: *ixc novo tecnico*).' };
  return { erro: 'Mais de um técnico bate com "' + q + '":\n' + hits.map(t => '• ' + t.empresa + ' ' + t.nome).join('\n') + '\nEscreva o nome completo ou com a empresa na frente.' };
}
function lerData(s) {
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const hoje = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  let y = m[3] ? +m[3] : hoje.getFullYear();
  if (y < 100) y += 2000;
  const d = new Date(Date.UTC(y, +m[2] - 1, +m[1]));
  if (d.getUTCDate() !== +m[1] || d.getUTCMonth() !== +m[2] - 1) return null;
  if (!m[3] && d < Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) d.setUTCFullYear(y + 1);
  return d.toISOString().slice(0, 10);
}
const brData = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
const locTxt = l => l.nome + ' (' + l.empresa + ')';
// separa "X em Y" / "X de Y" pelo ULTIMO separador (nome de shopping nao costuma ter " em ")
function dividir(s, sep) {
  const i = s.toLowerCase().lastIndexOf(' ' + sep + ' ');
  return i < 0 ? null : [s.slice(0, i).trim(), s.slice(i + sep.length + 2).trim()];
}

// ---- ixc quem: tecnico x shopping x horario (escala_base + escala_dia sincronizada da planilha ESCALAS) ----
const EB = Object.fromEntries((cfg.escala_base || []).map(b => [b.empresa + ':' + b.id_condominio, b]));
const ED = cfg.escala_dia || [];
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const DIAS_TXT = { dom: 'dom', seg: 'seg', ter: 'ter', qua: 'qua', qui: 'qui', sex: 'sex', sab: 'sáb' };
const [hojeIso, horaAgora] = String(cfg.hoje || '').split(' ');
const addDia = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diaSem = iso => DIAS[new Date(iso + 'T12:00:00Z').getUTCDay()];
const ddmm = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const hfmt = h => h ? h.replace('-', '–') : null;
function foneDe(nome, loc, b) {
  const n = norm(nome);
  const m = String((b && b.tecnicos) || '').split(';').map(x => x.trim()).find(x => norm(x).startsWith(n.split(' ')[0]));
  const f = m && m.match(/\(\d{2}\)\s*[\d-]+/);
  if (f) return f[0];
  const t = TEC.find(t => t.empresa === loc.empresa && norm(t.nome).split(' ')[0] === n.split(' ')[0]);
  return t && t.fone ? fmtFone(t.fone) : '';
}
function quemNoDia(loc, iso) {
  const b = EB[loc.empresa + ':' + loc.id_condominio] || {};
  if (b.tipo === '12x36' || b.tipo === 'escala') {
    const ns = ED.filter(d => d.empresa === loc.empresa && d.id_condominio === loc.id_condominio && String(d.data).slice(0, 10) === iso).map(d => d.tecnico);
    if (ns.length) return ns.map(n => n + ' ' + foneDe(n, loc, b)).join(' / ').trim();
    return b.tecnicos ? b.tecnicos.replace(/;/g, ' /') : '_(escala do dia não encontrada na planilha)_';  // sem escala do dia -> equipe da escala base
  }
  const tp = TEC.find(t => t.empresa === loc.empresa && t.id_func === loc.tec_padrao);
  if (tp) return tp.nome + (tp.fone ? ' ' + fmtFone(tp.fone) : '');
  return b.tecnicos ? b.tecnicos.replace(/;/g, ' /') : 'sem técnico cadastrado';
}
function statusAgora(h) {
  if (!h) return '';
  const [ini, fim] = h.split('-');
  if (horaAgora < ini) return ' · ⏳ começa às ' + ini;
  if (horaAgora <= fim) return ' · 🟢 em atendimento (até ' + fim + ')';
  return ' · 🔴 encerrou às ' + fim;
}
function semana(b) {
  const ordem = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'], grupos = [];
  for (const d of ordem) {
    const h = b[d] || null, g = grupos[grupos.length - 1];
    if (g && g.h === h) g.fim = d; else grupos.push({ ini: d, fim: d, h });
  }
  return grupos.filter(g => g.h).map(g => DIAS_TXT[g.ini] + (g.fim !== g.ini ? '–' + DIAS_TXT[g.fim] : '') + ' ' + hfmt(g.h)).join(' · ') || 'sem horário cadastrado';
}
function linhaDia(loc, iso, agora) {
  const b = EB[loc.empresa + ':' + loc.id_condominio] || {};
  const h = b[diaSem(iso)];
  const rot = '*' + (agora ? 'Hoje' : 'Amanhã') + ' (' + DIAS_TXT[diaSem(iso)] + ' ' + ddmm(iso) + ')*';
  if (!h) return rot + ': não atende';
  const pessoas = quemNoDia(loc, iso).split(' / ').map(x => '👤 ' + x.trim().replace(/ (\(\d{2}\))/, ' — $1')).join('\n');
  return rot + ' — ' + hfmt(h) + (agora ? statusAgora(h) : '') + '\n' + pessoas;
}
// proximo dia (a partir de depois de amanha) em que o shopping atende - pra sempre mostrar o tecnico
function proximoDia(loc, de) {
  const b = EB[loc.empresa + ':' + loc.id_condominio] || {};
  for (let i = de; i <= 7; i++) { const iso = addDia(hojeIso, i); if (b[diaSem(iso)]) return iso; }
  return null;
}
function pessoasDe(loc, iso) {
  return quemNoDia(loc, iso).split(' / ').map(x => '👤 ' + x.trim().replace(/ (\(\d{2}\))/, ' — $1')).join('\n');
}
function detalheLocal(loc) {
  const b = EB[loc.empresa + ':' + loc.id_condominio] || {};
  const linhas = ['🏬 *' + loc.nome + '* (' + (EMP[loc.empresa] || loc.empresa) + ')' + (b.tipo === '12x36' ? ' · 12x36' : ''),
    linhaDia(loc, hojeIso, true), '\n', linhaDia(loc, addDia(hojeIso, 1), false)];  // blocos separados (formato de 02/10)
  if (!b[diaSem(hojeIso)] && !b[diaSem(addDia(hojeIso, 1))]) {
    const px = proximoDia(loc, 2);
    if (px) linhas.push('\n', '*Próximo atendimento (' + DIAS_TXT[diaSem(px)] + ' ' + ddmm(px) + ')* — ' + hfmt(b[diaSem(px)]) + '\n' + pessoasDe(loc, px));
  }
  return linhas.concat(['Horário: ' + semana(b)]).concat(b.obs ? ['_' + b.obs + '_'] : []).join('\n');
}
function quem(q) {
  q = String(q || '').replace(/[?!.]+\s*$/, '').replace(/^\s*(e|é|esta|está|ta|tá|atende|trabalha|fica|ficou)?\s*(hoje\s+)?(no|na|em|o|a|do|da)?\s+/i, ' ').trim();
  if (/\s(hoje|amanh[aã]|agora)$/i.test(q)) q = q.replace(/\s+(hoje|amanh[aã]|agora)$/i, '').trim();
  const s = norm(q);
  if (!s || s === 'hoje' || s === 'agora') {
    const linhas = ['👷 *Quem atende hoje* (' + DIAS_TXT[diaSem(hojeIso)] + ' ' + ddmm(hojeIso) + ', ' + horaAgora + ')'];
    let e0 = null;
    for (const l of LOC.slice().sort((a, b) => (a.empresa + a.nome).localeCompare(b.empresa + b.nome))) {
      if (l.empresa !== e0) { e0 = l.empresa; linhas.push('', '*' + (EMP[e0] || e0) + '*'); }
      const b = EB[l.empresa + ':' + l.id_condominio] || {}, h = b[diaSem(hojeIso)];
      linhas.push('• ' + l.nome + ': ' + (h ? quemNoDia(l, hojeIso).replace(/ \(\d{2}\)\s*[\d-]+/g, '') + ' ' + hfmt(h) + statusAgora(h).replace(/^ · /, ' ') : 'não atende hoje'));
    }
    return linhas.join('\n');
  }
  const r = acharLocal(q);
  if (r.loc) return detalheLocal(r.loc);
  // tecnico: onde aparece (tecnico padrao, lista da escala base ou escala do dia)
  const primeiro = s.split(' ')[0];
  const locs = LOC.filter(l => {
    const b = EB[l.empresa + ':' + l.id_condominio] || {};
    const tp = TEC.find(t => t.empresa === l.empresa && t.id_func === l.tec_padrao);
    const nomes = [tp ? tp.nome : '', b.tecnicos || ''].concat(ED.filter(d => d.empresa === l.empresa && d.id_condominio === l.id_condominio).map(d => d.tecnico));
    return nomes.some(n => norm(n).split(/[;\s()]+/).some(w => w && w === primeiro) && s.split(' ').every(p => norm(n).includes(p)));
  });
  if (locs.length) return locs.map(detalheLocal).join('\n\n');
  return r.erro.startsWith('Mais de um') ? r.erro : 'Não achei shopping nem técnico "' + q + '". Tente *ixc quem hoje* ou *ixc lista*.';
}
const P0 = $('Escala: Filtrar Pergunta').first().json;
const ALIAS = { 
  '4B:199': ['palladium curitiba', 'palladium cwb', 'palladium ctba', 'paladiun curitiba', 'paladium curitiba', 'palladium', 'paladiun', 'paladium'], '4B:199|4B:200|CACTA:263|BUZZ:269': ['curitiba'], '4B:201': ['catuai palladium', 'catuai foz', 'palladium foz', 'foz do iguacu', 'foz'],
  '4B:202': ['palladium umuarama', 'umuarama'], '4B:275': ['cidade dos lagos', 'guarapuava'], '4B:244': ['outlet city center', 'city center campo largo', 'city center', 'citty center', 'city centre', 'cit center', 'sity center', 'citycenter', 'outlet campo largo', 'campo largo'],
  '4B:276': ['pato branco'], '4B:243': ['petropolis'], '4B:200': ['ventura'],
  'BUZZ:280': ['plaza campos gerais', 'campos gerais', 'ponta grossa'], 'BUZZ:269': ['estacao'], 'BUZZ:271': ['gravatai'],
  'CACTA:260': ['catuai cascavel', 'cascavel'], 'CACTA:263': ['jockey plaza', 'jockey plazza', 'jockey'], 'CACTA:253': ['park city sumare', 'parck city sumare', 'park city', 'parck city', 'parque city', 'park citi', 'parkcity', 'park sumare', 'shopping sumare', 'sumare'],
  'CACTA:247': ['patteo urupema', 'patteo', 'pateo', 'patio urupema', 'urupema', 'mogi das cruzes'], 'CACTA:253|CACTA:248': ['park shopping', 'parkshopping', 'parck shopping', 'park', 'parck'], 'CACTA:248': ['parkshopping mogi mirim', 'park shopping mogi mirim', 'parkshopping mogi', 'park shopping mogi', 'parck shopping mogi', 'parque shopping mogi', 'park mogi', 'parck mogi', 'shopping mogi mirim', 'mogi mirim', 'mogi mirin'], 'CACTA:206': ['pontal'],
  'PONTO:144': ['ifashion', 'i fashion', 'fashion outlet', 'ifosc', 'tijucas'], 'PONTO:104': ['itajai'], 'PONTO:134': ['porto belo', 'portobelo'],
  'PONTO:159': ['passo fundo'], 'PONTO:273': ['pulse'], 'PONTO:84': ['patio chapeco', 'patio'], 'PONTO:84|PONTO:273': ['chapeco'], 'PONTO:110': ['riviera'],
  'PONTO:216': ['sinop'], 'PELOTAS': ['pelotas'], '4B:201|CACTA:260': ['catuai'] };  // apelidos vistos no historico do N1/N2 (27/07-26/09)
const GENERICOS = ['curitiba'];  // so vale se nenhum shopping especifico foi citado

const grupos = String((cfg.param || {}).escala_grupos || '').split(',').map(s => s.trim()).filter(Boolean);
if (!grupos.includes(P0.grupo)) return [];
// RESPOSTA DE SETOR (regra de 04/10): contatos de ixc.contatos_setor + horario + se esta atendendo agora; marca o numero
if (P0.setores && P0.setores.length) {
  const ST = cfg.setores || [];
  const TIT = { rh: '👥 *RH*', financeiro: '💰 *Financeiro*', compras: '🛒 *Compras*', comercial: '💼 *Comercial*', n2: '🛠️ *Suporte N2*' };
  const ORD = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
  const ivs = h => String(h || '').split(',').map(x => x.trim()).filter(Boolean).map(x => x.split('-'));
  const fH = h => ivs(h).map(([a, b]) => a + '–' + b).join(' e ');
  const sem = c => { const g = []; for (const d of ORD) { const h = c[d] || null, u = g[g.length - 1]; if (u && u.h === h) u.f = d; else g.push({ i: d, f: d, h }); }
    return g.filter(x => x.h).map(x => DIAS_TXT[x.i] + (x.f !== x.i ? '–' + DIAS_TXT[x.f] : '') + ' ' + fH(x.h)).join(' · '); };
  // ESCALA 12x36 NO SETOR (04/10): contato com c.escala ('4B:199') segue a escala do shopping (__NOME__/__NOME__ = 12x36 Palladium Curitiba)
  const plantao = (c, iso) => ED.some(d => d.empresa + ':' + d.id_condominio === c.escala && String(d.data).slice(0, 10) === iso && norm(d.tecnico).split(' ')[0] === norm(c.nome).split(' ')[0]);
  const hEsc = (c, iso) => ((EB[c.escala] || {})[diaSem(iso)]) || null;
  const nomeEsc = c => { const l = LOC.find(l => l.empresa + ':' + l.id_condominio === c.escala); return l ? l.nome : c.escala; };
  const agora = c => {
    if (c.escala) { const h = hEsc(c, hojeIso); if (!h || !plantao(c, hojeIso)) return false; const [a, b] = h.split('-'); return horaAgora >= a && horaAgora <= b; }
    for (const [a, b] of ivs(c[diaSem(hojeIso)])) if (horaAgora >= a && horaAgora <= b) return true; return false; };
  const status = c => {
    if (c.escala) {
      const h = hEsc(c, hojeIso), amanha = addDia(hojeIso, 1);
      if (plantao(c, hojeIso) && h) { const [a, b] = h.split('-'); if (horaAgora < a) return '⏳ de plantão hoje, começa às ' + a; if (horaAgora <= b) return '🟢 de plantão agora (até ' + b + ')';
        const px = addDia(hojeIso, 2); return '🔴 plantão de hoje encerrou às ' + b + ' · próximo ' + DIAS_TXT[diaSem(px)] + ' ' + ddmm(px) + ' às ' + ((hEsc(c, px) || a + '-').split('-')[0]); }
      if (plantao(c, amanha) && hEsc(c, amanha)) return '🔴 folga hoje · plantão amanhã às ' + hEsc(c, amanha).split('-')[0];
      return '🔴 folga hoje (12x36)';
    }
    const iv = ivs(c[diaSem(hojeIso)]);
    if (!ORD.some(d => c[d])) return '⚪ horário não informado';
    for (const [a, b] of iv) if (horaAgora >= a && horaAgora <= b) return '🟢 atendendo agora (até ' + b + ')';
    for (const [a] of iv) if (horaAgora < a) return '⏳ volta hoje às ' + a;
    for (let i = 1; i <= 7; i++) { const iso = addDia(hojeIso, i), iv2 = ivs(c[diaSem(iso)]); if (iv2.length) return '🔴 fora do horário · volta ' + (i === 1 ? 'amanhã' : DIAS_TXT[diaSem(iso)] + ' ' + ddmm(iso)) + ' às ' + iv2[0][0]; }
    return '⚪ horário não informado';
  };
  // SO NO RECADOS (regra de 04/10): escala N1/N2 responde em qualquer grupo; financeiro/comercial/compras/rh so no grupo de Recados
  const RECADOS = String((cfg.param || {}).setores_grupo || '__GRUPO_RECADOS__@g.us');
  const NOME_S = { financeiro: 'Financeiro', comercial: 'Comercial', compras: 'Compras', rh: 'RH' };
  const foraRecados = P0.grupo !== RECADOS ? P0.setores.filter(s => s !== 'n2') : [];
  const blocos = [];
  for (const s of ['n2', 'financeiro', 'comercial', 'compras', 'rh']) {
    if (!P0.setores.includes(s) || foraRecados.includes(s)) continue;
    let cs = ST.filter(c => c.setor === s);
    if (s === 'n2') cs = cs.slice().sort((a, b) => agora(b) - agora(a));
    const L = [TIT[s] || s];
    const obsSetor = s === 'comercial' && cs[0] && cs[0].obs ? cs[0].obs : null;
    if (obsSetor) L.push(obsSetor);
    for (const c of cs) {
      L.push('👤 ' + c.nome + ' — ' + fmtFone(c.fone) + '\n🕐 ' + (c.escala ? '12x36 ' + nomeEsc(c) + ' ' + hfmt((EB[c.escala] || {})[diaSem(hojeIso)] || '') : (sem(c) || 'sem horário')) + ' · ' + status(c));
      if (c.obs && c.obs !== obsSetor && !/sem horário/i.test(c.obs)) L.push('_' + c.obs + '_');
    }
    if (!cs.length) L.push('_sem contato cadastrado_');
    blocos.push(L.join('\n'));
  }
  if (foraRecados.length) {
    const lista = foraRecados.map(s => NOME_S[s]);
    const txt = lista.length > 1 ? lista.slice(0, -1).join(', ') + ' e ' + lista[lista.length - 1] : lista[0];
    blocos.push('📌 Para falar com *' + txt + '*, pergunte no grupo *Resolutto - Recados*: é lá que estão todos os setores (Financeiro, Comercial, Compras e RH).');
  }
  let resp = '🤖 *Resposta automática do bot de escalas*\n\n' + blocos.join('\n\n');
  const menc = [];
  resp = resp.replace(/(👤[^\n]*?)\((\d{2})\)\s*(\d{4,5})-(\d{4})/g, (x, pre, dd, p1, p2) => { const num = '55' + dd + p1 + p2; if (!menc.includes(num)) menc.push(num); return pre + '@' + num; });
  return [{ json: { grupo: P0.grupo, resposta: resp, mentioned: menc, quoted: { key: { id: P0.id, remoteJid: P0.grupo, fromMe: P0.fromMe, participant: P0.participant }, message: { conversation: P0.texto } } } }];
}
let t = ' ' + norm(P0.texto).replace(/[^a-z0-9 ]/g, ' ') + ' ';
const achados = [];
const todos = [];
for (const [k, al] of Object.entries(ALIAS)) for (const a of al) todos.push([a, k]);
todos.sort((a, b) => (GENERICOS.includes(a[0]) - GENERICOS.includes(b[0])) || b[0].length - a[0].length);
for (const [a, k] of todos) {
  if (GENERICOS.includes(a) && achados.some(k => k !== 'PELOTAS')) continue;  // Pelotas nao e shopping cadastrado, nao conta
  const re = new RegExp(' ' + a + ' ');
  if (re.test(t)) { t = t.replace(re, ' # '); for (const kk of k.split('|')) if (!achados.includes(kk)) achados.push(kk); }
}
const locs = achados.map(k => LOC.find(l => l.empresa + ':' + l.id_condominio === k)).filter(Boolean);
const extras = achados.includes('PELOTAS') ? ['🏬 *Shopping Pelotas*\nSem técnico no momento (em fase de entrega de contrato).'] : [];
function compacto(l) {  // varios shoppings de uma vez (ex.: "quem esta em curitiba")
  const b = EB[l.empresa + ':' + l.id_condominio] || {}, h = b[diaSem(hojeIso)];
  if (!h) { const px = proximoDia(l, 1); return '🏬 *' + l.nome + '* — não atende hoje' + (px ? ' (volta ' + DIAS_TXT[diaSem(px)] + ' ' + (b[diaSem(px)] || '').split('-')[0] + ')\n' + pessoasDe(l, px) : ''); }
  return '🏬 *' + l.nome + '* — hoje ' + hfmt(h) + statusAgora(h).replace(/^ · /, ' ') + '\n' +
    quemNoDia(l, hojeIso).split(' / ').map(x => '👤 ' + x.trim().replace(/ (\(\d{2}\))/, ' — $1')).join('\n');
}
let resposta;
if (!locs.length && extras.length) resposta = extras.join('\n\n');
else if (!locs.length) {
  if (!/\bhoje\b|\bagora\b/.test(t) || !/\bquem\b/.test(t)) return [];   // "quem ta hoje?" sem shopping -> lista geral
  resposta = quem('hoje');
} else resposta = (locs.length > 2 ? locs.map(compacto) : locs.map(detalheLocal)).concat(extras).join('\n\n');
resposta = '🤖 *Resposta automática do bot de escalas*\n\n' + resposta;  // legenda do bot (regra de 04/10)
// Marca os tecnicos (regra de 02/10/2026): telefone da linha 👤 vira mencao de verdade (@55...). Lista geral "quem atende hoje" nao tem telefone -> nao marca ninguem.
const mencoes = [];
resposta = resposta.replace(/(👤[^\n]*?)\((\d{2})\)\s*(\d{4,5})-(\d{4})/g, (m, pre, dd, p1, p2) => {
  const num = '55' + dd + p1 + p2;
  if (!mencoes.includes(num)) mencoes.push(num);
  return pre + '@' + num;
});
return [{ json: { grupo: P0.grupo, resposta, mentioned: mencoes, quoted: { key: { id: P0.id, remoteJid: P0.grupo, fromMe: P0.fromMe, participant: P0.participant }, message: { conversation: P0.texto } } } }];

