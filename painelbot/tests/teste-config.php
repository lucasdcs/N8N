<?php
// 0.5.0: Config::valoresDoPost com os campos novos (n8n/WAHA). Uso: php tests/teste-config.php
require __DIR__ . '/glpi-simulado.php';
use GlpiPlugin\Painelbot\Config;
$ok = 0; $falhas = [];
function check($n, $c) { global $ok, $falhas; if ($c) $ok++; else { $falhas[] = $n; echo "  ✘ $n\n"; } }
$cif = fn($s) => 'CIFRADO(' . $s . ')';
$atual = ['pg_host' => 'h', 'pg_porta' => 5432, 'pg_banco' => 'ixc', 'pg_usuario' => 'u', 'n8n_url' => 'https://velho'];
$base = ['pg_host' => 'h', 'pg_porta' => '5432', 'pg_banco' => 'ixc', 'pg_usuario' => 'u'];
$v = Config::valoresDoPost($base + ['pg_senha' => ' s ', 'n8n_url' => 'https://n8n.x.com.br/', 'n8n_chave' => ' k ', 'waha_url' => 'javascript:alert(1)',
    'n8n_controlaveis' => 'a1, b-2, ../x', 'waha_apagar_chave' => '1'], $atual, $cif);
check('senha do banco como digitada', $v['pg_senha'] === 'CIFRADO( s )');
check('chave do n8n cifrada sem espaços', $v['n8n_chave'] === 'CIFRADO(k)');
check('url sem barra final', $v['n8n_url'] === 'https://n8n.x.com.br');
check('url inválida mantém a atual', $v['waha_url'] === '');
check('apagar chave', $v['waha_chave'] === '');
check('ids pausáveis filtrados', $v['n8n_controlaveis'] === 'a1,b-2');
$v = Config::valoresDoPost($base, $atual, $cif);
check('campos ausentes não mexem', !isset($v['n8n_url']) && !isset($v['pg_senha']) && !isset($v['n8n_chave']));
check('ftp recusado', Config::valoresDoPost($base + ['n8n_url' => 'ftp://x'], $atual, $cif)['n8n_url'] === 'https://velho');
check('vazio desliga', Config::valoresDoPost($base + ['n8n_url' => ''], $atual, $cif)['n8n_url'] === '');
check('padrões novos', array_key_exists('n8n_chave', Config::PADROES) && array_key_exists('waha_url', Config::PADROES));
echo "ok: $ok falhas: " . json_encode($falhas) . "\n";
exit($falhas ? 1 : 0);
