<?php
// n8n, WAHA e IXC falsos para os testes da aba Operação (0.5.0/0.5.1) (php -S 127.0.0.1:8766 tests/n8n-falso.php). Chave aceita: "k".
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
// 0.5.1: IXC falso (último evento para a base nova). Token aceito: u:segredo
if (preg_match('#^/ixc/(\w+)/webservice/v1/su_oss_chamado_mensagem$#', $p, $x)) {
    if (($h['authorization'] ?? '') !== 'Basic ' . base64_encode('u:segredo')) return $js(200, ['type' => 'error', 'message' => 'Token inválido']);
    $b = json_decode(file_get_contents('php://input'), true);
    if (($b['sortorder'] ?? '') !== 'desc' || ($b['rp'] ?? '') !== '1') return $js(200, ['type' => 'error', 'message' => 'consulta errada']);
    return $js(200, $x[1] === 'VAZIA' ? ['page' => '1', 'total' => 0] : ['page' => '1', 'total' => 5, 'registros' => [['id' => '7777']]]);
}
// 0.5.1: webhook "Rodar agora (painel)": grava a chave recebida em n8n-rodou.txt
if (preg_match('#^/webhook/((sim-)?painelbot-rodar-\d\d)$#', $p, $x) && $m === 'POST') {
    file_put_contents(__DIR__ . '/n8n-rodou.txt', $x[1] . ' ' . ($h['x-painelbot-chave'] ?? '') . "\n", FILE_APPEND);
    return $js(200, ['message' => 'Workflow was started']);
}
if (str_starts_with($p, '/api/sessions/')) {
    if (($h['x-api-key'] ?? '') !== 'w') return $js(401, ['message' => 'Unauthorized']);
    $sess = ['name' => substr($p, 14), 'status' => 'WORKING', 'me' => ['id' => '5541900000000@c.us', 'pushName' => 'Bot Teste']];
    return $js(200, getenv('WAHA_LISTA') ? [['name' => 'outra', 'status' => 'STOPPED'], $sess] : $sess);   // 0.5.1: WAHA que devolve lista
}
if (($h['x-n8n-api-key'] ?? '') !== 'k') return $js(401, ['message' => 'unauthorized']);
$rodar = ['w1' => 'painelbot-rodar-01', 's1' => 'sim-painelbot-rodar-01'];   // 0.5.1: w2 sem o webhook (bot antigo)
$w = function ($id) use (&$st, $nomes, $rodar) { return ['id' => $id, 'name' => $nomes[$id], 'active' => $st[$id],
    'nodes' => isset($rodar[$id]) ? [['name' => 'Rodar agora (painel)', 'type' => 'n8n-nodes-base.webhook', 'parameters' => ['path' => $rodar[$id]]]] : [], 'updatedAt' => '2026-11-20T10:00:00.000Z']; };
if ($p === '/api/v1/workflows' && $m === 'GET') return $js(200, ['data' => array_map($w, array_keys($nomes)), 'nextCursor' => null]);
if (preg_match('#^/api/v1/workflows/(\w+)(/(activate|deactivate))?$#', $p, $x)) {
    if (!isset($nomes[$x[1]])) return $js(404, ['message' => 'Not found']);
    if (($x[3] ?? '') !== '' && $m === 'POST') { $st[$x[1]] = $x[3] === 'activate'; file_put_contents($arq, json_encode($st)); }
    return $js(200, $w($x[1]));
}
if ($p === '/api/v1/executions') {
    if (($q['status'] ?? '') === 'running') return $js(200, ['data' => ($q['workflowId'] ?? '') === 's1' ? [['id' => '700', 'workflowId' => 's1', 'status' => 'running']] : []]);
    $agora = gmdate('Y-m-d\TH:i:s.000\Z', time() - 120);
    $e = ($q['status'] ?? '') === 'error'
        ? [['id' => '501', 'workflowId' => 'w1', 'status' => 'error', 'startedAt' => gmdate('Y-m-d\TH:i:s.000\Z', time() - 7200)]]
        : [['id' => '600', 'workflowId' => 'w1', 'status' => 'success', 'startedAt' => $agora], ['id' => '599', 'workflowId' => 'w1', 'status' => 'error', 'startedAt' => $agora],
           ['id' => '598', 'workflowId' => 'w2', 'status' => 'success', 'startedAt' => $agora]];
    return $js(200, ['data' => $e, 'nextCursor' => null]);
}
return $js(404, ['message' => 'rota']);
