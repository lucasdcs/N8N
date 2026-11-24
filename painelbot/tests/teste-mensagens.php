<?php
// Testes da painelbot 0.4.0 (Mensagens): Editor + Bot contra um Postgres de teste, conectando como painel_glpi.
// Uso: tests/reset-banco.sh && php tests/teste-mensagens.php [pasta do plugin] [socket/host] [porta]
define('READ', 1); define('UPDATE', 2); define('DELETE', 4);
$dir = $argv[1] ?? dirname(__DIR__);
spl_autoload_register(function ($c) use ($dir) {
    $p = 'GlpiPlugin\\Painelbot\\';
    if (str_starts_with($c, $p)) { $f = $dir . '/src/' . substr($c, strlen($p)) . '.php'; if (is_file($f)) require $f; }
});
// Config do GLPI não é usada (cfg de teste); Bot só precisa de CommonDBTM se carregar Config: evitamos.
use GlpiPlugin\Painelbot\Bot; use GlpiPlugin\Painelbot\Editor; use GlpiPlugin\Painelbot\ErroDeUso;
$cfg = ['pg_host' => $argv[2] ?? (getenv('PGH') ?: '/tmp/pg'), 'pg_porta' => (int) ($argv[3] ?? (getenv('PGP') ?: 5499)), 'pg_banco' => 'ixc', 'pg_usuario' => 'painel_glpi', 'pg_senha' => 'teste'];
$bot = new Bot($cfg); $ed = new Editor($bot, 'Teste GLPI');
$ok = 0; $falhas = [];
function check($n, $c, $x = '') { global $ok, $falhas; if ($c) $ok++; else { $falhas[] = $n; echo "  ✘ $n\n$x\n"; } }
function erro(callable $f) { try { $f(); return null; } catch (ErroDeUso $e) { return $e->getMessage(); } }
$m = fn($k) => array_values(array_filter($bot->mensagens()['itens'], fn($x) => $x['chave'] === $k))[0] ?? null;

$d = $bot->mensagens();
check('instalado + colunas040', $d['instalado'] && $d['colunas040']);
check('55 do bot, todas ativas, nenhuma nova', count($d['itens']) === 55 && !array_filter($d['itens'], fn($x) => !$x['ativo'] || $x['nova']));
// --- desativar/ativar qualquer mensagem
$r = $ed->ligarMensagem('escala.cabecalho', false);
check('desativar cabecalho', $r['ativo'] === false && $r['atualizado_por'] === 'Teste GLPI');
check('desativar de novo nao suja historico', count($ed->historico('escala.cabecalho')) === 1);
$ed->ligarMensagem('escala.cabecalho', false);
check('… continua 1 no historico', count($ed->historico('escala.cabecalho')) === 1);
$h = $ed->historico('escala.cabecalho')[0];
check('historico "(desativada)"', $h['depois'] === '(desativada)' && str_contains($h['antes'], 'Resposta automática'), json_encode($h, JSON_UNESCAPED_UNICODE));
$r = $ed->ligarMensagem('escala.cabecalho', true);
check('reativar', $r['ativo'] === true && str_starts_with($ed->historico('escala.cabecalho')[0]['depois'], '(ativada)'));
$ed->ligarMensagem('aviso.novo', false);
check('aviso.novo desativado aparece na lista', $m('aviso.novo')['ativo'] === false);
// texto editado continua valendo depois de desativar/ativar
$ed->salvarMensagem('lembrete.1h', "⏰ Lembrete editado {shopping}");
$ed->ligarMensagem('lembrete.1h', false); $ed->ligarMensagem('lembrete.1h', true);
check('texto editado sobrevive ao desligar/ligar', $m('lembrete.1h')['texto'] === '⏰ Lembrete editado {shopping}' && $m('lembrete.1h')['personalizada']);
check('mensagem inexistente', erro(fn() => $ed->ligarMensagem('nao.existe', false)) !== null);
check('excluir do bot recusa', str_contains((string) erro(fn() => $ed->excluirNova('aviso.novo')), 'Desativar'));

