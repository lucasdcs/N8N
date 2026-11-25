<?php
// n8n e WAHA falsos para os testes da aba Operação (php -S 127.0.0.1:8766 tests/n8n-falso.php). Chave aceita: "k".
// Estado (ativo de cada workflow) em n8n-estado.json; apagar o arquivo reinicia.
$arq = __DIR__ . '/n8n-estado.json';
$st = is_file($arq) ? json_decode(file_get_contents($arq), true) : ['w1' => true, 'w2' => true, 'w9' => true, 's1' => false];
$nomes = ['w1' => 'WhatsApp - Notificacoes de chamados IXC (WAHA)', 'w2' => 'WhatsApp - Lembretes de visita IXC (WAHA)',
          'w9' => 'Lembrete diario O.S. paradas', 's1' => '[SIM] WhatsApp - Notificacoes de chamados IXC (WAHA)'];
$u = parse_url($_SERVER['REQUEST_URI']); $p = $u['path']; parse_str($u['query'] ?? '', $q);
$m = $_SERVER['REQUEST_METHOD'];
$h = array_change_key_case(getallheaders());
$js = function ($c, $o) { http_response_code($c); header('Content-Type: application/json'); echo json_encode($o); return true; };
file_put_contents(__DIR__ . '/n8n-log.txt', "$m $p " . json_encode($q) . "\n", FILE_APPEND);
if (str_starts_with($p, '/api/sessions/')) {
    if (($h['x-api-key'] ?? '') !== 'w') return $js(401, ['message' => 'Unauthorized']);
    return $js(200, ['name' => substr($p, 14), 'status' => 'WORKING', 'me' => ['id' => '5541900000000@c.us', 'pushName' => 'Bot Teste']]);
}
if (($h['x-n8n-api-key'] ?? '') !== 'k') return $js(401, ['message' => 'unauthorized']);
$w = function ($id) use (&$st, $nomes) { return ['id' => $id, 'name' => $nomes[$id], 'active' => $st[$id], 'updatedAt' => '2026-11-20T10:00:00.000Z']; };
if ($p === '/api/v1/workflows' && $m === 'GET') return $js(200, ['data' => array_map($w, array_keys($nomes)), 'nextCursor' => null]);
if (preg_match('#^/api/v1/workflows/(\w+)(/(activate|deactivate))?$#', $p, $x)) {
    if (!isset($nomes[$x[1]])) return $js(404, ['message' => 'Not found']);
    if (($x[3] ?? '') !== '' && $m === 'POST') { $st[$x[1]] = $x[3] === 'activate'; file_put_contents($arq, json_encode($st)); }
    return $js(200, $w($x[1]));
}
if ($p === '/api/v1/executions') {
    $agora = gmdate('Y-m-d\TH:i:s.000\Z', time() - 120);
    $e = ($q['status'] ?? '') === 'error'
        ? [['id' => '501', 'workflowId' => 'w1', 'status' => 'error', 'startedAt' => gmdate('Y-m-d\TH:i:s.000\Z', time() - 7200)]]
        : [['id' => '600', 'workflowId' => 'w1', 'status' => 'success', 'startedAt' => $agora], ['id' => '599', 'workflowId' => 'w1', 'status' => 'error', 'startedAt' => $agora],
           ['id' => '598', 'workflowId' => 'w2', 'status' => 'success', 'startedAt' => $agora]];
    return $js(200, ['data' => $e, 'nextCursor' => null]);
}
return $js(404, ['message' => 'rota']);
