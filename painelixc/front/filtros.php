<?php

/**
 * Filtros salvos (JSON). GET ?tela=painel|relatorio|atendimento lista; POST JSON {acao, ...} altera.
 * O POST vem como XMLHttpRequest com o header X-Glpi-Csrf-Token: o core valida o CSRF antes de chegar aqui.
 */

use GlpiPlugin\Painelixc\Direito;
use GlpiPlugin\Painelixc\Filtro;

/** @var \DBmysql $DB */
global $DB;

if (!Direito::algumaLeitura()) {
    Session::checkRight(Direito::OS, READ);   // acesso negado padrão
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$saida = static function (array $r, int $http = 200): never {
    http_response_code($http);
    echo json_encode($r, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
};

try {
    $filtros = new Filtro($DB);
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $corpo = json_decode((string) file_get_contents('php://input'), true);
        if (!is_array($corpo)) {
            $saida(['ok' => false, 'erro' => 'Corpo inválido.'], 400);
        }
        $tela = Filtro::tela($corpo['tela'] ?? null);
        if (!Filtro::pode($tela, READ)) {
            $saida(['ok' => false, 'erro' => 'Seu perfil não tem acesso a esta tela.'], 403);
        }
        $acao = (string) ($corpo['acao'] ?? '');
        $r = match ($acao) {
            'salvar'  => $filtros->salvar($tela, $corpo),
            'padrao'  => $filtros->padrao($tela, (int) ($corpo['id'] ?? 0), !empty($corpo['ligar'])),
            'excluir' => $filtros->excluir($tela, (int) ($corpo['id'] ?? 0)),
            default   => ['ok' => false, 'erro' => 'Ação desconhecida.'],
        };
        $r['lista'] = $filtros->listar($tela);
        $saida($r, $r['ok'] ? 200 : 422);
    }
    session_write_close();
    $tela = Filtro::tela($_GET['tela'] ?? null);
    if (!Filtro::pode($tela, READ)) {
        $saida(['ok' => false, 'erro' => 'Seu perfil não tem acesso a esta tela.', 'lista' => []], 403);
    }
    $saida(['ok' => true, 'lista' => $filtros->listar($tela)]);
} catch (\Throwable $e) {
    Toolbox::logInFile('php-errors', 'painelixc filtros: ' . $e->getMessage() . "\n");
    $saida(['ok' => false, 'erro' => 'Erro interno ao tratar filtros salvos.'], 500);
}
