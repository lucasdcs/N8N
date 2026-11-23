<?php

/**
 * JSON do Painel do Bot (GET, só leitura no Postgres `ixc`):
 *   ?acao=tudo   dados das seções que o perfil vê (seção sem Visualizar não vem)
 */

use GlpiPlugin\Painelbot\Bot;
use GlpiPlugin\Painelbot\Direito;

$json = static function (array $r, int $http = 200): never {
    http_response_code($http);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($r, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
};

$secoes = Direito::secoes();
if ($secoes === []) {
    $json(['ok' => false, 'erro' => 'Sem acesso ao Painel do Bot.'], 403);
}
session_write_close();

try {
    $acao = (string) ($_GET['acao'] ?? 'tudo');
    if ($acao !== 'tudo') {
        $json(['ok' => false, 'erro' => 'Ação desconhecida.'], 400);
    }
    $json((new Bot())->dados($secoes));
} catch (\RuntimeException $e) {
    $json(['ok' => false, 'erro' => $e->getMessage()], 502);   // conexão/config: mensagem já pensada para a tela
} catch (\Throwable $e) {
    Toolbox::logInFile('php-errors', 'painelbot dados: ' . Bot::limparErro($e->getMessage()) . ' @ ' . $e->getFile() . ':' . $e->getLine() . "\n");
    $json(['ok' => false, 'erro' => 'Erro ao ler o banco do bot — ver files/_log/php-errors.log (painelbot).'], 500);
}
