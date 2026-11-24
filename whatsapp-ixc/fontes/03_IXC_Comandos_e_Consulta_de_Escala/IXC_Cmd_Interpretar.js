// Workflow: WhatsApp - Comandos ixc e consulta de escala (WAHA)
// No: IXC Cmd: Interpretar

// 0.3.0 (Painel do Bot): textos editaveis em ixc.mensagens; sem texto editado usa o padrao embutido na chamada.
const MSG_ = (() => { try { let c = $('IXC Cmd: Carregar').first().json.cfg; if (typeof c === 'string') c = JSON.parse(c); return (c && c.mensagens) || {}; } catch (e) { return {}; } })();
const OFF_ = Object.keys(MSG_).some(k => MSG_[k] === null);  // 0.5.0: alguma mensagem desativada no Painel do Bot
function M(chave, padrao, v) {
  if (MSG_[chave] === null) return '';  // 0.5.0: desativada no Painel do Bot
  const t = typeof MSG_[chave] === 'string' && MSG_[chave].trim() ? MSG_[chave] : padrao;
  if (!v) return t;
  const vazio = k => v[k] === null || v[k] === undefined || String(v[k]) === '';
  return t.split('\n').map(l => {
    const ks = [...l.matchAll(/\{([a-z_]+)\}/g)].map(m => m[1]).filter(k => k in v);
    const vz = ks.filter(vazio);
    // linha so com variaveis vazias (e emoji/pontuacao): some
    if (ks.length && vz.length === ks.length && !/[\p{L}\p{N}]/u.test(l.replace(/\{[a-z_]+\}/g, ''))) return null;
    const s = l.replace(/\{([a-z_]+)\}/g, (x, k) => (k in v ? (vazio(k) ? '' : String(v[k])) : x));
    return vz.length ? s.replace(/[\s—·:-]+$/u, '') : s;
  }).filter(l => l !== null).join('\n');
}
// Interpreta o comando "ixc ..." de forma deterministica (sem IA) contra a config do banco (schema ixc).
// Saida: { resposta } para consulta/erro, ou { acao, resumo } para registrar pendente, ou { aplicar/cancelar: true }.
let cfg = $('IXC Cmd: Carregar').first().json.cfg;
if (typeof cfg === 'string') cfg = JSON.parse(cfg);
const f = $('IXC Cmd: Filtrar').first().json;
const args = f.args;
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const A = norm(args);
const EMP = Object.fromEntries((cfg.empresas || []).map(e => [e.id, e.nome]));
const TEC = cfg.tecnicos || [], LOC = cfg.locais || [], P = cfg.param || {};
const out = o => [{ json: Object.assign({ resposta: null, acao: null, resumo: null, aplicar: false, cancelar: false, fone_validar: null }, o) }];

const AJUDA = M('cmd.ajuda', '🛠️ *Comandos IXC* (só valem depois de *ixc ok*)\n\n*ixc lista* [empresa ou shopping] — quem é marcado em cada shopping\n*ixc tecnicos* [empresa] — técnicos e números\n*ixc quem* <shopping ou técnico> — quem atende, horário, hoje e amanhã (*ixc quem hoje* = todos)\n\n*ixc shopping* <shopping> *tecnico* <técnico> — troca o técnico do shopping\n*ixc numero* <técnico> <telefone> — troca o número do técnico\n*ixc incluir* <técnico ou telefone> *em* <shopping> — marca também essa pessoa quando o chamado ficar sem técnico\n*ixc remover* <técnico ou telefone> *de* <shopping>\n*ixc novo tecnico* <empresa> <id no IXC> <nome> <telefone>\n\n*ixc ok* — aplica a alteração pendente · *ixc cancelar* — descarta\n\nEx.: _ixc shopping Tijucas tecnico Joao_ · _ixc numero Fulano 41 99999-0000_');

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
  if (!hits.length) return { erro: M('cmd.nao_achei_shopping', 'Não achei o shopping "{busca}". Veja os nomes com *ixc lista*.', { busca: q }) };
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
  if (!hits.length) return { erro: M('cmd.nao_achei_tecnico', 'Não achei o técnico "{busca}"{na_empresa}. Veja com *ixc tecnicos*{empresa} (técnico novo: *ixc novo tecnico*).', { busca: q, na_empresa: emp ? ' na ' + emp : '', empresa: emp ? ' ' + emp : '' }) };
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

