<?php

/**
 * 0.13.3 (P13-6) — detalhe de um atendimento, ao vivo no IXC (GET, só leitura):
 *   ?base=X&id=N                     O.S., mensagens e anexos do atendimento N
 *   ?acao=diagnostico&base=X&id=N    nomes dos campos das tabelas do IXC (só quem tem a Configuração)
 *   ?acao=sla&base=X&id=N            campos de SLA/prazo/datas do atendimento N e das O.S. dele (só quem tem a Configuração)
 */

use GlpiPlugin\Painelixc\AtendimentoDetalhe;
use GlpiPlugin\Painelixc\Direito;

/** @var \DBmysql $DB */
global $DB;

Session::checkRight(Direito::ATENDIMENTO, READ);
session_write_close();
@set_time_limit(300);   // até 7 consultas ao IXC em sequência (40 s de limite cada)

$json = static function (array $r, int $http = 200): never {
    http_response_code($http);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($r, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
};

try {
    $base = preg_replace('/[^a-z0-9_-]/', '', strtolower((string) ($_GET['base'] ?? ''))) ?? '';
    $id = max(0, (int) ($_GET['id'] ?? 0));
    if ($base === '' || $id === 0) {
        $json(['ok' => false, 'erro' => 'Informe a base e o atendimento.'], 422);
    }
    $det = new AtendimentoDetalhe($DB);
    if (($_GET['acao'] ?? '') === 'diagnostico') {
        if (!Session::haveRight(PLUGIN_PAINELIXC_RIGHT, UPDATE)) {
            $json(['ok' => false, 'erro' => 'Só quem tem a Configuração do Painel IXC.'], 403);
        }
        $json($det->diagnostico($base, $id));
    }
    if (($_GET['acao'] ?? '') === 'sla') {   // 0.13.4.2: onde o IXC guarda o SLA (só quem tem a Configuração)
        if (!Session::haveRight(PLUGIN_PAINELIXC_RIGHT, UPDATE)) {
            $json(['ok' => false, 'erro' => 'Só quem tem a Configuração do Painel IXC.'], 403);
        }
        $json($det->diagnosticoSla($base, $id));
    }
    $r = $det->buscar($base, $id);
    $json($r, $r['ok'] ? 200 : 502);
} catch (\Throwable $e) {
    Toolbox::logInFile('php-errors', 'painelixc atendimento_detalhe: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() . "\n");
    $json(['ok' => false, 'erro' => 'Erro interno — ver files/_log/php-errors.log (painelixc).'], 500);
}
