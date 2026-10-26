<?php

/**
 * Entrada do n8n: POST JSON com header "Authorization: Bearer <token>".
 * Sem sessão do GLPI (registrado como stateless + no_check no setup.php).
 */

use Glpi\Http\JSONResponse;
use GlpiPlugin\Painelixc\Atendimento;
use GlpiPlugin\Painelixc\Auditoria;
use GlpiPlugin\Painelixc\Config;
use GlpiPlugin\Painelixc\Ingest;

/** @var \DBmysql $DB */
global $DB;

$responder = static function (int $codigo, array $dados): never {
    http_response_code($codigo);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
};

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    $responder(405, ['ok' => false, 'erro' => 'use POST']);
}

try {
    $esperado = (string) Config::get('ingest_token');
    // O Apache costuma descartar o header Authorization antes do PHP; por isso aceita também X-Painel-Token
    // e tenta ler o Authorization direto dos headers da requisição.
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($auth === '' && function_exists('getallheaders')) {
        foreach ((array) getallheaders() as $k => $v) {
            if (strcasecmp((string) $k, 'Authorization') === 0) {
                $auth = (string) $v;
                break;
            }
        }
    }
    $recebido = stripos($auth, 'Bearer ') === 0 ? trim(substr($auth, 7)) : '';
    if ($recebido === '') {
        $recebido = trim((string) ($_SERVER['HTTP_X_PAINEL_TOKEN'] ?? ''));
    }
    if (strlen($esperado) < 20 || $recebido === '' || !hash_equals($esperado, $recebido)) {
        $responder(401, ['ok' => false, 'erro' => 'token inválido']);
    }

    $bruto = file_get_contents('php://input') ?: '';
    $p = json_decode($bruto, true);
    if (!is_array($p)) {
        $responder(400, ['ok' => false, 'erro' => 'JSON inválido: ' . json_last_error_msg()]);
    }

    // tipo "auditorias" vem do workflow "Painel IXC - Auditoria"; "atendimentos", do "Painel IXC - Atendimentos";
    // os demais, do coletor de O.S.
    $r = match ($p['tipo'] ?? '') {
        'auditorias'   => (new Auditoria($DB))->receber($p),
        'atendimentos' => (new Atendimento($DB))->receber($p),
        default        => (new Ingest($DB))->receber($p),
    };
    $codigo = (int) ($r['http'] ?? 200);
    unset($r['http']);
    $responder($codigo, $r);
} catch (\Throwable $e) {
    $msg = 'painelixc ingest: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine();
    Toolbox::logInFile('php-errors', $msg . "\n");
    error_log('[' . $msg . ']');
    $responder(500, ['ok' => false, 'erro' => 'erro interno — ver files/_log/php-errors.log e o error.log do Apache (painelixc): ' . mb_substr($e->getMessage(), 0, 200)]);
}