const w0 = A.split(' ')[0] || '';
const resto = args.replace(/^\S+\s*/, '');

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
// 2o nome "compativel": algum dos dois nao tem 2o nome, ou o 2o de um aparece no outro (0.4.3)
const palN = s => norm(s).replace(/\(\d{2}\).*$/, '').replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
const compat = (a, k) => !a[1] || !k[1] || a.includes(k[1]) || k.includes(a[1]);
function foneDe(nome, loc, b) {  // 0.4.3: nome inteiro > 2o nome > unico com o 1o nome (antes: 1a linha com o 1o nome)
  const w = palN(nome); if (!w.length) return '';
  const eq = String((b && b.tecnicos) || '').split(';').map(x => x.trim()).filter(x => palN(x)[0] === w[0]);
  const ok = eq.filter(x => compat(w, palN(x)));
  const m = eq.find(x => palN(x).join(' ') === w.join(' ')) || (w[1] && ok.find(x => palN(x).includes(w[1]))) || (ok.length === 1 ? ok[0] : null);
  const f = m && m.match(/\(\d{2}\)\s*[\d-]+/);
  if (f) return f[0];
  const ts = TEC.filter(t => t.empresa === loc.empresa && palN(t.nome)[0] === w[0] && compat(w, palN(t.nome)));
  return ts.length === 1 && ts[0].fone ? fmtFone(ts[0].fone) : '';
}
function pessoaTxt(x) {  // 0.3.0: "Nome (dd) nnnn-nnnn" -> mensagem escala.shopping.pessoa
  const m = String(x).trim().match(/^(.*?)\s*(\(\d{2}\)\s*[\d-]+)?$/);
  return M('escala.shopping.pessoa', '👤 {tecnico} — {telefone}', { tecnico: m ? m[1] : String(x).trim(), telefone: m && m[2] ? m[2] : '' });
}
// 0.4.1 (Painel do Bot): nome da planilha ESCALAS -> tecnico cadastrado ("nome na planilha"; vazio = nome).
// Nome inteiro igual; senao 1o nome (empate desfeito pelo 2o). Achou: a resposta usa o nome e o telefone do cadastro.
function tecDaPlanilha(emp, nome) {
  const pal = s => norm(s).replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const w = pal(nome); if (!w.length) return null;
  const da = TEC.filter(t => t.empresa === emp);
  const ex = da.filter(t => pal(t.nome_planilha || t.nome).join(' ') === w.join(' '));
  if (ex.length === 1) return ex[0];
  const c = da.filter(t => pal(t.nome_planilha || t.nome)[0] === w[0]);
  if (c.length === 1 && compat(w, pal(c[0].nome_planilha || c[0].nome))) return c[0];  // 0.4.3: 2o nome nao pode contradizer
  if (c.length === 1) return contido_(da, w);  // 0.4.3: "Joao Soares" nao e o "Joao Henrique" que sobrou
  const d = c.filter(t => { const k = pal(t.nome_planilha || t.nome); return k[1] && w.includes(k[1]); });
  if (d.length === 1) return d[0];
  if (c.length) return null;  // 1o nome bate com mais de um e o 2o nao desempatou: como na 0.4.1
  // 0.4.2: renomeado no painel sem "Nome na planilha" ("Juliano" -> "Testinho - Juliano")
  return contido_(da, w);
}
function contido_(da, w) {  // 0.4.2: nome da planilha dentro do nome do cadastro (so com "Nome na planilha" vazio)
  if (w.some(p => p.length < 3)) return null;
  const r = da.filter(t => !t.nome_planilha && w.every(p => palN(t.nome).includes(p)));
  return r.length === 1 ? r[0] : null;
}
// 0.4.2: tecnico do dia no 12x36 = regras acima; senao o telefone da Equipe do shopping (o mesmo que vira o @)
function tecDoDia(loc, nome) {
  const t = tecDaPlanilha(loc.empresa, nome);
  if (t) return t;
  const b = EB[loc.empresa + ':' + loc.id_condominio] || {};
  const f = String(foneDe(nome, loc, b) || '').replace(/\D/g, '');
  if (f.length < 10) return null;
  const r = TEC.filter(x => x.empresa === loc.empresa && String(x.fone || '').replace(/\D/g, '').slice(-10) === f.slice(-10));
  return r.length === 1 ? r[0] : null;
}
function quemNoDia(loc, iso) {
  const b = EB[loc.empresa + ':' + loc.id_condominio] || {};
  if (b.tipo === '12x36' || b.tipo === 'escala') {
    const ns = ED.filter(d => d.empresa === loc.empresa && d.id_condominio === loc.id_condominio && String(d.data).slice(0, 10) === iso).map(d => d.tecnico);
    if (ns.length) return ns.map(n => { const t = tecDoDia(loc, n); return t ? t.nome + (t.fone ? ' ' + fmtFone(t.fone) : '') : n + ' ' + foneDe(n, loc, b); }).join(' / ').trim();  // 0.4.1
    return b.tecnicos ? b.tecnicos.replace(/;/g, ' /') : M('escala.sem_escala_dia', '_(escala do dia não encontrada na planilha)_');  // sem escala do dia -> equipe da escala base
  }
  const tp = TEC.find(t => t.empresa === loc.empresa && t.id_func === loc.tec_padrao);
  if (tp) return tp.nome + (tp.fone ? ' ' + fmtFone(tp.fone) : '');
  return b.tecnicos ? b.tecnicos.replace(/;/g, ' /') : M('escala.sem_tecnico', 'sem técnico cadastrado');
}
function statusAgora(h) {
  if (!h) return '';
  const [ini, fim] = h.split('-');
  if (horaAgora < ini) return M('escala.status.comeca', ' · ⏳ começa às {inicio}', { inicio: ini });
  if (horaAgora <= fim) return M('escala.status.atendendo', ' · 🟢 em atendimento (até {fim})', { fim });
  return M('escala.status.encerrou', ' · 🔴 encerrou às {fim}', { fim });
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
  const rv = { rotulo: agora ? 'Hoje' : 'Amanhã', dia: DIAS_TXT[diaSem(iso)], data: ddmm(iso) };
  if (!h) return M('escala.shopping.nao_atende', '*{rotulo} ({dia} {data})*: não atende', rv);
  const pessoas = quemNoDia(loc, iso).split(' / ').map(x => pessoaTxt(x)).join('\n');
  return M('escala.shopping.dia', '*{rotulo} ({dia} {data})* — {horario}{status}', Object.assign(rv, { horario: hfmt(h), status: agora ? statusAgora(h) : '' })) + '\n' + pessoas;
}
// proximo dia (a partir de depois de amanha) em que o shopping atende - pra sempre mostrar o tecnico
function proximoDia(loc, de) {
  const b = EB[loc.empresa + ':' + loc.id_condominio] || {};
  for (let i = de; i <= 7; i++) { const iso = addDia(hojeIso, i); if (b[diaSem(iso)]) return iso; }
  return null;
}
function pessoasDe(loc, iso) {
  return quemNoDia(loc, iso).split(' / ').map(x => pessoaTxt(x)).join('\n');
}
function detalheLocal(loc) {
  const b = EB[loc.empresa + ':' + loc.id_condominio] || {};
  const linhas = [M('escala.shopping.titulo', '🏬 *{shopping}* ({empresa}){regime}', { shopping: loc.nome, empresa: EMP[loc.empresa] || loc.empresa, regime: b.tipo === '12x36' ? ' · 12x36' : '' }),
    linhaDia(loc, hojeIso, true), linhaDia(loc, addDia(hojeIso, 1), false)];
  if (!b[diaSem(hojeIso)] && !b[diaSem(addDia(hojeIso, 1))]) {
    const px = proximoDia(loc, 2);
    if (px) linhas.push('\n', M('escala.shopping.proximo', '*Próximo atendimento ({dia} {data})* — {horario}', { dia: DIAS_TXT[diaSem(px)], data: ddmm(px), horario: hfmt(b[diaSem(px)]) }) + '\n' + pessoasDe(loc, px));
  }
  return linhas.concat([M('escala.shopping.horario', 'Horário: {semana}', { semana: semana(b) })]).concat(b.obs ? ['_' + b.obs + '_'] : []).join('\n');
}
function quem(q) {
  q = String(q || '').replace(/[?!.]+\s*$/, '').replace(/^\s*(e|é|esta|está|ta|tá|atende|trabalha|fica|ficou)?\s*(hoje\s+)?(no|na|em|o|a|do|da)?\s+/i, ' ').trim();
  if (/\s(hoje|amanh[aã]|agora)$/i.test(q)) q = q.replace(/\s+(hoje|amanh[aã]|agora)$/i, '').trim();
  const s = norm(q);
  if (!s || s === 'hoje' || s === 'agora') {
    const linhas = [M('escala.quem_hoje.titulo', '👷 *Quem atende hoje* ({dia} {data}, {hora})', { dia: DIAS_TXT[diaSem(hojeIso)], data: ddmm(hojeIso), hora: horaAgora })];
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
    const nomes = [tp ? tp.nome : '', b.tecnicos || ''].concat(ED.filter(d => d.empresa === l.empresa && d.id_condominio === l.id_condominio).map(d => d.tecnico))
      .concat(ED.filter(d => d.empresa === l.empresa && d.id_condominio === l.id_condominio).map(d => (tecDoDia(l, d.tecnico) || {}).nome || ''));  // 0.4.1 / 0.4.2
    return nomes.some(n => norm(n).split(/[;\s()]+/).some(w => w && w === primeiro) && s.split(' ').every(p => norm(n).includes(p)));
  });
  if (locs.length) return locs.map(detalheLocal).join('\n\n');
  return r.erro.startsWith('Mais de um') ? r.erro : M('cmd.nao_achei_nada', 'Não achei shopping nem técnico "{busca}". Tente *ixc quem hoje* ou *ixc lista*.', { busca: q });
}
if (w0 === 'quem' || w0 === 'escala' || w0 === 'horario' || w0 === 'horarios') return out({ resposta: M('escala.cabecalho', '🤖 *Resposta automática do bot de escalas*') + '\n\n' + quem(resto) });

