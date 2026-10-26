<?php

/** JSON da tela Auditoria de Ativação (GET). Exige sessão e direito de leitura. */

use GlpiPlugin\Painelixc\Auditoria;

/** @var \DBmysql $DB */
global $DB;

Session::checkRight(\GlpiPlugin\Painelixc\Direito::AUDITORIA, READ);
session_write_close();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

try {
    $dados = (new Auditoria($DB))->listar();
    echo json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
} catch (\Throwable $e) {
    error_log('[painelixc] auditoria_dados: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    http_response_code(500);
    echo json_encode(['ok' => false, 'erro' => 'erro interno — ver files/_log/php-errors.log (painelixc)']);
}
