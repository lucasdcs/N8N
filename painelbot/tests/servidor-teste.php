<?php
require __DIR__ . '/glpi-simulado.php';
$u = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($u === '/dados') { header('Content-Type: application/json'); echo json_encode((new GlpiPlugin\Painelbot\Bot())->dados(['mensagens']), JSON_UNESCAPED_UNICODE); return true; }
if ($u === '/acao') { require (getenv('PBOT') ?: dirname(__DIR__)) . '/front/acao.php'; return true; }
http_response_code(404); return true;