if (!A || w0 === 'ajuda' || w0 === 'help' || w0 === '?') return out({ resposta: AJUDA });
if (A === 'ok' || A === 'confirmar' || A === 'confirmo' || A === 'sim') return out({ aplicar: true });
if (A === 'cancelar' || A === 'cancela' || A === 'nao') return out({ cancelar: true });

if (w0 === 'lista' || w0 === 'listar' || w0 === 'shoppings') {
  const q = norm(resto);
  let locs = LOC;
  if (q) {
    const emp = Object.keys(EMP).find(e => norm(e) === q);
    locs = emp ? LOC.filter(l => l.empresa === emp) : LOC.filter(l => norm(l.nome).includes(q));
  }
  if (!locs.length) return out({ resposta: 'Nada encontrado pra "' + resto + '".' });
  const linhas = [M('cmd.lista.titulo', '📋 *Marcação por shopping*\n_técnico → chamado atribuído a ele marca ele; sem técnico → marca a lista_')];
  let emp = null;
  for (const l of locs.slice().sort((a, b) => (a.empresa + a.nome).localeCompare(b.empresa + b.nome))) {
    if (l.empresa !== emp) { emp = l.empresa; linhas.push('', '*' + (EMP[emp] || emp) + '*'); }
    const tp = TEC.find(t => t.empresa === l.empresa && t.id_func === l.tec_padrao);
    linhas.push('• ' + l.nome + (tp ? ' — técnico: ' + tp.nome : '') + '\n   sem técnico marca: ' + ((l.marcar_sem_tec || []).map(x => nomeFone(l.empresa, x)).join(', ') || 'ninguém'));
  }
  return out({ resposta: linhas.join('\n') });
}

