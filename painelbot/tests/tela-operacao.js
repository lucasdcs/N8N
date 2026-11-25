// Teste de tela da painelbot 0.5.0 (Operação + Parâmetros): painel.js real no jsdom, gravando pelo acao.php real
// (GLPI simulado) no Postgres de teste, com n8n/WAHA falsos.
// Uso: php -S 127.0.0.1:8765 tests/servidor-teste.php & php -S 127.0.0.1:8766 tests/n8n-falso.php & node tests/tela-operacao.js
const { JSDOM } = require('jsdom'); const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const JS = fs.readFileSync(path.join(__dirname, '..', 'public/js/painel.js'), 'utf8');
const BASE = 'http://127.0.0.1:8765';
const sql = q => execSync(`psql -h ${process.env.PGH || '/tmp/pg'} -p ${process.env.PGP || 5499} -U ixc -d ixc -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0; const falhas = [];
const check = (n, c, x) => { if (c) ok++; else { falhas.push(n); console.log('  ✘', n, x === undefined ? '' : '\n' + x); } };
const espera = ms => new Promise(r => setTimeout(r, ms));
async function ate(f, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (f()) return true; } catch (e) {} await espera(30); } return false; }
const estadoN8n = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'n8n-estado.json'), 'utf8'));

function abrir(r) {   // r = {a: avisos, c: config, admin}
  fs.writeFileSync(path.join(__dirname, 'direitos.json'), JSON.stringify({ plugin_painelbot_avisos: r.a, plugin_painelbot_config: r.c, config: r.admin ? 3 : 1 }));
  const m = v => ({ ver: !!(v & 1), editar: !!(v & 2), excluir: !!(v & 4) });
  const D = { avisos: m(r.a), config: m(r.c) };
  const html = `<html><head><meta property="glpi:csrf_token" content="x"></head><body><div id="pbot" data-api="${BASE}/dados/operacao,parametros" data-acao="${BASE}/acao" data-direitos='${JSON.stringify(D)}' data-admin="${r.admin ? 1 : 0}">
    <span id="pbot-status"></span><div id="pbot-erro" hidden></div>
    <section class="pbot-sec" data-sec="operacao">
      <div class="pbot-op-modos" id="pbot-op-modos"></div><span id="pbot-op-hora"></span><div class="pbot-barra" id="pbot-op-barra"></div>
      <div class="pbot-retorno" id="pbot-op-n8n-aviso"></div><div class="pbot-tabela-wrap"><table id="pbot-op-workflows"></table></div>
      <div id="pbot-op-waha"></div><div class="pbot-tabela-wrap"><table id="pbot-op-bases"></table></div><div class="pbot-tabela-wrap"><table id="pbot-op-auditoria"></table></div>
    </section>
    <section class="pbot-sec" data-sec="parametros"><div class="pbot-tabela-wrap"><table id="pbot-parametros"></table></div>
      <div class="pbot-tabela-wrap"><table id="pbot-param-auditoria"></table></div><div class="pbot-tabela-wrap"><table id="pbot-feriados"></table></div></section>
  </div></body></html>`;
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: BASE + '/' });
  const w = dom.window;
  w.fetch = (u, o) => fetch(new URL(u, BASE), o);
  w.eval(JS);
  w.dispatchEvent(new w.Event('load'));
  return w;
}
const $ = (w, s) => w.document.querySelector(s);
const $$ = (w, s) => Array.from(w.document.querySelectorAll(s));
const bt = (w, txt, raiz) => Array.from((raiz || w.document).querySelectorAll('button')).find(b => b.textContent.trim().startsWith(txt));
const modo = (w, i) => $$(w, '.pbot-op-modo')[i];
const linha = (w, tab, txt) => $$(w, '#' + tab + ' tbody tr').find(tr => tr.textContent.includes(txt));
const campo = (w, k) => $(w, '.pbot-modal [data-k="' + k + '"] input, .pbot-modal [data-k="' + k + '"] select, .pbot-modal [data-k="' + k + '"] textarea');

(async () => {
  execSync(path.join(__dirname, 'reset-banco.sh') + ' 2>/dev/null');
  execSync(`psql -h ${process.env.PGH || '/tmp/pg'} -p ${process.env.PGP || 5499} -U ixc -d ixc -q -f ${path.join(__dirname, 'semente-operacao.sql')}`);
  try { fs.unlinkSync(path.join(__dirname, 'n8n-estado.json')); } catch (e) {}

  // ---------------- perfil completo + administrador do GLPI
  let w = abrir({ a: 7, c: 3, admin: true });
  check('carregou 2 cartões de modo', await ate(() => $$(w, '.pbot-op-modo').length === 2));
  check('avisos em NENHUM, lembretes igual', modo(w, 0).textContent.includes('NENHUM') && modo(w, 1).textContent.includes('(igual aos avisos)'));
  check('botão do modo atual destacado', bt(w, 'Nenhum', modo(w, 0)).classList.contains('pri') && bt(w, 'Igual aos avisos', modo(w, 1)).classList.contains('pri'));
  bt(w, 'Simular', modo(w, 0)).click();
  check('SIMULAR gravado', await ate(() => sql("SELECT valor FROM ixc.parametros WHERE chave='envio'") === 'SIMULAR'));
  check('cartão mostra SIMULAR e o número de teste', await ate(() => modo(w, 0).textContent.includes('SIMULAR') && modo(w, 0).textContent.includes('(41) 90000-0000')), modo(w, 0) && modo(w, 0).textContent);
  check('lembretes seguem SIMULAR', modo(w, 1).textContent.includes('SIMULAR (igual aos avisos)'));
  bt(w, 'Real', modo(w, 0)).click();
  const conf = modo(w, 0).querySelector('.pbot-op-confirma');
  check('REAL pede confirmação', !conf.hidden && sql("SELECT valor FROM ixc.parametros WHERE chave='envio'") === 'SIMULAR');
  conf.querySelector('input').value = 'sim'; bt(w, 'Ligar REAL', conf).click();
  check('confirmação errada recusa', await ate(() => modo(w, 0).querySelector('.pbot-retorno.erro') && modo(w, 0).querySelector('.pbot-retorno').textContent.includes('digite REAL')));
  conf.querySelector('input').value = 'REAL'; bt(w, 'Ligar REAL', conf).click();
  check('REAL gravado', await ate(() => sql("SELECT valor FROM ixc.parametros WHERE chave='envio'") === 'REAL'));
  check('aviso no topo', await ate(() => $(w, '#pbot-retorno-topo') && $(w, '#pbot-retorno-topo').textContent.includes('próxima rodada')));
  await ate(() => modo(w, 1) && bt(w, 'Nenhum', modo(w, 1)));
  bt(w, 'Nenhum', modo(w, 1)).click();
  check('lembretes separados em NENHUM', await ate(() => sql("SELECT valor FROM ixc.parametros WHERE chave='envio_lembretes'") === 'NENHUM'));

  // workflows
  check('workflows do n8n', await ate(() => $$(w, '#pbot-op-workflows tbody tr').length === 4), $(w, '#pbot-op-n8n-aviso').textContent);
  check('bot primeiro, [SIM] depois, fora do bot por último', $$(w, '#pbot-op-workflows tbody tr').map(tr => tr.querySelector('b').textContent).join('|') ===
    'Avisos de chamado (01)|Lembretes de visita (02)|Avisos de chamado (01)|Lembrete diario O.S. paradas', $$(w, '#pbot-op-workflows tbody tr').map(tr => tr.textContent).join('\n'));
  const fora = linha(w, 'pbot-op-workflows', 'paradas');
  check('fora do bot: só leitura', fora.textContent.includes('só leitura') && !fora.querySelector('button'));
  const w1 = $$(w, '#pbot-op-workflows tbody tr')[0];
  check('última execução e último erro', w1.textContent.includes('ok') && w1.textContent.includes('há 2 min') && w1.textContent.includes('execução 501'), w1.textContent);
  check('[SIM] pausado tem Retomar', bt(w, 'Retomar', $$(w, '#pbot-op-workflows tbody tr')[2]) !== undefined);
  bt(w, 'Pausar', w1).click();
  check('pausar pede confirmação', bt(w, 'Confirmar pausa?', w1) !== undefined && estadoFile() === null);
  bt(w, 'Confirmar pausa?', w1).click();
  check('pausado no n8n', await ate(() => estadoN8n().w1 === false));
  check('tabela mostra Retomar', await ate(() => bt(w, 'Retomar', $$(w, '#pbot-op-workflows tbody tr')[0]) !== undefined));
  check('auditoria do workflow', await ate(() => sql("SELECT acao || '|' || antes || '|' || depois FROM ixc.painel_auditoria WHERE acao LIKE 'workflow%'") === 'workflow_pausar|ativo|pausado'));
  bt(w, 'Retomar', $$(w, '#pbot-op-workflows tbody tr')[0]).click();
  check('retomar sem confirmação', await ate(() => estadoN8n().w1 === true));
  check('WAHA conectado', await ate(() => $(w, '#pbot-op-waha').textContent.includes('conectado') && $(w, '#pbot-op-waha').textContent.includes('Bot Teste') && $(w, '#pbot-op-waha').textContent.includes('sessao_teste')));

  // bases
  const aaa = linha(w, 'pbot-op-bases', 'Base Teste A');
  check('base com último evento e assuntos', aaa && aaa.textContent.includes('há 1 h') && aaa.textContent.includes('30'), aaa && aaa.textContent);
  check('administrador vê trocar token', aaa.querySelector('button[title^="Trocar token"]') !== null);
  aaa.querySelector('button[title^="Editar base"]').click();
  check('formulário da base preenchido', await ate(() => campo(w, 'nome') && campo(w, 'nome').value === 'Base Teste A' && campo(w, 'ignorar_assuntos').value === '30' && campo(w, 'ativo').checked));
  campo(w, 'nome').value = 'Base A editada'; campo(w, 'ignorar_assuntos').value = '30, 41';
  bt(w, 'Salvar', $(w, '.pbot-modal')).click();
  check('base gravada', await ate(() => sql("SELECT nome || '|' || ignorar_assuntos::text FROM ixc.empresas WHERE id='AAA'") === 'Base A editada|{30,41}'));
  check('tabela recarregou', await ate(() => linha(w, 'pbot-op-bases', 'Base A editada') && !$(w, '.pbot-modal')));
  linha(w, 'pbot-op-bases', 'Base A editada').querySelector('button[title^="Trocar token"]').click();
  await ate(() => campo(w, 'token'));
  campo(w, 'token').value = 'usuario:segredo99';
  bt(w, 'Salvar', $(w, '.pbot-modal')).click();
  check('token trocado', await ate(() => sql("SELECT auth FROM ixc.empresas WHERE id='AAA'") === 'Basic ' + Buffer.from('usuario:segredo99').toString('base64')));
  check('auditoria na aba sem o token', await ate(() => $(w, '#pbot-op-auditoria').textContent.includes('token do IXC') && !$(w, '#pbot-op-auditoria').textContent.includes('segredo')));

  // parâmetros
  const sem = linha(w, 'pbot-parametros', 'semtec_min');
  check('parâmetro com rótulo do catálogo e lápis', sem.textContent.includes('Minutos sem técnico até o 1º aviso') && sem.querySelector('button[title="Editar semtec_min"]'));
  sem.querySelector('button').click();
  await ate(() => campo(w, 'valor'));
  check('formulário do parâmetro', campo(w, 'valor').value === '10' && $(w, '.pbot-modal').textContent.includes('de 1 a 1440'));
  campo(w, 'valor').value = '0'; bt(w, 'Salvar', $(w, '.pbot-modal')).click();
  check('valor fora do limite recusado', await ate(() => $(w, '.pbot-modal .pbot-retorno.erro') && $(w, '.pbot-modal .pbot-retorno').textContent.includes('de 1 a 1440')));
  campo(w, 'valor').value = '20'; bt(w, 'Salvar', $(w, '.pbot-modal')).click();
  check('parâmetro gravado', await ate(() => sql("SELECT valor FROM ixc.parametros WHERE chave='semtec_min'") === '20' && !$(w, '.pbot-modal')));
  check('auditoria na aba Parâmetros', await ate(() => linha(w, 'pbot-param-auditoria', 'semtec_min') && linha(w, 'pbot-param-auditoria', 'semtec_min').textContent.includes('Fulano GLPI')));
  linha(w, 'pbot-parametros', 'aviso_privado').querySelector('button').click();
  await ate(() => campo(w, 'valor'));
  check('sim/nao vira lista', campo(w, 'valor').tagName === 'SELECT' && campo(w, 'valor').value === 'sim');
  bt(w, 'Cancelar', $(w, '.pbot-modal')).click();
  linha(w, 'pbot-parametros', 'envio_teste_para').querySelector('button').click();
  await ate(() => campo(w, 'valor'));
  check('fone mostrado com máscara', campo(w, 'valor').value === '(41) 90000-0000');
  bt(w, 'Cancelar', $(w, '.pbot-modal')).click();
  linha(w, 'pbot-parametros', 'envio_lembretes').querySelector('button').click();
  await ate(() => campo(w, 'confirmar'));
  campo(w, 'valor').value = 'REAL'; bt(w, 'Salvar', $(w, '.pbot-modal')).click();
  check('REAL pelo Parâmetros também pede confirmar', await ate(() => $(w, '.pbot-modal .pbot-retorno').textContent.includes('digite REAL')));
  bt(w, 'Cancelar', $(w, '.pbot-modal')).click();

  // ---------------- perfil só de leitura (sem administrador)
  w = abrir({ a: 1, c: 1, admin: false });
  check('leitura: carregou', await ate(() => $$(w, '.pbot-op-modo').length === 2 && $$(w, '#pbot-op-workflows tbody tr').length === 4));
  check('leitura: sem botões de modo', !modo(w, 0).querySelector('.pbot-seg'));
  check('leitura: sem pausar/retomar', !$$(w, '#pbot-op-workflows button').length);
  check('leitura: sem editar base nem token', !$$(w, '#pbot-op-bases button').length && !$$(w, '#pbot-parametros button').length);
  const r1 = await (await fetch(BASE + '/acao', { method: 'POST', body: JSON.stringify({ acao: 'workflow_ligar', id: 'w1', ativo: false }) })).json();
  check('leitura: acao recusa pausar', !r1.ok && r1.erro.includes('Operação e avisos automáticos > Editar') && estadoN8n().w1 === true, JSON.stringify(r1));
  fs.writeFileSync(path.join(__dirname, 'direitos.json'), JSON.stringify({ plugin_painelbot_avisos: 3, plugin_painelbot_config: 3, config: 1 }));
  const r2 = await (await fetch(BASE + '/acao', { method: 'POST', body: JSON.stringify({ acao: 'base_token', id: 'AAA', token: 'a:bcdefghij' }) })).json();
  check('sem ser administrador: token recusado', !r2.ok && r2.erro.includes('administrador'), JSON.stringify(r2));
  const r3 = await (await fetch(BASE + '/acao', { method: 'POST', body: JSON.stringify({ acao: 'modo_envio', chave: 'semtec_min', valor: '5' }) })).json();
  check('modo_envio só mexe em envio', !r3.ok && r3.erro.includes('só envio'));
  const r4 = await (await fetch(BASE + '/acao', { method: 'POST', body: JSON.stringify({ acao: 'workflow_ligar', id: 'w9', ativo: false }) })).json();
  check('acao recusa pausar workflow fora do bot', !r4.ok && r4.erro.includes('não é um workflow do bot') && estadoN8n().w9 === true);

  console.log('ok: ' + ok + ' falhas: ' + JSON.stringify(falhas));
  process.exit(falhas.length ? 1 : 0);
})();
function estadoFile() { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'n8n-estado.json'), 'utf8')); } catch (e) { return null; } }
