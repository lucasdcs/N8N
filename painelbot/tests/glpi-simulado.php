<?php
// GLPI simulado para rodar front/acao.php e o Bot fora do GLPI (teste da tela). Direitos em direitos.json.
define('READ', 1); define('UPDATE', 2); define('DELETE', 4);
spl_autoload_register(function ($c) { $p = 'GlpiPlugin\\Painelbot\\'; if (str_starts_with($c, $p)) require (getenv('PBOT') ?: dirname(__DIR__)) . '/src/' . substr($c, strlen($p)) . '.php'; });
class CommonGLPI {} class CommonDBTM extends CommonGLPI {}
class Config { public static function getConfigurationValues($ctx, $k = []) { return ['pg_host' => getenv('PGH') ?: '/tmp/pg', 'pg_porta' => (int) (getenv('PGP') ?: 5499), 'pg_banco' => 'ixc', 'pg_usuario' => 'painel_glpi', 'pg_senha' => 'x']; } }
class GLPIKey { public function decrypt($s) { return $s; } }
class Toolbox { public static function logInFile($a, $b) { file_put_contents('' . __DIR__ . '/php-errors.log', $b, FILE_APPEND); } }
class Session {
  public static function haveRight($a, $b) { $d = json_decode((string) @file_get_contents(__DIR__ . '/direitos.json'), true) ?: []; return (($d[$a] ?? 0) & $b) === $b; }
  public static function getLoginUserID() { return 7; }
  public static function checkRight($a, $b) {}
}
$_SESSION = ['glpifriendlyname' => 'Fulano GLPI'];
