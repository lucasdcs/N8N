<?php

namespace GlpiPlugin\Painelbot;

/**
 * 0.5.0 — o painel fala com o n8n (API pública, chave X-N8N-API-KEY) e com o WAHA (X-Api-Key), a partir do servidor do GLPI.
 * Endereços e chaves ficam na Configuração do plugin (chaves cifradas com a GLPIKey, nunca vão para a tela).
 *
 * Só os workflows do bot (nomes em NOMES_BOT, ou ids listados em n8n_controlaveis) podem ser pausados/retomados aqui:
 * os demais workflows do n8n aparecem só para leitura (ex.: o lembrete diário de O.S. paradas fica fora do painel).
 */
final class Servicos
{
    /** Nomes dos workflows do whatsapp-ixc (e as cópias "[SIM] ..." do simulador). */
    public const NOMES_BOT = [
        'WhatsApp - Notificacoes de chamados IXC (WAHA)'       => 'Avisos de chamado (01)',
        'WhatsApp - Lembretes de visita IXC (WAHA)'            => 'Lembretes de visita (02)',
        'WhatsApp - Comandos ixc e consulta de escala (WAHA)'  => 'Bot de escalas e comandos (03)',
        'Escalas - Sync planilha ESCALAS (aba HOJE) (WAHA)'    => 'Escala da planilha (04)',
    ];
    public const TIMEOUT = 6;

    /** @var callable(string,string,array<string,string>,?string):array{0:int,1:string} */
    private $http;

    /** @param array<string,mixed> $cfg n8n_url, n8n_chave, waha_url, waha_chave, n8n_controlaveis (chaves já decifradas) */
    public function __construct(private array $cfg, ?callable $http = null)
    {
        $this->http = $http ?? [self::class, 'curl'];
    }

    /** Configuração do plugin com as chaves decifradas. */
    public static function daConfig(): self
    {
        $c = Config::todos();
        $dec = static function ($s): string {
            $s = (string) $s;
            if ($s === '') {
                return '';
            }
            try {
                return (string) (new \GLPIKey())->decrypt($s);
            } catch (\Throwable $e) {
                return '';
            }
        };
        return new self([
            'n8n_url'          => (string) ($c['n8n_url'] ?? ''),
            'n8n_chave'        => $dec($c['n8n_chave'] ?? ''),
            'waha_url'         => (string) ($c['waha_url'] ?? ''),
            'waha_chave'       => $dec($c['waha_chave'] ?? ''),
            'n8n_controlaveis' => (string) ($c['n8n_controlaveis'] ?? ''),
        ]);
    }

    /** @param array<string,string> $cab @return array{0:int,1:string} */
    public static function curl(string $metodo, string $url, array $cab, ?string $corpo): array
    {
        if (!function_exists('curl_init')) {
            return [0, 'o PHP do servidor não tem a extensão curl'];
        }
        $h = curl_init($url);
        $linhas = ['Accept: application/json'];
        foreach ($cab as $k => $v) {
            $linhas[] = $k . ': ' . $v;
        }
        if ($corpo !== null) {
            $linhas[] = 'Content-Type: application/json';
        }
        curl_setopt_array($h, [
            CURLOPT_CUSTOMREQUEST  => $metodo,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => $linhas,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT        => self::TIMEOUT,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        ]);
        if ($corpo !== null) {
            curl_setopt($h, CURLOPT_POSTFIELDS, $corpo);
        }
        $r = curl_exec($h);
        $st = (int) curl_getinfo($h, CURLINFO_RESPONSE_CODE);
        $err = curl_error($h);
        curl_close($h);
        return [$st, $r === false ? $err : (string) $r];
    }

    /** @return array{0:int,1:mixed} status + JSON decodificado (ou a mensagem de erro) */
    private function chamar(string $base, string $cabChave, string $chave, string $metodo, string $caminho, ?array $corpo = null): array
    {
        [$st, $txt] = ($this->http)($metodo, rtrim($base, '/') . $caminho, [$cabChave => $chave], $corpo === null ? null : json_encode($corpo));
        $j = json_decode($txt, true);
        return [$st, $j === null && $txt !== 'null' ? $txt : $j];
    }

