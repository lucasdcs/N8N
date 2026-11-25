<?php
// Testes da painelbot 0.5.0 (Operação): Parametros (regras puras), Operacao (parâmetros, bases, token, auditoria) contra o
// Postgres de teste como painel_glpi, e Servicos (n8n/WAHA) com HTTP falso.
// Uso: tests/reset-banco.sh && php tests/teste-operacao.php [pasta do plugin]
define('READ', 1); define('UPDATE', 2); define('DELETE', 4);
$dir = $argv[1] ?? dirname(__DIR__);
spl_autoload_register(function ($c) use ($dir) {
    $p = 'GlpiPlugin\\Painelbot\\';
    if (str_starts_with($c, $p)) { $f = $dir . '/src/' . substr($c, strlen($p)) . '.php'; if (is_file($f)) require $f; }
});
if (!class_exists('Session')) { class Session { public static function haveRight($a, $b) { return true; } } }
use GlpiPlugin\Painelbot\Bot; use GlpiPlugin\Painelbot\ErroDeUso; use GlpiPlugin\Painelbot\Operacao; use GlpiPlugin\Painelbot\Parametros as P;
use GlpiPlugin\Painelbot\Servicos;
$pgh = getenv('PGH') ?: '/tmp/pg'; $pgp = (int) (getenv('PGP') ?: 5499);
$cfg = ['pg_host' => $pgh, 'pg_porta' => $pgp, 'pg_banco' => 'ixc', 'pg_usuario' => 'painel_glpi', 'pg_senha' => 'teste'];
$dono = new PDO("pgsql:host=$pgh;port=$pgp;dbname=ixc", 'ixc', null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$dono->exec(file_get_contents(__DIR__ . '/semente-operacao.sql'));
$bot = new Bot($cfg); $op = new Operacao($bot, 'Teste GLPI');
$ok = 0; $falhas = [];
function check($n, $c, $x = '') { global $ok, $falhas; if ($c) $ok++; else { $falhas[] = $n; echo "  ✘ $n\n$x\n"; } }
function erro(callable $f) { try { $f(); return null; } catch (ErroDeUso $e) { return $e->getMessage(); } }

// ---------------- Parametros::validar (regras puras)
check('modo minúsculo vira maiúsculo', P::validar('envio', ' simular ') === 'SIMULAR');
check('modo inválido', str_contains((string) erro(fn() => P::validar('envio', 'TUDO')), 'NENHUM, SIMULAR ou REAL'));
check('modo lembretes vazio = igual aos avisos', P::validar('envio_lembretes', '') === '');
check('modo avisos não aceita vazio', erro(fn() => P::validar('envio', '')) !== null);
check('sim/nao', P::validar('aviso_privado', 'SIM') === 'sim' && erro(fn() => P::validar('aviso_privado', 'talvez')) !== null);
check('int no limite', P::validar('semtec_min', '0015') === '15' && erro(fn() => P::validar('semtec_min', '0')) !== null && erro(fn() => P::validar('semtec_min', '1441')) !== null);
check('int com letra', erro(fn() => P::validar('semtec_min', '10min')) !== null);
check('hora 0-23', P::validar('realerta_ini', '08') === '8' && erro(fn() => P::validar('realerta_fim', '24')) !== null);
check('horarios ordena e completa zero', P::validar('realerta_horarios', '15:30, 9:00,15:30') === '09:00,15:30');
check('horarios inválido', str_contains((string) erro(fn() => P::validar('realerta_horarios', '11h')), '"11h"'));
check('horarios vazio vale', P::validar('realerta_horarios', '') === '');
check('dias', P::validar('realerta_pular_dias', '6,0') === '0,6' && erro(fn() => P::validar('realerta_pular_dias', '7')) !== null);
check('fone com máscara', P::validar('envio_teste_para', '(41) 99999-0000') === '5541999990000');
check('fone fixo 10 dígitos', P::validar('supervisor_fone', '41 3333-0000') === '554133330000');
check('fone curto', erro(fn() => P::validar('supervisor_fone', '99999')) !== null);
check('fone_ou_vazio', P::validar('infra_fone', '') === '' && erro(fn() => P::validar('envio_teste_para', '')) !== null);
check('jid', P::validar('grupo_automacao', '120363000000000001@g.us') === '120363000000000001@g.us' && erro(fn() => P::validar('grupo_automacao', '5541999990000@c.us')) !== null);
check('jids lista', P::validar('escala_grupos', "1203630001@g.us; 1203630002@g.us 1203630001@g.us") === '1203630001@g.us,1203630002@g.us');
check('jids vazio', erro(fn() => P::validar('setores_grupo', ' ')) !== null);
check('url', P::validar('waha_url', 'http://waha:3000/') === 'http://waha:3000' && erro(fn() => P::validar('waha_url', 'waha:3000')) !== null);
check('sessão', erro(fn() => P::validar('waha_session', 'a b')) !== null);
check('regex', P::validar('planta_assuntos', '^\s*(ativa[çc][ãa]o|vistoria)') !== '' && erro(fn() => P::validar('planta_assuntos', '(abc')) !== null);
check('trocas com validade', P::validar('escala_trocar_nomes', 'Fulano=Beltrano; Ciclano=Beltrano@2026-12-01;') === 'Fulano=Beltrano;Ciclano=Beltrano@2026-12-01');
check('trocas sem =', str_contains((string) erro(fn() => P::validar('escala_trocar_nomes', 'Fulano Beltrano')), 'formato'));
check('texto 1 linha', erro(fn() => P::validar('dono_nome', "a\nb")) !== null && erro(fn() => P::validar('dono_nome', '')) !== null);
check('livre', P::validar('chave_livre', ' qualquer ') === 'qualquer');
check('ligaReal só ao passar para REAL', P::ligaReal('envio', 'REAL', 'SIMULAR') && !P::ligaReal('envio', 'REAL', 'real') && !P::ligaReal('semtec_min', 'REAL', '1'));
check('paraTela', P::paraTela()['semtec_min'] === ['tipo' => 'int', 'rotulo' => P::CATALOGO['semtec_min'][1], 'min' => 1, 'max' => 1440]);

// ---------------- Operacao: parâmetros
$p = fn($k) => $dono->query("SELECT valor FROM ixc.parametros WHERE chave = " . $dono->quote($k))->fetchColumn();
$r = $op->salvarParametro('semtec_min', '15');
check('salvar int', $r['valor'] === '15' && $r['antes'] === '10' && $p('semtec_min') === '15');
$aud = $op->auditoria();
check('auditoria registrou', count($aud) === 1 && $aud[0]['quem'] === 'Teste GLPI' && $aud[0]['acao'] === 'parametro' && $aud[0]['antes'] === '10' && $aud[0]['depois'] === '15', json_encode($aud));
$op->salvarParametro('semtec_min', '15');
check('mesmo valor não audita de novo', count($op->auditoria()) === 1);
check('inválido não grava', erro(fn() => $op->salvarParametro('semtec_min', 'dez')) !== null && $p('semtec_min') === '15');
check('parâmetro inexistente', str_contains((string) erro(fn() => $op->salvarParametro('nao_existe', '1')), 'não cria'));
check('chave estranha', erro(fn() => $op->salvarParametro("x'; drop", '1')) === 'Parâmetro inválido.');
check('REAL sem confirmar', str_contains((string) erro(fn() => $op->salvarParametro('envio', 'REAL')), 'digite REAL') && $p('envio') === 'NENHUM');
check('REAL confirmado errado', erro(fn() => $op->salvarParametro('envio', 'REAL', 'sim')) !== null);
check('REAL confirmado', $op->salvarParametro('envio', 'real', 'real')['valor'] === 'REAL' && $p('envio') === 'REAL');
check('voltar a SIMULAR sem confirmar', $op->salvarParametro('envio', 'SIMULAR')['valor'] === 'SIMULAR');
check('lembretes vazio', $op->salvarParametro('envio_lembretes', '')['valor'] === '' && $op->salvarParametro('envio_lembretes', 'NENHUM')['valor'] === 'NENHUM');
check('fone grava normalizado', $op->salvarParametro('envio_teste_para', '(41) 98888-0000')['valor'] === '5541988880000');
check('filtro de auditoria por alvo', count($op->auditoria(60, 'envio')) === 2);

// ---------------- Operacao: bases
$b = $op->salvarBase('AAA', ['nome' => 'Base A', 'base_url' => 'https://ixc.teste-a.com.br/', 'ativo' => true, 'semtec_sem_local' => false, 'dono_id' => '52', 'ignorar_assuntos' => '30, 12,12', 'assuntos_financeiros' => '']);
$linha = $dono->query("SELECT nome, base_url, semtec_sem_local, ignorar_assuntos::text AS ig, assuntos_financeiros::text AS fi, dono_id, auth FROM ixc.empresas WHERE id = 'AAA'")->fetch(PDO::FETCH_ASSOC);
check('base salva', $linha['nome'] === 'Base A' && $linha['base_url'] === 'https://ixc.teste-a.com.br' && $linha['semtec_sem_local'] === false && $linha['ig'] === '{12,30}' && $linha['fi'] === '{}' && $linha['dono_id'] === '52', json_encode($linha));
check('base não mexe no token', $linha['auth'] === 'Basic dGVzdGU6YQ==');
$a = $op->auditoria(1)[0];
check('auditoria da base só o que mudou', $a['acao'] === 'base' && $a['alvo'] === 'AAA' && json_decode($a['antes'], true) === ['nome' => 'Base Teste A', 'semtec_sem_local' => true, 'ignorar_assuntos' => '30'] && json_decode($a['depois'], true)['ignorar_assuntos'] === '12,30', json_encode($a, JSON_UNESCAPED_UNICODE));
$n = count($op->auditoria(200));
$op->salvarBase('AAA', ['nome' => 'Base A', 'base_url' => 'https://ixc.teste-a.com.br', 'ativo' => true, 'semtec_sem_local' => false, 'dono_id' => '52', 'ignorar_assuntos' => '12,30']);
check('base sem mudança não audita', count($op->auditoria(200)) === $n);
check('base url http', erro(fn() => $op->salvarBase('AAA', ['nome' => 'A', 'base_url' => 'http://ixc.a.com.br'])) !== null);
check('base assunto com letra', str_contains((string) erro(fn() => $op->salvarBase('AAA', ['nome' => 'A', 'base_url' => 'https://ixc.a.com.br', 'ignorar_assuntos' => '12,abc'])), '"abc"'));
check('base dono inválido', erro(fn() => $op->salvarBase('AAA', ['nome' => 'A', 'base_url' => 'https://ixc.a.com.br', 'dono_id' => 'x'])) !== null);
check('base inexistente', str_contains((string) erro(fn() => $op->salvarBase('ZZZ', ['nome' => 'A', 'base_url' => 'https://ixc.a.com.br'])), 'não cria'));
$op->salvarBase('BBB', ['nome' => 'Base Teste B', 'base_url' => 'https://ixc.teste-b.com.br', 'ativo' => true, 'dono_id' => '', 'assuntos_financeiros' => '9,7']);
check('ativar base B (dono vazio = NULL)', $dono->query("SELECT ativo AND dono_id IS NULL FROM ixc.empresas WHERE id = 'BBB'")->fetchColumn() === true);

// ---------------- Operacao: token (grava sem ler)
$op->trocarToken('AAA', 'usuario:chave123');
check('token id:chave vira Basic base64', $dono->query("SELECT auth FROM ixc.empresas WHERE id = 'AAA'")->fetchColumn() === 'Basic ' . base64_encode('usuario:chave123'));
$op->trocarToken('BBB', 'Basic dXN1YXJpbzpjaGF2ZQ==');
check('token já em Basic', $dono->query("SELECT auth FROM ixc.empresas WHERE id = 'BBB'")->fetchColumn() === 'Basic dXN1YXJpbzpjaGF2ZQ==');
check('token com espaço', erro(fn() => $op->trocarToken('AAA', 'abc def ghi')) !== null);
$a = $op->auditoria(1)[0];
check('auditoria do token sem o token', $a['acao'] === 'base_token' && $a['antes'] === '' && $a['depois'] === '(token trocado)' && !str_contains(json_encode($op->auditoria(200)), 'dXN1'));
$le = null; try { $bot->pdo()->query("SELECT auth FROM ixc.empresas"); } catch (\PDOException $e) { $le = $e->getCode(); }
check('painel_glpi continua sem LER o token', $le === '42501');
$le = null; try { $bot->pdo()->exec("INSERT INTO ixc.parametros VALUES ('novo', '1', null)"); } catch (\PDOException $e) { $le = $e->getCode(); }
check('painel_glpi não cria parâmetro', $le === '42501');
$le = null; try { $bot->pdo()->exec("UPDATE ixc.empresas SET last_evento_id = 0"); } catch (\PDOException $e) { $le = $e->getCode(); }
check('painel_glpi não mexe no último evento lido', $le === '42501');
$le = null; try { $bot->pdo()->exec("DELETE FROM ixc.painel_auditoria"); } catch (\PDOException $e) { $le = $e->getCode(); }
check('auditoria não se apaga', $le === '42501');

// ---------------- Bot::dados da aba Operação
$d = $bot->dados(['operacao']);
$ea = array_values(array_filter($d['empresas'], fn($e) => $e['id'] === 'AAA'))[0];
check('dados: empresas com minutos e listas', $ea['minutos_evento'] >= 89 && $ea['ignorar_assuntos'] === '12,30' && $ea['base_url'] !== '' && !array_key_exists('auth', $ea), json_encode($ea));
check('dados: parâmetros completos + tipos + auditoria', count($d['parametros']) === 10 && isset($d['parametros_tipos']['envio']) && count($d['auditoria']) >= 5 && is_int($d['hora_num']));
check('dados: sem operação não traz', !isset($bot->dados(['mensagens'])['parametros_tipos']));
check('Bot::parametro', $bot->parametro('waha_session') === 'sessao_teste' && $bot->parametro('nada') === null);

// ---------------- Servicos (n8n/WAHA) com HTTP falso
$log = [];
$ativo = ['w1' => true, 'w9' => true];
$fake = function ($m, $url, $cab, $corpo) use (&$log, &$ativo) {
    $log[] = "$m $url";
    if (($cab['X-N8N-API-KEY'] ?? $cab['X-Api-Key'] ?? '') === 'ruim') return [401, '{"message":"unauthorized"}'];
    if (str_contains($url, '/api/sessions/')) return [200, json_encode(['status' => 'SCAN_QR_CODE', 'me' => null])];
    if (preg_match('#/workflows/(\w+)/(activate|deactivate)$#', $url, $x)) { $ativo[$x[1]] = $x[2] === 'activate'; return [200, json_encode(['id' => $x[1], 'active' => $ativo[$x[1]]])]; }
    $nome = ['w1' => 'WhatsApp - Notificacoes de chamados IXC (WAHA)', 'w9' => 'Lembrete diario O.S. paradas'];
    if (preg_match('#/workflows/(\w+)$#', $url, $x)) return isset($nome[$x[1]]) ? [200, json_encode(['id' => $x[1], 'name' => $nome[$x[1]], 'active' => $ativo[$x[1]]])] : [404, '{"message":"Not Found"}'];
    if (str_contains($url, '/workflows?')) return [200, json_encode(['data' => [['id' => 'w9', 'name' => $nome['w9'], 'active' => true], ['id' => 'w1', 'name' => $nome['w1'], 'active' => $ativo['w1']]]])];
    if (str_contains($url, 'status=error')) return [200, json_encode(['data' => [['id' => '7', 'workflowId' => 'w1', 'startedAt' => '2026-11-25T10:00:00Z']]])];
    if (str_contains($url, '/executions?')) return [200, json_encode(['data' => [['id' => '9', 'workflowId' => 'w1', 'status' => 'success', 'startedAt' => '2026-11-25T12:00:00Z'], ['id' => '8', 'workflowId' => 'w1', 'status' => 'error']]])];
    return [500, 'x'];
};
$cfgS = ['n8n_url' => 'https://n8n.teste/', 'n8n_chave' => 'k', 'waha_url' => 'https://waha.teste', 'waha_chave' => '', 'n8n_controlaveis' => ''];
$sv = new Servicos($cfgS, $fake);
$w = $sv->workflows();
check('workflows: 3 chamadas, bot primeiro', $w['ok'] && count($log) === 3 && $w['workflows'][0]['id'] === 'w1' && $w['workflows'][0]['apelido'] === 'Avisos de chamado (01)' && $log[0] === 'GET https://n8n.teste/api/v1/workflows?limit=250', json_encode($log));
check('workflows: última = a mais recente', $w['workflows'][0]['ultima']['status'] === 'success' && $w['workflows'][0]['ultimo_erro']['id'] === '7');
check('workflows: fora do bot não controlável', $w['workflows'][1]['controlavel'] === false && $w['workflows'][1]['ultima'] === null);
check('pausar workflow fora do bot', str_contains((string) erro(fn() => $sv->alternar('w9', false)), 'não é um workflow do bot') && $ativo['w9'] === true);
$r = $sv->alternar('w1', false);
check('pausar workflow do bot', $r === ['nome' => 'WhatsApp - Notificacoes de chamados IXC (WAHA)', 'antes' => true, 'depois' => false] && $ativo['w1'] === false && str_ends_with(end($log), '/w1/deactivate'));
$n = count($log); $r = $sv->alternar('w1', false);
check('pausar de novo não chama o n8n', $r['antes'] === false && $r['depois'] === false && count($log) === $n + 1);
check('retomar', $sv->alternar('w1', true)['depois'] === true && $ativo['w1']);
check('id inválido', erro(fn() => $sv->alternar('../x', true)) === 'Workflow inválido.');
check('id liberado na config', (new Servicos(['n8n_controlaveis' => 'w9, x'] + $cfgS, $fake))->controlavel('w9', 'Lembrete diario O.S. paradas'));
check('cópia [SIM] é do bot', $sv->controlavel('s1', '[SIM] WhatsApp - Lembretes de visita IXC (WAHA)'));
$ruim = new Servicos(['n8n_chave' => 'ruim', 'waha_chave' => 'ruim'] + $cfgS, $fake);
check('chave recusada', str_contains($ruim->workflows()['erro'], 'recusou a chave') && str_contains($ruim->waha('s')['erro'], 'WAHA recusou'));
check('sem configuração', !(new Servicos(['n8n_url' => ''] + $cfgS, $fake))->workflows()['ok'] && str_contains((string) erro(fn() => (new Servicos(['n8n_chave' => ''] + $cfgS, $fake))->alternar('w1', true)), 'não configurado'));
check('WAHA status', $sv->waha('sessao_teste') === ['ok' => true, 'status' => 'SCAN_QR_CODE', 'nome' => ''] && !$sv->waha('a b')['ok']);
check('n8n fora do ar', str_contains((new Servicos($cfgS, fn() => [0, 'Connection refused']))->workflows()['erro'], 'não respondeu'));
check('curl de verdade sem servidor', Servicos::curl('GET', 'http://127.0.0.1:9/', [], null)[0] === 0);

echo "ok: $ok falhas: " . json_encode($falhas, JSON_UNESCAPED_UNICODE) . "\n";
exit($falhas ? 1 : 0);
