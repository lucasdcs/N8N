<?php

/** JSON das abas (GET). Exige sessão e direito de leitura. */

use GlpiPlugin\Painelixc\Painel;

/** @var \DBmysql $DB */
global $DB;

Session::checkRight(\GlpiPlugin\Painelixc\Direito::OS, READ);
session_write_close();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

try {
    $painel = new Painel($DB);
    $aba = ($_GET['aba'] ?? 'abertas') === 'resolvidas' ? 'resolvidas' : 'abertas';
    if ($aba === 'resolvidas') {
        $ate = Painel::dia($_GET['ate'] ?? null) ?? date('Y-m-d');
        $de  = Painel::dia($_GET['de'] ?? null) ?? date('Y-m-d', strtotime($ate . ' -30 days'));
        if ($de > $ate) {
            [$de, $ate] = [$ate, $de];
        }
        $dados = $painel->resolvidas($de, $ate);
    } else {
        $dados = $painel->abertas();
    }
    echo json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
} catch (\Throwable $e) {
    error_log('[painelixc] dados: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    http_response_code(500);
    echo json_encode(['ok' => false, 'erro' => 'erro interno — ver files/_log/php-errors.log (painelixc)']);
}
