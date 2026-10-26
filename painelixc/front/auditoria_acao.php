<?php

/**
 * Botões da tela Auditoria (POST JSON {id, acao}). O core valida o CSRF (header X-Glpi-Csrf-Token).
 * Só executa para quem tem o direito "Auditoria → Atualizar" no perfil (0.12.0).
 */

use GlpiPlugin\Painelixc\AcaoAuditoria;
use GlpiPlugin\Painelixc\Config;

/** @var \DBmysql $DB */
global $DB;

Session::checkRight(\GlpiPlugin\Painelixc\Direito::AUDITORIA, READ);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$saida = static function (array $r, int $http = 200): never {
    http_response_code($http);
    echo json_encode($r, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
};

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    $saida(['ok' => false, 'mensagem' => 'use POST'], 405);
}
if (!Config::podeAgir()) {
    $saida(['ok' => false, 'mensagem' => 'Seu perfil não tem o direito "Auditoria → Atualizar" (Administração > Perfis > Painel IXC).'], 403);
}
try {
    $corpo = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($corpo)) {
        $saida(['ok' => false, 'mensagem' => 'Corpo inválido.'], 400);
    }
    $usuario = trim((string) ($_SESSION['glpifriendlyname'] ?? $_SESSION['glpiname'] ?? ''));
    $r = (new AcaoAuditoria($DB))->executar((int) ($corpo['id'] ?? 0),
        is_array($corpo['acoes'] ?? null) ? array_slice(array_map('strval', $corpo['acoes']), 0, 10) : (string) ($corpo['acao'] ?? ''),
        (int) Session::getLoginUserID(), $usuario !== '' ? $usuario : ('usuário #' . Session::getLoginUserID()));
    $http = (int) ($r['http'] ?? ($r['ok'] ? 200 : 500));
    unset($r['http']);
    session_write_close();
    $saida($r, $http);
} catch (\Throwable $e) {
    Toolbox::logInFile('php-errors', 'painelixc auditoria_acao: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() . "\n");
    $saida(['ok' => false, 'mensagem' => 'Erro interno — ver files/_log/php-errors.log (painelixc).'], 500);
}