    private function n8n(string $metodo, string $caminho): array
    {
        return $this->chamar($this->cfg['n8n_url'], 'X-N8N-API-KEY', $this->cfg['n8n_chave'], $metodo, $caminho);
    }

    public function temN8n(): bool
    {
        return $this->cfg['n8n_url'] !== '' && $this->cfg['n8n_chave'] !== '';
    }

    public function temWaha(): bool
    {
        return $this->cfg['waha_url'] !== '';
    }

    /** Mensagem de erro curta e sem segredo. */
    private static function erroHttp(int $st, mixed $r, string $quem): string
    {
        if ($st === 0) {
            return $quem . ' não respondeu (' . mb_substr((string) $r, 0, 120) . ').';
        }
        if ($st === 401 || $st === 403) {
            return $quem . ' recusou a chave (HTTP ' . $st . '): confira a chave em Configurar > Geral > Painel do Bot.';
        }
        $m = is_array($r) ? (string) ($r['message'] ?? '') : mb_substr(strip_tags((string) $r), 0, 120);
        return $quem . ' respondeu HTTP ' . $st . ($m !== '' ? ': ' . $m : '') . '.';
    }

    /** O workflow pode ser pausado/retomado pelo painel? */
    public function controlavel(string $id, string $nome): bool
    {
        $ids = array_filter(array_map('trim', explode(',', $this->cfg['n8n_controlaveis'])));
        $base = preg_replace('/^\[SIM\]\s*/', '', $nome) ?? $nome;
        return in_array($id, $ids, true) || isset(self::NOMES_BOT[$base]);
    }

    /**
     * Workflows do n8n com a última execução e o último erro (2 chamadas de execuções para todos, não 2 por workflow).
     * @return array{ok:bool, erro?:string, workflows?:list<array<string,mixed>>}
     */
    public function workflows(): array
    {
        if (!$this->temN8n()) {
            return ['ok' => false, 'erro' => 'n8n não configurado: preencha o endereço e a chave da API em Configurar > Geral > Painel do Bot.'];
        }
        [$st, $r] = $this->n8n('GET', '/api/v1/workflows?limit=250');
        if ($st !== 200 || !is_array($r) || !is_array($r['data'] ?? null)) {
            return ['ok' => false, 'erro' => self::erroHttp($st, $r, 'n8n')];
        }
        $ult = $err = [];
        [$s1, $e1] = $this->n8n('GET', '/api/v1/executions?limit=250');
        foreach ($s1 === 200 && is_array($e1['data'] ?? null) ? $e1['data'] : [] as $x) {
            $ult[(string) ($x['workflowId'] ?? '')] ??= $x;
        }
        [$s2, $e2] = $this->n8n('GET', '/api/v1/executions?status=error&limit=100');
        foreach ($s2 === 200 && is_array($e2['data'] ?? null) ? $e2['data'] : [] as $x) {
            $err[(string) ($x['workflowId'] ?? '')] ??= $x;
        }
        $out = [];
        foreach ($r['data'] as $w) {
            $id = (string) ($w['id'] ?? '');
            $nome = (string) ($w['name'] ?? '');
            $base = preg_replace('/^\[SIM\]\s*/', '', $nome) ?? $nome;
            $u = $ult[$id] ?? null;
            $e = $err[$id] ?? null;
            $out[] = [
                'id'          => $id,
                'nome'        => $nome,
                'apelido'     => self::NOMES_BOT[$base] ?? '',
                'simulador'   => str_starts_with($nome, '[SIM]'),
                'ativo'       => (bool) ($w['active'] ?? false),
                'atualizado'  => (string) ($w['updatedAt'] ?? ''),
                'controlavel' => $this->controlavel($id, $nome),
                'rodar'       => self::caminhoRodar($w) !== null,   // 0.5.1: tem o webhook "Rodar agora (painel)" (whatsapp-ixc 0.6.5)
                'ultima'      => $u ? ['status' => (string) ($u['status'] ?? ($u['finished'] ?? false ? 'success' : '')), 'inicio' => (string) ($u['startedAt'] ?? ''), 'fim' => (string) ($u['stoppedAt'] ?? '')] : null,
                'ultimo_erro' => $e ? ['id' => (string) ($e['id'] ?? ''), 'inicio' => (string) ($e['startedAt'] ?? '')] : null,
            ];
        }
        usort($out, fn($a, $b) => [$a['apelido'] === '', $a['simulador'], $a['apelido'] ?: $a['nome']] <=> [$b['apelido'] === '', $b['simulador'], $b['apelido'] ?: $b['nome']]);
        return ['ok' => true, 'workflows' => $out, 'execucoes_lidas' => $s1 === 200];
    }

