// Teste de tela da painelbot 0.4.0 (Mensagens): painel.js real no jsdom; gravações no acao.php real (GLPI simulado) + Postgres de teste.
// Uso: npm i jsdom@24 (fora do plugin) ; php -S 127.0.0.1:8765 tests/servidor-teste.php ; node tests/tela-mensagens.js
// PBOT_ANTIGO = pasta com o sql/ da 0.3.1 (banco sem as colunas da 0.4.0).
const { JSDOM } = require('jsdom'); const fs = require('fs'); const { execSync } = require('child_process');
const JS = fs.readFileSync(require('path').join(__dirname, '..', 'public/js/painel.js'), 'utf8');
const BASE = 'http://127.0.0.1:8765';
const sql = q => execSync(`psql -h ${process.env.PGH || '/tmp/pg'} -p ${process.env.PGP || 5499} -U ixc -d ixc -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0; const falhas = [];
const check = (n, c, x) => { if (c) ok++; else { falhas.push(n); console.log('  ✘', n, x === undefined ? '' : '\n' + x); } };
const espera = ms => new Promise(r => setTimeout(r, ms));
async function ate(f, ms = 3000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (f()) return true; } catch (e) {} await espera(30); } return false; }
function abrir(direitos) {
  fs.writeFileSync(require('path').join(__dirname, 'direitos.json'), JSON.stringify({ plugin_painelbot_mensagens: direitos.m, plugin_painelbot_perguntas: direitos.p }));
  const D = { mensagens: { ver: !!(direitos.m & 1), editar: !!(direitos.m & 2), excluir: !!(direitos.m & 4) }, perguntas: { ver: !!(direitos.p & 1), editar: !!(direitos.p & 2), excluir: !!(direitos.p & 4) } };
  const html = `<html><head><meta property="glpi:csrf_token" content="x"></head><body><div id="pbot" data-api="${BASE}/dados" data-acao="${BASE}/acao" data-direitos='${JSON.stringify(D)}'>
    <span id="pbot-status"></span><div id="pbot-erro" hidden></div>
    <section class="pbot-sec" data-sec="mensagens"><div class="pbot-msg"><div class="pbot-msg-lista"><input type="search" id="pbot-busca-msg"><div class="pbot-chips" id="pbot-msg-filtros"></div><div id="pbot-msg-itens"></div></div><div class="pbot-msg-ed" id="pbot-msg-ed"></div></div></section>
    <section class="pbot-sec" data-sec="variaveis"><div class="pbot-tabela-wrap"><table class="pbot-tabela" id="pbot-variaveis"></table></div><div id="pbot-var-form"></div></section>
  </div></body></html>`;
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: BASE + '/' });
  const w = dom.window;
  w.fetch = (u, o) => fetch(new URL(u, BASE), o);   // fetch do Node
  w.confirm = () => true;
  w.eval(JS);
  w.dispatchEvent(new w.Event('load'));
  return w;
}
const $ = (w, s) => w.document.querySelector(s);
const $$ = (w, s) => Array.from(w.document.querySelectorAll(s));
const bt = (w, txt, raiz) => Array.from((raiz || w.document).querySelectorAll('button')).find(b => b.textContent.trim().startsWith(txt));
const digitar = (w, elx, v) => { elx.value = v; elx.dispatchEvent(new w.Event('input')); };
const item = (w, titulo) => $$(w, '.pbot-msg-item').find(b => b.querySelector('.pbot-msg-t').firstChild.textContent === titulo);

(async () => {
  execSync(require('path').join(__dirname, 'reset-banco.sh') + ' 2>/dev/null');
  // ---------------- perfil com tudo
  let w = abrir({ m: 7, p: 7 });
  check('carregou', await ate(() => $$(w, '.pbot-msg-item').length === 55));
  const bNova = bt(w, 'Nova mensagem');
  check('botao Nova mensagem', !!bNova);
  bNova.click();
  check('formulario de nova', $(w, '#pbot-msg-ed h3').textContent === 'Nova mensagem');
  const [iNome] = $$(w, '#pbot-msg-ed input.form-control'); const [iFr, iTx] = $$(w, '#pbot-msg-ed textarea'); const iGr = $(w, '#pbot-msg-ed select');
  const bCriar = bt(w, 'Criar mensagem');
  check('Criar desabilitado vazio', bCriar.disabled);
  digitar(w, iNome, 'Senha do wi-fi do Jockey');
  digitar(w, iFr, 'qual a senha do wifi do jockey\nwifi');
  check('frase de 1 palavra: erro na tela', /2 palavras/.test($(w, '#pbot-msg-ed .pbot-ed-chk').textContent) && bCriar.disabled, $(w, '#pbot-msg-ed .pbot-ed-chk').textContent);
  digitar(w, iFr, 'qual a senha do wifi do jockey\nsenha wifi jockey');
  check('falta texto', /Falta o texto/.test($(w, '#pbot-msg-ed .pbot-ed-chk').textContent));
  digitar(w, iTx, '📶 Wi-fi: *JockeyLojistas* · senha _abc123_ · dúvidas (41) 99999-0001');
  check('Criar habilitado', !bCriar.disabled, $(w, '#pbot-msg-ed .pbot-ed-chk').textContent);
  check('pre-visualizacao com pergunta e texto', /qual a senha do wifi do jockey/.test($(w, '.pbot-wa-q').textContent) && /<b>JockeyLojistas<\/b>/.test($(w, '.pbot-wa-bolha').innerHTML));
  const tIn = $(w, '#pbot-msg-ed .pbot-pq-teste input');
  digitar(w, tIn, 'Bom dia! Qual a senha do Wi-Fi do Jockey?');
  check('teste aciona', /aciona esta mensagem/.test($(w, '#pbot-msg-ed .pbot-pq-res').textContent));
  digitar(w, tIn, 'Bom dia, senha Wi-Fi Jockey?'); check('teste aciona com hifen na mensagem', /aciona esta/.test($(w, '#pbot-msg-ed .pbot-pq-res').textContent));
  digitar(w, iFr, 'qual a senha do wi-fi do jockey\nsenha wifi jockey'); check('dica do hifen', /sem hífen/.test($(w, '#pbot-msg-ed .pbot-ed-chk').textContent), $(w, '#pbot-msg-ed .pbot-ed-chk').textContent);
  digitar(w, iFr, 'qual a senha do wifi do jockey\nsenha wifi jockey');
  digitar(w, tIn, 'senha do jockey'); check('teste nao aciona', /não aciona/.test($(w, '#pbot-msg-ed .pbot-pq-res').textContent));
  bCriar.click();
  check('criou e selecionou', await ate(() => /Mensagem criada/.test(($(w, '#pbot-ret-texto') || {}).textContent || '')) && $(w, '#pbot-msg-ed h3').textContent === 'Senha do wi-fi do Jockey');
  check('gravou no banco', sql("SELECT titulo||'|'||array_to_string(frases_norm,';')||'|'||grupos||'|'||criado_por FROM ixc.mensagens WHERE chave='resp.1'") === 'Senha do wi-fi do Jockey|qual a senha do wifi do jockey;senha wifi jockey|todos|Fulano GLPI');
  check('lista: grupo Novas no topo', $$(w, '.pbot-msg-grupo')[0].textContent.startsWith('Mensagens novas') && item(w, 'Senha do wi-fi do Jockey'));
  check('filtro Novas', !!$$(w, '#pbot-msg-filtros button').find(b => b.textContent === 'Novas 1'));
  // segunda: conflito de frase
  bt(w, 'Nova mensagem').click();
  let [n2, ] = $$(w, '#pbot-msg-ed input.form-control'); let [f2, t2] = $$(w, '#pbot-msg-ed textarea');
  digitar(w, n2, 'Outra'); digitar(w, f2, 'Senha WiFi Jockey'); digitar(w, t2, 'x');
  check('conflito com outra nova na tela', /já aciona a mensagem "Senha do wi-fi do Jockey"/.test($(w, '#pbot-msg-ed .pbot-ed-chk').textContent) && bt(w, 'Criar mensagem').disabled);
  const pq = sql("SELECT frase FROM ixc.perguntas WHERE alvo='rh' LIMIT 1");
  digitar(w, f2, pq);
  check('conflito com pergunta de setor', /RH \(Perguntas\)/.test($(w, '#pbot-msg-ed .pbot-ed-chk').textContent), $(w, '#pbot-msg-ed .pbot-ed-chk').textContent);
  digitar(w, f2, 'horario do almoxarifado'); digitar(w, t2, 'Abre às 8h.'); $(w, '#pbot-msg-ed select').value = 'recados'; $(w, '#pbot-msg-ed select').dispatchEvent(new w.Event('change'));
  bt(w, 'Criar mensagem').click();
  check('criou a 2a (recados)', await ate(() => sql("SELECT grupos FROM ixc.mensagens WHERE chave='resp.2'") === 'recados'));
  // Cancelar formulario com algo digitado
  bt(w, 'Nova mensagem').click(); digitar(w, $$(w, '#pbot-msg-ed input.form-control')[0], 'rascunho');
  bt(w, 'Cancelar').click();
  check('cancelar volta para a lista', await ate(() => $(w, '#pbot-msg-ed h3') && $(w, '#pbot-msg-ed h3').textContent !== 'Nova mensagem'));
  // editar a 1a
  item(w, 'Senha do wi-fi do Jockey').click();
  const bSal = bt(w, 'Salvar', $(w, '#pbot-msg-ed'));
  check('editar: Salvar desabilitado sem mudanca', bSal && bSal.disabled);
  digitar(w, $$(w, '#pbot-msg-ed textarea')[1], '📶 Senha nova: _xyz_');
  check('editar: Salvar habilitado', !bSal.disabled);
  bSal.click();
  check('editou no banco', await ate(() => sql("SELECT texto_padrao FROM ixc.mensagens WHERE chave='resp.1'") === '📶 Senha nova: _xyz_'));
  // historico
  bt(w, 'Histórico', $(w, '#pbot-msg-ed')).click();
  check('historico com criada + alteracao', await ate(() => $$(w, '.pbot-hist-it').length === 2));
  // desativar a nova
  let sw = $(w, '#pbot-msg-ed .pbot-ed-ativa .pbot-sw');
  check('chave Ativa', sw && sw.classList.contains('on') && /Ativa/.test($(w, '.pbot-ed-ativa').textContent));
  sw.click();
  check('desativou (banco + tela)', await ate(() => sql("SELECT ativo FROM ixc.mensagens WHERE chave='resp.1'") === 'f' && /Desativada/.test($(w, '.pbot-ed-ativa').textContent)));
  check('tag desativada na lista + nota', /desativada/.test(item(w, 'Senha do wi-fi do Jockey').textContent) && !!$(w, '#pbot-msg-ed .pbot-msg-off'));
  check('filtro Desativadas aparece', !!$$(w, '#pbot-msg-filtros button').find(b => b.textContent === 'Desativadas 1'));
  // desativar mensagem do bot
  item(w, 'Chamado aberto com técnico').click();
  sw = $(w, '#pbot-msg-ed .pbot-ed-ativa .pbot-sw'); sw.click();
  check('desativou aviso.novo', await ate(() => sql("SELECT ativo FROM ixc.mensagens WHERE chave='aviso.novo'") === 'f'));
  check('mensagem do bot: sem botao Excluir', !bt(w, 'Excluir', $(w, '#pbot-msg-ed')));
  $(w, '#pbot-msg-ed .pbot-ed-ativa .pbot-sw').click();
  check('reativou aviso.novo', await ate(() => sql("SELECT ativo FROM ixc.mensagens WHERE chave='aviso.novo'") === 't'));
  // busca por frase
  digitar(w, $(w, '#pbot-busca-msg'), 'almoxarifado');
  check('busca acha pela frase', $$(w, '.pbot-msg-item').length === 1);
  digitar(w, $(w, '#pbot-busca-msg'), '');
  // excluir (2 cliques)
  item(w, 'horario do almoxarifado') ? null : null;
  const it2 = $$(w, '.pbot-msg-item').find(b => /Abre às 8h/.test(b.textContent)); it2.click();
  const bEx = bt(w, 'Excluir', $(w, '#pbot-msg-ed')); bEx.click();
  check('excluir pede confirmacao', /confirmar/.test(bEx.textContent) && sql("SELECT count(*) FROM ixc.mensagens WHERE chave='resp.2'") === '1');
  bEx.click();
  check('excluiu', await ate(() => sql("SELECT count(*) FROM ixc.mensagens WHERE chave='resp.2'") === '0' && !$$(w, '.pbot-msg-item').some(b => /Abre às 8h/.test(b.textContent))));
  // ---------------- 0.4.1: aba Variáveis e {shopping}
  check('aba variaveis vazia', /Nenhuma variável/.test($(w, '#pbot-variaveis').textContent));
  bt(w, 'Nova variável').click();
  let [vN, vD] = $$(w, '#pbot-var-form input'); let vV = $(w, '#pbot-var-form textarea');
  digitar(w, vN, 'Holding!'); digitar(w, vV, 'x'); bt(w, 'Criar variável').click();
  check('nome invalido na tela', /minúsculas/.test($(w, '#pbot-var-form .pbot-retorno').textContent));
  digitar(w, vN, '{holding}'); digitar(w, vV, '4BTELECOM'); digitar(w, vD, 'Empresa dona'); bt(w, 'Criar variável').click();
  check('variavel criada (banco + tabela)', await ate(() => sql("SELECT texto_padrao FROM ixc.mensagens WHERE chave='var.holding'") === '4BTELECOM' && /\{holding\}/.test($(w, '#pbot-variaveis').textContent)));
  check('variavel nao aparece em Mensagens', !$$(w, '.pbot-msg-item').some(b => /holding/i.test(b.textContent)));
  // mensagem nova com {shopping} e {holding}
  bt(w, 'Nova mensagem').click();
  let [h1] = $$(w, '#pbot-msg-ed input.form-control'); let [hf, ht] = $$(w, '#pbot-msg-ed textarea');
  digitar(w, h1, 'Holding dos Shopping'); digitar(w, hf, 'qual holding do jockey'); digitar(w, ht, 'Holding do *{shopping}* é {holding}');
  check('{shopping} sem frase: erro', /coloque \{shopping\} na frase/.test($(w, '#pbot-msg-ed .pbot-ed-chk').textContent));
  check('chip so {holding}', $$(w, '#pbot-msg-ed .pbot-var-bt').map(b => b.textContent).join() === '{holding}');
  digitar(w, hf, 'qual holding do {shopping}');
  check('chips {shopping} + {holding}', $$(w, '#pbot-msg-ed .pbot-var-bt').map(b => b.textContent).join() === '{shopping},{holding}');
  digitar(w, ht, 'Holding do *{shopping}* é {holdin}');
  check('variavel inexistente: erro', /Variável que não existe: \{holdin\}/.test($(w, '#pbot-msg-ed .pbot-ed-chk').textContent) && bt(w, 'Criar mensagem').disabled);
  digitar(w, ht, 'Holding do *{shopping}* é {holding}');
  check('preview com valores', /Holding do <b>Jockey Plaza<\/b> é 4BTELECOM/.test($(w, '#pbot-msg-ed .pbot-wa-bolha').innerHTML), $(w, '#pbot-msg-ed .pbot-wa-bolha').innerHTML);
  const tIn2 = $(w, '#pbot-msg-ed .pbot-pq-teste input');
  digitar(w, tIn2, 'Qual holding do Palladium Curitiba?');
  check('teste com shopping', /shopping: "palladium curitiba"/.test($(w, '#pbot-msg-ed .pbot-pq-res').textContent), $(w, '#pbot-msg-ed .pbot-pq-res').textContent);
  digitar(w, tIn2, 'qual holding do ?');
  check('teste sem shopping: todos', /sem shopping: responde todos/.test($(w, '#pbot-msg-ed .pbot-pq-res').textContent), $(w, '#pbot-msg-ed .pbot-pq-res').textContent);
  bt(w, 'Criar mensagem').click();
  check('criou com {shopping}', await ate(() => sql("SELECT frases_norm[1] FROM ixc.mensagens WHERE titulo='Holding dos Shopping'") === 'qual holding do {shopping}'));
  // aba variáveis: usada em, editar, excluir bloqueado
  {
    w.pbot.recarregar(); await ate(() => /Holding dos Shopping/.test($(w, '#pbot-variaveis').textContent));
  }
  check('usada em', /Holding dos Shopping/.test($(w, '#pbot-variaveis').textContent));
  $(w, '#pbot-variaveis button[title^="Editar"]').click();
  check('editar: nome somente leitura', $$(w, '#pbot-var-form input')[0].readOnly);
  digitar(w, $(w, '#pbot-var-form textarea'), '4B Telecom'); bt(w, 'Salvar', $(w, '#pbot-var-form')).click();
  check('editou valor', await ate(() => sql("SELECT texto_padrao FROM ixc.mensagens WHERE chave='var.holding'") === '4B Telecom'));
  let xb = $(w, '#pbot-variaveis button[title^="Excluir"]'); xb.click(); xb.click();
  check('excluir usada: recusa com o nome da mensagem', await ate(() => /Holding dos Shopping/.test($(w, '#pbot-var-ret').textContent) && $(w, '#pbot-var-ret').classList.contains('erro')));
  $(w, '#pbot-variaveis .pbot-sw').click();
  check('desativar variavel', await ate(() => sql("SELECT ativo FROM ixc.mensagens WHERE chave='var.holding'") === 'f' && /desativada/.test($(w, '#pbot-var-ret').textContent)));
  w.close();

  // ---------------- perfil só Visualizar
  w = abrir({ m: 1, p: 1 });
  await ate(() => $$(w, '.pbot-msg-item').length === 57);
  check('so ver: sem Nova mensagem', !bt(w, 'Nova mensagem'));
  item(w, 'Senha do wi-fi do Jockey').click();
  check('so ver: campos somente leitura, sem chave, pill desativada', $$(w, '#pbot-msg-ed textarea').every(t => t.readOnly) && !$(w, '#pbot-msg-ed .pbot-sw') && /desativada/.test($(w, '.pbot-ed-ativa').textContent));
  check('so ver: aba variaveis sem Nova/editar/chave', !bt(w, 'Nova variável') && !$(w, '#pbot-variaveis .pbot-sw') && !$(w, '#pbot-variaveis button[title^="Editar"]'));
  check('so ver: sem Salvar/Excluir, com Historico', !bt(w, 'Salvar', $(w, '#pbot-msg-ed')) && !bt(w, 'Excluir', $(w, '#pbot-msg-ed')) && !!bt(w, 'Histórico', $(w, '#pbot-msg-ed')));
  w.close();
  // ---------------- editar sem excluir: sem botao Excluir; servidor recusa
  w = abrir({ m: 3, p: 0 });
  await ate(() => $$(w, '.pbot-msg-item').length === 57);
  item(w, 'Senha do wi-fi do Jockey').click();
  check('editar sem excluir: sem botao Excluir', !bt(w, 'Excluir', $(w, '#pbot-msg-ed')) && !!bt(w, 'Salvar', $(w, '#pbot-msg-ed')));
  const r = await (await fetch(BASE + '/acao', { method: 'POST', body: JSON.stringify({ acao: 'mensagem_excluir', chave: 'resp.1' }) })).json();
  check('servidor recusa excluir sem direito', r.ok === false && /Excluir/.test(r.erro), JSON.stringify(r));
  // sem Perguntas > Visualizar: conflito com pergunta so o servidor pega
  bt(w, 'Nova mensagem').click();
  let [n3] = $$(w, '#pbot-msg-ed input.form-control'); let [f3, t3] = $$(w, '#pbot-msg-ed textarea');
  digitar(w, n3, 'Teste RH'); digitar(w, f3, pq); digitar(w, t3, 'x'); bt(w, 'Criar mensagem').click();
  check('sem ver perguntas: servidor pega o conflito', await ate(() => /RH \(Perguntas\)/.test($(w, '#pbot-ret-texto').textContent)), $(w, '#pbot-ret-texto').textContent);
  w.close();
  // ---------------- banco sem o SQL 01 novo: sem botao, aviso
  execSync(require('path').join(__dirname, 'reset-banco.sh') + ' ' + (process.env.PBOT_ANTIGO || '/tmp/pb031') + ' 2>/dev/null');
  w = abrir({ m: 7, p: 7 });
  await ate(() => $$(w, '.pbot-msg-item').length === 55);
  check('banco antigo: sem botao Nova, com aviso do SQL', !bt(w, 'Nova mensagem') && /sql\/01/.test($(w, '#pbot-msg-topo').textContent));
  check('banco antigo: sem chave Ativa', !$(w, '#pbot-msg-ed .pbot-ed-ativa'));
  w.close();
  console.log('ok:', ok, 'falhas:', JSON.stringify(falhas)); process.exit(falhas.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
