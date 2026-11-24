<?php
// Teste de Install::migrar (0.4.0: Excluir em Mensagens para admins) com o banco do GLPI simulado. Uso: php tests/teste-migracao.php
define('READ', 1); define('UPDATE', 2); define('DELETE', 4);
class DBConnection {} class ProfileRight {}
class Config { public static $v = []; public static function getConfigurationValues($c, $k = []) { return self::$v; } public static function setConfigurationValues($c, $v) { self::$v = $v + self::$v; } }
class DBmysql {
  public $rows; public $upd = [];
  public function request($q) { return array_values(array_filter($this->rows, fn($r) => $r['name'] === $q['WHERE']['name'])); }
  public function update($t, $set, $w) { foreach ($this->rows as &$r) if ($r['id'] === $w['id']) $r['rights'] = $set['rights']; $this->upd[] = $w['id']; }
}
spl_autoload_register(function ($c) { $p = 'GlpiPlugin\\Painelbot\\'; if (str_starts_with($c, $p)) require dirname(__DIR__) . '/src/' . substr($c, strlen($p)) . '.php'; });
// Config do plugin estende CommonDBTM: stub
class CommonGLPI {} class CommonDBTM extends CommonGLPI {}
$DB = new DBmysql();
$DB->rows = [
  ['id' => 1, 'profiles_id' => 4, 'name' => 'config', 'rights' => 3], ['id' => 2, 'profiles_id' => 4, 'name' => 'plugin_painelbot_mensagens', 'rights' => 3],   // super-admin: ganha DELETE
  ['id' => 3, 'profiles_id' => 6, 'name' => 'config', 'rights' => 1], ['id' => 4, 'profiles_id' => 6, 'name' => 'plugin_painelbot_mensagens', 'rights' => 3],   // sem config UPDATE: nao muda
  ['id' => 5, 'profiles_id' => 7, 'name' => 'config', 'rights' => 3], ['id' => 6, 'profiles_id' => 7, 'name' => 'plugin_painelbot_mensagens', 'rights' => 1],   // admin so com ver: nao muda
];
$_SESSION['glpiactiveprofile'] = ['id' => 4, 'plugin_painelbot_mensagens' => 3];
GlpiPlugin\Painelbot\Install::migrar($DB);
$r = array_column($DB->rows, 'rights', 'id');
$ok = $r[2] === 7 && $r[4] === 3 && $r[6] === 1 && $_SESSION['glpiactiveprofile']['plugin_painelbot_mensagens'] === 7 && Config::$v['migracao'] === '0.4.0';
$DB->rows[1]['rights'] = 3;  // admin tirou o Excluir depois: rodar de novo nao devolve
GlpiPlugin\Painelbot\Install::migrar($DB);
$ok2 = $DB->rows[1]['rights'] === 3 && count($DB->upd) === 1;
echo ($ok ? 'migracao ok' : 'MIGRACAO ERRADA ' . json_encode($r)), ' | ', ($ok2 ? 'so uma vez ok' : 'RODOU DE NOVO'), "\n";