    /**
     * Pausa (desativa) ou retoma (ativa) um workflow do bot. Devolve [nome, ativo antes].
     * @return array{nome:string, antes:bool, depois:bool}
     */
    public function alternar(string $id, bool $ativar): array
    {
        if (!$this->temN8n()) {
            throw new ErroDeUso('n8n não configurado: preencha o endereço e a chave da API em Configurar > Geral > Painel do Bot.');
        }
        if (!preg_match('/^[A-Za-z0-9_-]{1,40}$/', $id)) {
            throw new ErroDeUso('Workflow inválido.');
        }
        [$st, $w] = $this->n8n('GET', '/api/v1/workflows/' . $id);
        if ($st !== 200 || !is_array($w)) {
            throw new ErroDeUso(self::erroHttp($st, $w, 'n8n'));
        }
        $nome = (string) ($w['name'] ?? '');
        if (!$this->controlavel($id, $nome)) {
            throw new ErroDeUso('"' . $nome . '" não é um workflow do bot: o painel não pausa nem retoma este.');
        }
        $antes = (bool) ($w['active'] ?? false);
        if ($antes === $ativar) {
            return ['nome' => $nome, 'antes' => $antes, 'depois' => $antes];
        }
        [$st, $r] = $this->n8n('POST', '/api/v1/workflows/' . $id . ($ativar ? '/activate' : '/deactivate'));
        if ($st !== 200) {
            throw new ErroDeUso(self::erroHttp($st, $r, 'n8n'));
        }
        return ['nome' => $nome, 'antes' => $antes, 'depois' => $ativar];   // 200 = o n8n aplicou
    }

    /** 0.5.1: caminho do webhook "Rodar agora (painel)" do workflow (whatsapp-ixc 0.6.5), ou null. */
    public static function caminhoRodar(array $w): ?string
    {
        foreach (is_array($w['nodes'] ?? null) ? $w['nodes'] : [] as $n) {
            if (($n['name'] ?? '') === 'Rodar agora (painel)' && str_ends_with((string) ($n['type'] ?? ''), '.webhook')) {
                $p = (string) ($n['parameters']['path'] ?? '');
                return preg_match('/^[A-Za-z0-9_-]{1,80}$/', $p) ? $p : null;
            }
        }
        return null;
    }

    /**
     * 0.5.1: roda agora um workflow do bot, pelo webhook "Rodar agora (painel)" com a chave do banco (painel_rodar_chave).
     * Recusa se estiver pausado ou já rodando. O workflow tem a trava de rodada (0.6.5): se a última começou há pouco,
     * ele mesmo não faz nada (o painel avisa).
     * @return array{nome:string}
     */
    public function rodar(string $id, string $chave): array
    {
        if (!$this->temN8n()) {
            throw new ErroDeUso('n8n não configurado: preencha o endereço e a chave da API em Configurar > Geral > Painel do Bot.');
        }
        if (!preg_match('/^[A-Za-z0-9_-]{1,40}$/', $id)) {
            throw new ErroDeUso('Workflow inválido.');
        }
        if ($chave === '') {
            throw new ErroDeUso('Falta a chave do Rodar agora no banco do bot: rode o painelbot/sql/01 desta versão.');
        }
        [$st, $w] = $this->n8n('GET', '/api/v1/workflows/' . $id);
        if ($st !== 200 || !is_array($w)) {
            throw new ErroDeUso(self::erroHttp($st, $w, 'n8n'));
        }
        $nome = (string) ($w['name'] ?? '');
        if (!$this->controlavel($id, $nome)) {
            throw new ErroDeUso('"' . $nome . '" não é um workflow do bot: o painel não roda este.');
        }
        if (empty($w['active'])) {
            throw new ErroDeUso('"' . $nome . '" está pausado: retome antes de rodar.');
        }
        $caminho = self::caminhoRodar($w);
        if ($caminho === null) {
            throw new ErroDeUso('"' . $nome . '" ainda não tem o "Rodar agora": atualize o bot para a whatsapp-ixc 0.6.5.');
        }
        [$s2, $e] = $this->n8n('GET', '/api/v1/executions?workflowId=' . rawurlencode($id) . '&status=running&limit=1');
        if ($s2 === 200 && is_array($e['data'] ?? null) && $e['data'] !== []) {
            throw new ErroDeUso('"' . $nome . '" já está rodando agora: aguarde terminar.');
        }
        [$s3, $r] = ($this->http)('POST', rtrim($this->cfg['n8n_url'], '/') . '/webhook/' . $caminho, ['x-painelbot-chave' => $chave], '{"origem":"painel"}');
        if ($s3 !== 200) {
            throw new ErroDeUso($s3 === 404 ? 'O n8n não achou o webhook /webhook/' . $caminho . ' (workflow publicado com a versão 0.6.5?).' : self::erroHttp($s3, $r, 'n8n'));
        }
        return ['nome' => $nome];
    }

