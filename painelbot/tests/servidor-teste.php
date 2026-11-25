<?php
require __DIR__ . '/glpi-simulado.php';
$u = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
// /dados = seção mensagens (0.4.x); /dados/operacao,parametros = as seções pedidas (0.5.0)
if (str_starts_with($u, '/dados')) { header('Content-Type: application/json'); $sec = trim(substr($u, 6), '/'); echo json_encode((new GlpiPlugin\Painelbot\Bot())->dados($sec === '' ? ['mensagens'] : explode(',', $sec)), JSON_UNESCAPED_UNICODE); return true; }
if ($u === '/acao') { require (getenv('PBOT') ?: dirname(__DIR__)) . '/front/acao.php'; return true; }
http_response_code(404); return true;