// --- mensagens novas
$n1 = $ed->criarNova('Senha do wi-fi do Jockey', "📶 Wi-fi do Jockey: *JockeyLojistas*\nSenha: _abc123_", "qual a senha do wifi do jockey\nsenha wifi jockey\n\nsenha wifi jockey", 'todos');
check('cria resp.1', $n1['chave'] === 'resp.1' && $n1['nova'] && $n1['ativo'] && !$n1['personalizada']);
check('frases sem repetida', $n1['frases'] === ['qual a senha do wifi do jockey', 'senha wifi jockey'], json_encode($n1['frases']));
check('grupo/ordem/exemplo/wf', $n1['grupo'] === Editor::GRUPO_NOVAS && $n1['ordem'] === -1 && $n1['exemplo'] === 'qual a senha do wifi do jockey' && $n1['wf'] === '03');
check('texto em texto_padrao, texto nulo', $n1['texto'] === null && str_contains($n1['texto_padrao'], 'JockeyLojistas'));
check('criado_por/em', $n1['criado_por'] === 'Teste GLPI' && preg_match('/^\d\d\/\d\d\/\d{4}$/', $n1['criado_em']));
$n2 = $ed->criarNova('Horário do almoxarifado', 'O almoxarifado abre às 8h.', ['horario do almoxarifado', 'almoxarifado abre que horas'], 'recados');
check('cria resp.2 (lista, recados)', $n2['chave'] === 'resp.2' && $n2['grupos'] === 'recados' && $n2['ordem'] === -2);
check('lista: novas primeiro (mais nova no topo)', array_column($bot->mensagens()['itens'], 'chave')[0] === 'resp.2');
// validações
check('sem nome', str_contains((string) erro(fn() => $ed->criarNova('', 'x y', 'aa bb', 'todos')), 'nome'));
check('sem texto', str_contains((string) erro(fn() => $ed->criarNova('Nome ok', '  ', 'aa bb', 'todos')), 'texto'));
check('sem frase', str_contains((string) erro(fn() => $ed->criarNova('Nome ok', 'texto', "\n \n", 'todos')), 'frase'));
check('frase de 1 palavra', str_contains((string) erro(fn() => $ed->criarNova('Nome ok', 'texto', 'wifi', 'todos')), '2 palavras'));
check('variavel no texto', str_contains((string) erro(fn() => $ed->criarNova('Nome ok', 'oi {nome}', 'aa bb', 'todos')), 'não aceita variáveis'));
check('frase ja usada por outra nova', str_contains((string) erro(fn() => $ed->criarNova('Outra', 'x', 'Senha WiFi Jockey!', 'todos')), 'Senha do wi-fi do Jockey'));
$pq = $bot->pdo()->query("SELECT frase FROM ixc.perguntas WHERE alvo = 'financeiro' LIMIT 1")->fetchColumn();
check('frase de pergunta de setor', str_contains((string) erro(fn() => $ed->criarNova('Outra', 'x', $pq, 'todos')), 'Financeiro'), (string) erro(fn() => $ed->criarNova('Outra', 'x', $pq, 'todos')));
check('11 frases', str_contains((string) erro(fn() => $ed->criarNova('Muitas', 'x', implode("\n", array_map(fn($i) => "frase numero $i", range(1, 11))), 'todos')), 'máximo'));
check('grupo invalido vira todos', $ed->criarNova('Grupo X', 'x', 'teste grupo invalido', 'xpto')['grupos'] === 'todos');
check('aspas e barra na frase', $ed->criarNova('Aspas', 'x', 'senha "do" wifi\\ teste', 'todos')['frases'] === ['senha "do" wifi\\ teste']);
check('pergunta com frase de mensagem nova recusa', str_contains((string) erro(fn() => $ed->criarPergunta('n2', 'Senha WiFi Jockey', 'todos')), 'Senha do wi-fi do Jockey'));
check('pergunta comum continua', $ed->criarPergunta('n2', 'tem n2 de plantao', 'todos')['frase'] === 'tem n2 de plantao');
// editar
$e = $ed->editarNova('resp.1', 'Wi-fi Jockey', "📶 Senha nova: _xyz_", "senha wifi jockey\nwifi do jockey", 'recados');
check('editar nova', $e['titulo'] === 'Wi-fi Jockey' && $e['texto_padrao'] === '📶 Senha nova: _xyz_' && $e['frases'] === ['senha wifi jockey', 'wifi do jockey'] && $e['grupos'] === 'recados' && $e['exemplo'] === 'senha wifi jockey');
check('editar mantem a propria frase (sem conflito consigo)', $e['chave'] === 'resp.1');
$hs = $ed->historico('resp.1');
check('historico da nova: criada + texto alterado', count($hs) === 2 && str_starts_with($hs[1]['depois'], '(criada)'), json_encode($hs, JSON_UNESCAPED_UNICODE));
$ed->editarNova('resp.1', 'Wi-fi Jockey 2', "📶 Senha nova: _xyz_", "senha wifi jockey\nwifi do jockey", 'recados');
check('so nome mudou: historico nao cresce', count($ed->historico('resp.1')) === 2);
check('editar do bot recusa', erro(fn() => $ed->editarNova('aviso.novo', 'x', 'y', 'aa bb', 'todos')) !== null);
check('salvarMensagem na nova recusa', str_contains((string) erro(fn() => $ed->salvarMensagem('resp.1', 'x')), 'Editar'));
check('restaurar na nova recusa', erro(fn() => $ed->restaurarMensagem('resp.1')) !== null);
check('conflito ao editar com frase de outra', str_contains((string) erro(fn() => $ed->editarNova('resp.1', 'Wi-fi', 'x', 'horario do almoxarifado', 'todos')), 'Horário do almoxarifado'));
// desativar nova
check('desativar nova', $ed->ligarMensagem('resp.2', false)['ativo'] === false);
// excluir
$ed->excluirNova('resp.2');
check('excluir nova', $m('resp.2') === null);
check('excluir de novo: nao encontrada', str_contains((string) erro(fn() => $ed->excluirNova('resp.2')), 'não encontrada'));
$n5 = $ed->criarNova('Depois de excluir', 'x', 'depois de excluir', 'todos');
check('numero segue o maior existente', $n5['chave'] === 'resp.5', $n5['chave']);
// o que o bot vai ler (mesma consulta dos workflows 0.5.0)
$cfg = $bot->pdo()->query("SELECT coalesce(json_object_agg(m.chave, CASE WHEN (to_jsonb(m)->>'ativo') = 'false' THEN NULL ELSE m.texto END), '{}'::json)::text FROM ixc.mensagens m WHERE m.texto IS NOT NULL OR (to_jsonb(m)->>'ativo') = 'false'")->fetchColumn();
$cfg = json_decode($cfg, true);
check('bot: desativada vem null', array_key_exists('aviso.novo', $cfg) && $cfg['aviso.novo'] === null);
check('bot: editada vem com texto', $cfg['lembrete.1h'] === '⏰ Lembrete editado {shopping}');
check('bot: ativa sem edicao nao vem', !array_key_exists('escala.cabecalho', $cfg));
echo "ok: $ok falhas: " . json_encode($falhas, JSON_UNESCAPED_UNICODE) . "\n";
exit($falhas ? 1 : 0);