if (w0 === 'tecnicos' || w0 === 'tecnico' && !resto) {
  const q = norm(resto);
  const emp = Object.keys(EMP).find(e => norm(e) === q);
  const ts = TEC.filter(t => !q || t.empresa === emp || norm(t.nome).includes(q));
  if (!ts.length) return out({ resposta: 'Nenhum técnico encontrado pra "' + resto + '".' });
  const linhas = [M('cmd.tecnicos.titulo', '👷 *Técnicos*')];
  let e0 = null;
  for (const t of ts.slice().sort((a, b) => (a.empresa + a.nome).localeCompare(b.empresa + b.nome))) {
    if (t.empresa !== e0) { e0 = t.empresa; linhas.push('', '*' + (EMP[e0] || e0) + '*'); }
    linhas.push('• ' + t.nome + ' — ' + (t.fone ? fmtFone(t.fone) : 'sem número') + ' (id ' + t.id_func + ')');
  }
  return out({ resposta: linhas.join('\n') });
}

// Feriados desligados por hora (regra de 27/09/2026) - religar: parametro feriados_ativo=sim + tirar este bloco
if (w0 === 'feriados' || w0 === 'feriado' || (w0 === 'remover' && norm(resto).startsWith('feriado'))) return out({ resposta: 'Feriados estão desligados por enquanto.' });
if (w0 === 'feriados') {
  const fs = (cfg.feriados || []).slice(0, 25);
  if (!fs.length) return out({ resposta: 'Nenhum feriado cadastrado daqui pra frente.' });
  return out({ resposta: M('cmd.feriados.titulo', '📅 *Próximos feriados (sem reaviso)*') + '\n' + fs.map(x => {
    const l = x.id_condominio ? LOC.find(l => l.id_condominio === x.id_condominio && (!x.empresa || l.empresa === x.empresa)) : null;
    return '• ' + brData(x.data) + ' — ' + x.descricao + (l ? ' _(só ' + locTxt(l) + ')_' : x.empresa ? ' _(só ' + x.empresa + ')_' : '');
  }).join('\n') });
}