    /**
     * 0.5.1: id do último evento (su_oss_chamado_mensagem) do IXC, para a base nova começar dali (sem ler o histórico).
     * $auth = valor do cabeçalho Authorization ("Basic ..."). @return int
     */
    public function ultimoEventoIxc(string $baseUrl, string $auth): int
    {
        $corpo = json_encode(['qtype' => 'su_oss_chamado_mensagem.id', 'query' => '0', 'oper' => '>', 'page' => '1', 'rp' => '1',
                              'sortname' => 'su_oss_chamado_mensagem.id', 'sortorder' => 'desc']);
        [$st, $txt] = ($this->http)('POST', rtrim($baseUrl, '/') . '/webservice/v1/su_oss_chamado_mensagem', ['Authorization' => $auth, 'ixcsoft' => 'listar'], $corpo);
        $j = json_decode($txt, true);
        if ($st !== 200 || !is_array($j)) {
            throw new ErroDeUso(self::erroHttp($st, $j ?? $txt, 'IXC'));
        }
        if (($j['type'] ?? '') === 'error') {
            throw new ErroDeUso('O IXC recusou: ' . mb_substr((string) ($j['message'] ?? ''), 0, 150) . ' (token sem permissão em su_oss_chamado_mensagem?).');
        }
        if (!array_key_exists('total', $j)) {
            throw new ErroDeUso('Resposta inesperada do IXC (sem "total"): confira o endereço.');
        }
        $id = (int) ($j['registros'][0]['id'] ?? 0);
        return max(0, $id);
    }

    /** Sessão do WhatsApp no WAHA. @return array{ok:bool, erro?:string, status?:string, nome?:string} */
    public function waha(string $sessao): array
    {
        if (!$this->temWaha()) {
            return ['ok' => false, 'erro' => 'WAHA não configurado: preencha o endereço (visto do servidor do GLPI) em Configurar > Geral > Painel do Bot.'];
        }
        if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', $sessao)) {
            return ['ok' => false, 'erro' => 'Parâmetro waha_session vazio ou inválido.'];
        }
        [$st, $r] = $this->chamar($this->cfg['waha_url'], 'X-Api-Key', $this->cfg['waha_chave'], 'GET', '/api/sessions/' . $sessao);
        if ($st !== 200 || !is_array($r)) {
            return ['ok' => false, 'erro' => self::erroHttp($st, $r, 'WAHA')];
        }
        if (array_is_list($r)) {   // 0.5.1: WAHA/simulador que devolve a lista de sessões
            $r = array_values(array_filter($r, fn($x) => is_array($x) && ($x['name'] ?? '') === $sessao))[0] ?? ($r[0] ?? []);
        }
        if (($r['status'] ?? '') === '') {
            return ['ok' => false, 'erro' => 'O WAHA não informou o status da sessão ' . $sessao . '.'];
        }
        return ['ok' => true, 'status' => (string) $r['status'], 'nome' => (string) (($r['me'] ?? [])['pushName'] ?? '')];
    }
}
