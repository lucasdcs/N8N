<?php

/**
 * Gera o PDF (POST, validado pelo CSRF do core).
 * Campos: filtros (JSON com os mesmos parâmetros do relatório) e imagens (JSON dimensao => data:image/png;base64,...).
 */

use GlpiPlugin\Painelixc\Relatorio;
use GlpiPlugin\Painelixc\RelatorioPdf;

/** @var \DBmysql $DB */
global $DB;

Session::checkRight(\GlpiPlugin\Painelixc\Direito::RELATORIO, READ);

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    Html::redirect('/plugins/painelixc/front/relatorio.php');
}

try {
    $filtros = json_decode((string) ($_POST['filtros'] ?? '{}'), true);
    $imagens = json_decode((string) ($_POST['imagens'] ?? '{}'), true);
    if (!is_array($filtros)) {
        $filtros = [];
    }
    if (!is_array($imagens)) {
        $imagens = [];
    }
    $imagens = array_filter($imagens, static fn($v, $k) => is_string($k) && is_string($v) && strlen($v) < 4_000_000, ARRAY_FILTER_USE_BOTH);

    $rel = new Relatorio($DB);
    $f = Relatorio::filtros($filtros);
    $dados = $rel->agregar($f);
    $usuario = trim(($_SESSION['glpirealname'] ?? '') . ' ' . ($_SESSION['glpifirstname'] ?? '')) ?: ($_SESSION['glpiname'] ?? 'GLPI');
    $pdf = RelatorioPdf::gerar($dados, $imagens, Relatorio::descreverFiltros($f, $rel->opcoes($f)), $usuario);
    session_write_close();

    $nome = sprintf('relatorio-ixc-%s-%s-a-%s.pdf', $f['modo'], $f['de'], $f['ate']);
    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="' . $nome . '"');
    header('Cache-Control: no-store');
    header('Content-Length: ' . strlen($pdf));
    echo $pdf;
} catch (\Throwable $e) {
    error_log('[painelixc] relatorio_pdf: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Não foi possível gerar o PDF — ver files/_log/php-errors.log (painelixc)';
}