if (w0 === 'feriado' || (w0 === 'remover' && norm(resto).startsWith('feriado'))) {
  const del = w0 === 'remover';
  let s = del ? resto.replace(/^\S+\s*/, '') : resto;
  const dt = lerData(s.split(/\s+/)[0]);
  if (!dt) return out({ resposta: 'Data inválida. Use dd/mm/aaaa, ex.: _ixc feriado 20/01/2027 São Sebastião em Porto Belo_' });
  s = s.replace(/^\S+\s*/, '');
  let loc = null;
  const d = dividir(' ' + s, 'em');
  if (d) d[0] = d[0].trim();
  if (d) { const r = acharLocal(d[1]); if (r.erro) return out({ resposta: r.erro }); loc = r.loc; s = d[0]; }
  else if (del && s) { const r = acharLocal(s); if (r.erro) return out({ resposta: r.erro }); loc = r.loc; s = ''; }
  if (!del && !s) return out({ resposta: 'Faltou a descrição do feriado.' });
  const onde = loc ? ' em ' + locTxt(loc) : ' (todos os shoppings)';
  return out({
    acao: { acao: del ? 'feriado_del' : 'feriado_add', data: dt, empresa: loc ? loc.empresa : null, id_condominio: loc ? loc.id_condominio : null, descricao: s || null },
    resumo: (del ? 'remover feriado ' : 'feriado ') + brData(dt) + (s ? ' — ' + s : '') + onde,
  });
}

if (w0 === 'shopping' || w0 === 'trocar') {
  const d = dividir(resto, 'tecnico') || dividir(resto, 'técnico') || dividir(resto, 'para') || dividir(resto, 'pro');
  if (!d) return out({ resposta: 'Use: _ixc shopping <shopping> tecnico <técnico>_' });
  const r = acharLocal(d[0]); if (r.erro) return out({ resposta: r.erro });
  const t = acharTec(d[1], r.loc.empresa); if (t.erro) return out({ resposta: t.erro });
  if (!t.tec.fone) return out({ resposta: t.tec.nome + ' está sem número. Primeiro: _ixc numero ' + t.tec.nome + ' <telefone>_' });
  const atual = TEC.find(x => x.empresa === r.loc.empresa && x.id_func === r.loc.tec_padrao);
  if (atual && atual.id_func === t.tec.id_func && (r.loc.marcar_sem_tec || []).includes(t.tec.fone)) return out({ resposta: t.tec.nome + ' já é o técnico de ' + locTxt(r.loc) + '.' });
  return out({
    acao: { acao: 'shopping_tecnico', empresa: r.loc.empresa, id_condominio: r.loc.id_condominio, id_func: t.tec.id_func, fone: t.tec.fone },
    resumo: locTxt(r.loc) + ': técnico ' + (atual ? atual.nome + ' → ' : '') + t.tec.nome + ' ' + fmtFone(t.tec.fone) + ' (chamado sem técnico passa a marcar ' + t.tec.nome + ' no lugar do técnico anterior; supervisor/coordenação continuam)',
  });
}

if (w0 === 'numero' || w0 === 'número' || w0 === 'telefone') {
  const m = resto.match(/^(.*?)\s*((?:\+?\d[\d\s().-]{8,}\d))\s*$/);
  if (!m) return out({ resposta: 'Use: _ixc numero <técnico> <telefone>_, ex.: _ixc numero Fulano 41 99999-0000_' });
  const fone = lerFone(m[2]); if (!fone) return out({ resposta: 'Telefone inválido: ' + m[2] + ' (use DDD + número).' });
  const t = acharTec(m[1]); if (t.erro) return out({ resposta: t.erro });
  if (t.tec.fone === fone) return out({ resposta: t.tec.nome + ' já está com esse número.' });
  return out({
    acao: { acao: 'numero', empresa: t.tec.empresa, id_func: t.tec.id_func, fone, fone_antigo: t.tec.fone || null },
    resumo: 'número de ' + t.tec.nome + ' (' + t.tec.empresa + '): ' + (t.tec.fone ? fmtFone(t.tec.fone) + ' → ' : '') + fmtFone(fone),
    fone_validar: fone,
  });
}

