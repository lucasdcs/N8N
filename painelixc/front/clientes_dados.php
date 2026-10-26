<?php

/**
 * 0.13.0 — aba Clientes (GET, só leitura no IXC):
 *   ?acao=opcoes&base=X        condomínios e tipos de cliente da base
 *   ?acao=buscar&base=X&...    uma página de clientes com os contratos (filtros: ativo, id, razao, fantasia, tipo, condominio, ordem, pagina)
 *   ?acao=csv&base=X&...       todos os clientes do filtro (até Cliente::LIMITE_CSV) em CSV
 *   ?acao=diagnostico&base=X   nomes dos campos das tabelas do IXC (só quem tem a Configuração)
 */

use GlpiPlugin\Painelixc\Cliente;
use GlpiPlugin\Painelixc\Direito;

/** @var \DBmysql $DB */
global $DB;

Session::checkRight(Direito::CLIENTES, READ);
session_write_close();
@set_time_limit(300);

$json = static function (array $r, int $http = 200): never {
    http_response_code($http);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($r, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
};

try {
    $cli = new Cliente($DB);
    $f = Cliente::filtros($_GET);
    $acao = (string) ($_GET['acao'] ?? 'buscar');
    if ($f['base'] === '') {
        $json(['ok' => false, 'erro' => 'Escolha uma base.'], 422);
    }
    if ($acao === 'opcoes') {
        $json($cli->opcoes($f['base']));
    }
    if ($acao === 'diagnostico') {
        if (!Session::haveRight(PLUGIN_PAINELIXC_RIGHT, UPDATE)) {
            $json(['ok' => false, 'erro' => 'Só quem tem a Configuração do Painel IXC.'], 403);
        }
        $json($cli->diagnostico($f['base']));
    }
    if ($acao === 'csv') {
        $r = $cli->csv($f);
        if (!$r['ok']) {
            http_response_code(502);
            header('Content-Type: text/plain; charset=utf-8');
            echo $r['erro'];
            exit;
        }
        $nome = sprintf('clientes-%s_%s.csv', $f['base'], date('Y-m-d_Hi'));
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $nome . '"');
        header('Cache-Control: no-store');
        header('Content-Length: ' . strlen($r['csv']));
        if (!empty($r['avisos'])) {
            header('X-Pixc-Aviso: ' . rawurlencode(mb_substr(implode(' · ', array_slice($r['avisos'], 0, 3)), 0, 600)));
        }
        echo $r['csv'];
        exit;
    }
    $r = $cli->buscar($f);
    $json($r, $r['ok'] ? 200 : 502);
} catch (\Throwable $e) {
    Toolbox::logInFile('php-errors', 'painelixc clientes: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() . "\n");
    $json(['ok' => false, 'erro' => 'Erro interno — ver files/_log/php-errors.log (painelixc).'], 500);
}
