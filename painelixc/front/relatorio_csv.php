<?php

/** Exporta as O.S. filtradas em CSV (GET com os mesmos parâmetros do relatório). */

use GlpiPlugin\Painelixc\Relatorio;

/** @var \DBmysql $DB */
global $DB;

Session::checkRight(\GlpiPlugin\Painelixc\Direito::RELATORIO, READ);
session_write_close();

try {
    $rel = new Relatorio($DB);
    $f = Relatorio::filtros($_GET);
    $csv = $rel->csv($f);
    $nome = sprintf('relatorio-ixc-%s-%s-a-%s.csv', $f['modo'], $f['de'], $f['ate']);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $nome . '"');
    header('Cache-Control: no-store');
    header('Content-Length: ' . strlen($csv));
    echo $csv;
} catch (\Throwable $e) {
    error_log('[painelixc] relatorio_csv: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'erro interno — ver files/_log/php-errors.log (painelixc)';
}
