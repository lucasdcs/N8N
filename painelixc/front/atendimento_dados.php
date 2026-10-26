<?php

/** JSON da tela Atendimentos (GET ?modo=abertos|finalizados&de=AAAA-MM-DD&ate=AAAA-MM-DD). Exige sessão e direito de leitura. */

use GlpiPlugin\Painelixc\Atendimento;
use GlpiPlugin\Painelixc\Painel;

/** @var \DBmysql $DB */
global $DB;

Session::checkRight(\GlpiPlugin\Painelixc\Direito::ATENDIMENTO, READ);
session_write_close();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

try {
    $modo = ($_GET['modo'] ?? '') === 'finalizados' ? 'finalizados' : 'abertos';
    $de   = Painel::dia($_GET['de'] ?? null);
    $ate  = Painel::dia($_GET['ate'] ?? null);
    if ($de !== null && $ate !== null && $de > $ate) {
        [$de, $ate] = [$ate, $de];
    }
    $dados = (new Atendimento($DB))->listar($modo, $de, $ate);
    echo json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
} catch (\Throwable $e) {
    error_log('[painelixc] atendimento_dados: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    http_response_code(500);
    echo json_encode(['ok' => false, 'erro' => 'erro interno — ver files/_log/php-errors.log (painelixc)']);
}
