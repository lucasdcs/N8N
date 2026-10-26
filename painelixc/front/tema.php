<?php

/**
 * 0.12.0 — grava o tema do usuário (POST JSON {tema: claro|escuro|auto}).
 * O POST vem com o header X-Glpi-Csrf-Token: o core valida o CSRF antes de chegar aqui.
 */

use GlpiPlugin\Painelixc\Direito;
use GlpiPlugin\Painelixc\Preferencia;

/** @var \DBmysql $DB */
global $DB;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (!Direito::algumaLeitura()) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'erro' => 'sem acesso ao painel']);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'erro' => 'use POST']);
    exit;
}
try {
    $corpo = json_decode((string) file_get_contents('php://input'), true);
    $tema = Preferencia::salvarTema((string) (is_array($corpo) ? ($corpo['tema'] ?? '') : ''), $DB);
    session_write_close();
    echo json_encode(['ok' => true, 'tema' => $tema]);
} catch (\Throwable $e) {
    Toolbox::logInFile('php-errors', 'painelixc tema: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() . "\n");
    http_response_code(500);
    echo json_encode(['ok' => false, 'erro' => 'erro interno — ver files/_log/php-errors.log (painelixc)']);
}