if (w0 === 'incluir' || w0 === 'adicionar' || w0 === 'remover' || w0 === 'tirar') {
  const inc = w0 === 'incluir' || w0 === 'adicionar';
  const d = inc ? dividir(resto, 'em') || dividir(resto, 'no') || dividir(resto, 'na')
                : dividir(resto, 'de') || dividir(resto, 'do') || dividir(resto, 'da') || dividir(resto, 'em');
  if (!d) return out({ resposta: inc ? 'Use: _ixc incluir <técnico ou telefone> em <shopping>_' : 'Use: _ixc remover <técnico ou telefone> de <shopping>_' });
  const r = acharLocal(d[1]); if (r.erro) return out({ resposta: r.erro });
  let fone = /\d{8,}/.test(d[0].replace(/\D/g, '')) ? lerFone(d[0]) : null, nome;
  if (fone) nome = nomeFone(r.loc.empresa, fone);
  else {
    const q = norm(d[0]);
    const primeiro = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/)[0];
    if (P.supervisor_nome && q.startsWith(primeiro(P.supervisor_nome))) { fone = P.supervisor_fone; nome = P.supervisor_nome + ' (supervisor)'; }
    else if (P.coordenador_nome && q.startsWith(primeiro(P.coordenador_nome))) { fone = P.coordenador_fone; nome = P.coordenador_nome + ' (coordenador)'; }
    else {
      const t = acharTec(d[0], r.loc.empresa);
      if (t.erro) { const t2 = acharTec(d[0]); if (t2.erro) return out({ resposta: t.erro }); t.tec = t2.tec; }
      if (!t.tec.fone) return out({ resposta: t.tec.nome + ' está sem número cadastrado.' });
      fone = t.tec.fone; nome = t.tec.nome;
    }
  }
  const lista = r.loc.marcar_sem_tec || [];
  if (inc && lista.includes(fone)) return out({ resposta: nome + ' já é marcado em ' + locTxt(r.loc) + '.' });
  if (!inc && !lista.includes(fone)) return out({ resposta: nome + ' não está na lista de ' + locTxt(r.loc) + ' (lista: ' + (lista.map(x => nomeFone(r.loc.empresa, x)).join(', ') || 'vazia') + ').' });
  return out({
    acao: { acao: inc ? 'incluir' : 'remover', empresa: r.loc.empresa, id_condominio: r.loc.id_condominio, fone },
    resumo: (inc ? 'incluir ' : 'remover ') + (nome === fmtFone(fone) ? nome : nome + ' ' + fmtFone(fone)) + (inc ? ' em ' : ' de ') + locTxt(r.loc) + ' (chamado sem técnico)',
    fone_validar: inc ? fone : null,
  });
}

if (A.startsWith('novo tecnico') || A.startsWith('novo técnico')) {
  const m = args.replace(/^\S+\s+\S+\s*/, '').match(/^(\S+)\s+(\d+)\s+(.+?)\s+((?:\+?\d[\d\s().-]{8,}\d))\s*$/);
  if (!m) return out({ resposta: 'Use: _ixc novo tecnico <empresa> <id no IXC> <nome> <telefone>_, ex.: _ixc novo tecnico PONTO 88 Carlos Silva 41 99999-0000_' });
  const emp = Object.keys(EMP).find(e => norm(e) === norm(m[1]));
  if (!emp) return out({ resposta: 'Empresa "' + m[1] + '" não existe. Use: ' + Object.keys(EMP).join(', ') });
  const fone = lerFone(m[4]); if (!fone) return out({ resposta: 'Telefone inválido: ' + m[4] });
  const ex = TEC.find(t => t.empresa === emp && t.id_func === m[2]);
  return out({
    acao: { acao: 'novo_tecnico', empresa: emp, id_func: m[2], nome: m[3].trim(), fone, grupo: null },
    resumo: (ex ? 'atualizar técnico ' + ex.nome + ' → ' : 'novo técnico ') + m[3].trim() + ' (' + emp + ', id ' + m[2] + ') ' + fmtFone(fone),
    fone_validar: fone,
  });
}

return out({ resposta: M('cmd.nao_entendi', 'Não entendi o comando. Mande *ixc ajuda* pra ver a lista.') });

