<?php

/** JSON do relatório (GET): ?acao=opcoes | ?acao=agregar&modo=&de=&ate=&bases=1,2&assunto=...&diagnostico=&condominio=&tecnico= */

use GlpiPlugin\Painelixc\Relatorio;

/** @var \DBmysql $DB */
global $DB;

Session::checkRight(\GlpiPlugin\Painelixc\Direito::RELATORIO, READ);
session_write_close();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

try {
    $rel = new Relatorio($DB);
    $acao = $_GET['acao'] ?? 'agregar';
    if ($acao === 'opcoes') {
        $dados = ['ok' => true] + $rel->opcoes(Relatorio::filtros($_GET));
    } else {
        $dados = $rel->agregar(Relatorio::filtros($_GET));
    }
    echo json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
} catch (\Throwable $e) {
    error_log('[painelixc] relatorio_dados: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    http_response_code(500);
    echo json_encode(['ok' => false, 'erro' => 'erro interno — ver files/_log/php-errors.log (painelixc)']);
}
