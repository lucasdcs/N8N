<?php

namespace GlpiPlugin\Painelixc;

use DBmysql;
use Toolbox;

/**
 * Auditoria de Ativação: O.S. de auditoria abertas + a O.S. de Ativação de origem
 * (mesmo atendimento), com as mensagens e a lista de anexos dela.
 *
 * O n8n (workflow "Painel IXC - Auditoria", id pixcAuditoria01) manda um retrato por base:
 *   { "base": "buzz", "tipo": "auditorias", "ixc_url": "...", "total": 3,
 *     "auditorias": [ { "id", "protocolo", "status", "id_assunto", "id_ticket", "id_cliente", "id_tecnico",
 *                       "setor", "data_abertura", "mensagem",
 *                       "origem": { "id", "protocolo", "status", "id_assunto", "id_tecnico", "data_abertura",
 *                                   "data_fechamento", "mensagem", "mensagem_resposta" } | null,
 *                       "msgs_os": [...], "arquivos": [...], "msgs_ticket": [...] } ],
 *     "avisos": [...] }
 *   ou { "base": "buzz", "tipo": "auditorias", "erro": "mensagem" }
 *
 * Regras: auditoria do retrato = ativa; ativa que não veio = saiu (is_active 0).
 * Retrato com erro ou truncado não encerra nada. Fechadas somem depois de historico_dias.
 */
final class Auditoria
{
    public const TABELA = 'glpi_plugin_painelixc_auditorias';
    public const TIPO_LOG = 'auditorias';
    public const TAM_TEXTO = 4000;
    public const MAX_MSGS = 300;
    public const MAX_ARQUIVOS = 200;

    /** injetável em teste; null = Reauditoria real */
    public ?Reauditoria $reaud = null;
    /** injetável em teste; null = Distribuicao real (0.9.0) */
    public ?Distribuicao $dist = null;

    public function __construct(private DBmysql $db, private ?string $agora = null)
    {
    }

    // ================================================================== ingest

    /** @param array<string,mixed> $p @return array<string,mixed> */
    public function receber(array $p): array
    {
        $inicio = microtime(true);
        $agora  = $this->agora ?? date('Y-m-d H:i:s');
        $codigo = strtolower(trim((string) ($p['base'] ?? '')));

        $base = $this->base($codigo);
        if ($base === null) {
            return ['ok' => false, 'http' => 404, 'erro' => "base desconhecida: '$codigo'"];
        }
        $baseId = (int) $base['id'];

        if (!empty($p['erro'])) {
            $erro = mb_substr((string) $p['erro'], 0, 1000);
            $this->log($baseId, $agora, false, null, 0, $erro, $inicio);
            return ['ok' => true, 'registrado_erro' => true, 'base' => $codigo, 'tipo' => self::TIPO_LOG, 'erro' => $erro];
        }
        if (!isset($p['auditorias']) || !is_array($p['auditorias'])) {
            return ['ok' => false, 'http' => 422, 'erro' => "campo 'auditorias' ausente ou não é lista"];
        }

        $lista    = Ingest::registros($p['auditorias']);
        $totalIxc = isset($p['total']) && is_numeric($p['total']) ? (int) $p['total'] : null;
        $truncado = $totalIxc !== null && $totalIxc > count($lista);

        $res = $this->db->doQuery("SELECT GET_LOCK('painelixc_auditoria', 60) AS t");
        $trava = $res ? $res->fetch_assoc() : null;
        if ((int) ($trava['t'] ?? 0) !== 1) {
            return ['ok' => false, 'http' => 503, 'erro' => 'ingest de auditoria ocupado; tente de novo'];
        }
        $this->db->beginTransaction();
        try {
            $syncId = $this->log($baseId, $agora, true, $totalIxc, count($lista), null, $inicio);
            $novas = $atualizadas = $ignoradas = $semOrigem = 0;
            $comErro = [];
            foreach ($lista as $r) {
                $a = self::normalizar($r);
                if ($a === null) {
                    $ignoradas++;
                    continue;
                }
                if ($a['origem_ixc_id'] === null) {
                    $semOrigem++;
                }
                $a['plugin_painelixc_bases_id'] = $baseId;
                $a['is_active'] = 1;
                $a['sync_id'] = $syncId;
                $a['ultimo_visto'] = $agora;
                try {
                    $this->upsert($a, $agora) ? $novas++ : $atualizadas++;
                } catch (\Throwable $e) {
                    if (str_contains($e->getMessage(), 'Deadlock')) {
                        throw $e;
                    }
                    $ignoradas++;
                    $comErro[] = (string) ($r['id'] ?? '?') . ': ' . mb_substr($e->getMessage(), 0, 160);
                }
            }

            $sairam = 0;
            if (!$truncado) {
                $this->db->doQuery(
                    'UPDATE `' . self::TABELA . '` SET `is_active` = 0, `saiu_em` = ' . $this->db::quoteValue($agora) . "
                      WHERE `plugin_painelixc_bases_id` = $baseId AND `is_active` = 1
                        AND (`sync_id` IS NULL OR `sync_id` <> $syncId)"
                );
                $sairam = $this->db->affectedRows();
            }

            $aviso = null;
            if ($comErro) {
                $aviso = mb_substr(count($comErro) . ' auditoria(s) não gravada(s): ' . implode('; ', array_slice($comErro, 0, 3)), 0, 1000);
                Toolbox::logInFile('php-errors', 'painelixc auditoria ' . $codigo . ': ' . $aviso . "\n");
            } elseif ($truncado) {
                $aviso = "retrato truncado: IXC informou $totalIxc, chegaram " . count($lista) . ' — nada foi encerrado';
            } elseif (!empty($p['avisos']) && is_array($p['avisos'])) {
                $aviso = mb_substr(implode('; ', array_map(static fn($x) => mb_substr((string) $x, 0, 160), array_slice($p['avisos'], 0, 4))), 0, 1000);
            }

            $this->db->update('glpi_plugin_painelixc_synclogs', [
                'novas' => $novas, 'atualizadas' => $atualizadas, 'sairam' => $sairam, 'erro' => $aviso,
                'duracao_ms' => (int) ((microtime(true) - $inicio) * 1000),
            ], ['id' => $syncId]);

            $ixcUrl = isset($p['ixc_url']) && preg_match('#^https?://#i', (string) $p['ixc_url'])
                ? mb_substr(rtrim((string) $p['ixc_url'], '/'), 0, 255) : null;
            if ($ixcUrl !== null && empty($base['ixc_url'])) {
                $this->db->update('glpi_plugin_painelixc_bases', ['ixc_url' => $ixcUrl], ['id' => $baseId]);
            }
            $this->expurgar($baseId, $agora);
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        } finally {
            $this->db->doQuery("SELECT RELEASE_LOCK('painelixc_auditoria')");
        }

        // depois do commit: Ativações reabertas pelo painel que foram finalizadas de novo → abre a reauditoria
        $reaud = ($this->reaud ?? new Reauditoria($this->db, null, $this->agora))->verificar($baseId);
        // auditorias novas com o técnico padrão → auditor com menos recebidas (0.9.0)
        $dist = ($this->dist ?? new Distribuicao($this->db, null, $this->agora))->executar($baseId);

        return [
            'ok' => true, 'base' => $codigo, 'tipo' => self::TIPO_LOG, 'sync_id' => $syncId, 'recebidas' => count($lista),
            'reauditoria' => $reaud, 'distribuicao' => $dist,
            'novas' => $novas, 'atualizadas' => $atualizadas, 'sairam' => $sairam, 'ignoradas' => $ignoradas,
            'sem_origem' => $semOrigem, 'truncado' => $truncado, 'total_ixc' => $totalIxc,
        ];
    }

    private const CAMPOS = ['plugin_painelixc_bases_id', 'ixc_id', 'protocolo', 'status', 'id_assunto', 'id_ticket',
        'id_cliente', 'id_tecnico', 'id_setor', 'data_abertura', 'mensagem',
        'origem_ixc_id', 'origem_protocolo', 'origem_status', 'origem_id_assunto', 'origem_id_tecnico',
        'origem_data_abertura', 'origem_data_fechamento', 'origem_mensagem', 'origem_mensagem_resposta',
        'detalhe', 'qtd_msgs', 'qtd_arquivos', 'is_active', 'sync_id', 'ultimo_visto'];

    /** @param array<string,mixed> $a @return bool true = inseriu */
    private function upsert(array $a, string $agora): bool
    {
        $cols = $vals = $upd = [];
        foreach (self::CAMPOS as $k) {
            $cols[] = "`$k`";
            $vals[] = $this->db::quoteValue($a[$k] ?? null);
            if ($k !== 'plugin_painelixc_bases_id' && $k !== 'ixc_id') {
                $upd[] = "`$k` = VALUES(`$k`)";
            }
        }
        $cols[] = '`primeiro_visto`';
        $vals[] = $this->db::quoteValue($agora);
        $upd[] = '`saiu_em` = NULL';
        $this->db->doQuery(
            'INSERT INTO `' . self::TABELA . '` (' . implode(',', $cols) . ') VALUES (' . implode(',', $vals) . ')
             ON DUPLICATE KEY UPDATE ' . implode(', ', $upd)
        );
        return $this->db->affectedRows() === 1;
    }

    /** Fechadas (saiu_em) mais velhas que historico_dias saem do banco. */
    private function expurgar(int $baseId, string $agora): void
    {
        $dias = max(7, (int) Config::get('historico_dias'));
        $limite = date('Y-m-d H:i:s', strtotime($agora . " -$dias days"));
        $this->db->doQuery(
            'DELETE FROM `' . self::TABELA . "` WHERE `plugin_painelixc_bases_id` = $baseId AND `is_active` = 0
               AND `saiu_em` < " . $this->db::quoteValue($limite) . ' LIMIT 2000'
        );
    }

    /** @return array<string,mixed>|null */
    private function base(string $codigo): ?array
    {
        if ($codigo === '') {
            return null;
        }
        foreach ($this->db->request(['FROM' => 'glpi_plugin_painelixc_bases', 'WHERE' => ['codigo' => $codigo, 'is_active' => 1]]) as $row) {
            return $row;
        }
        return null;
    }

    private function log(int $baseId, string $agora, bool $ok, ?int $total, int $recebidas, ?string $erro, float $inicio): int
    {
        $this->db->insert('glpi_plugin_painelixc_synclogs', [
            'plugin_painelixc_bases_id' => $baseId, 'tipo' => self::TIPO_LOG, 'quando' => $agora, 'ok' => $ok ? 1 : 0,
            'total_ixc' => $total, 'recebidas' => $recebidas, 'erro' => $erro,
            'duracao_ms' => (int) ((microtime(true) - $inicio) * 1000),
        ]);
        return (int) $this->db->insertId();
    }

    // ------------------------------------------------------------------ normalização (pura)

    /** @param array<string,mixed> $r @return array<string,mixed>|null */
    public static function normalizar(array $r): ?array
    {
        $id = Ingest::int($r['id'] ?? null);
        if ($id === null || $id <= 0) {
            return null;
        }
        $z = static fn(mixed $v) => (($i = Ingest::int($v)) === null || $i === 0) ? null : $i;
        $o = is_array($r['origem'] ?? null) ? $r['origem'] : null;
        $oId = $o !== null ? $z($o['id'] ?? null) : null;
        if ($oId === null) {
            $o = null;
        }

        $msgsOs = [];
        foreach (array_slice(Ingest::registros($r['msgs_os'] ?? []), 0, self::MAX_MSGS) as $m) {
            $msgsOs[] = [
                'id'        => Ingest::int($m['id'] ?? null),
                'data'      => Ingest::data($m['data'] ?? null),
                'status'    => Ingest::txt($m['status'] ?? null, 5),
                'evento'    => Ingest::int($m['id_evento'] ?? null),
                'tecnico'   => $z($m['id_tecnico'] ?? null),
                'mensagem'  => self::texto($m['mensagem'] ?? null),
                'historico' => self::texto($m['historico'] ?? null),
            ];
        }
        usort($msgsOs, static fn($a, $b) => [(string) $a['data'], (int) $a['id']] <=> [(string) $b['data'], (int) $b['id']]);

        $arquivos = [];
        foreach (array_slice(Ingest::registros($r['arquivos'] ?? []), 0, self::MAX_ARQUIVOS) as $f) {
            $fid = $z($f['id'] ?? null);
            if ($fid === null) {
                continue;
            }
            $arquivos[] = [
                'id'        => $fid,
                'descricao' => Ingest::txt($f['descricao'] ?? null, 200),
                'nome'      => Ingest::txt($f['nome_arquivo'] ?? null, 255),
                'data'      => Ingest::data($f['data_envio'] ?? null),
            ];
        }
        usort($arquivos, static fn($a, $b) => [(string) $a['data'], $a['id']] <=> [(string) $b['data'], $b['id']]);

        $msgsTicket = [];
        foreach (array_slice(Ingest::registros($r['msgs_ticket'] ?? []), 0, self::MAX_MSGS) as $m) {
            $txt = self::texto($m['mensagem'] ?? null);
            if ($txt === null) {
                continue;
            }
            $msgsTicket[] = ['id' => Ingest::int($m['id'] ?? null), 'data' => Ingest::data($m['data'] ?? null), 'mensagem' => $txt];
        }
        usort($msgsTicket, static fn($a, $b) => [(string) $a['data'], (int) $a['id']] <=> [(string) $b['data'], (int) $b['id']]);

        // plano contratado (0.8.1; 0.8.3 = grupo do login): vem do n8n; guardado no detalhe (sem coluna nova)
        $plano = null;
        if (is_array($r['plano'] ?? null) && ($pn = Ingest::txt($r['plano']['nome'] ?? null, 300)) !== null && trim($pn) !== '') {
            $plano = ['nome' => trim($pn), 'contrato_id' => $z($r['plano']['contrato_id'] ?? null),
                'status' => strtoupper(Ingest::txt($r['plano']['status'] ?? null, 3) ?? ''), 'varios' => (int) ($r['plano']['varios'] ?? 0),
                'login' => Ingest::txt($r['plano']['login'] ?? null, 100), 'contrato' => Ingest::txt($r['plano']['contrato'] ?? null, 200)];
        }
        $detalhe = json_encode(['msgs_os' => $msgsOs, 'arquivos' => $arquivos, 'msgs_ticket' => $msgsTicket,
            'origem_ticket' => $o ? $z($o['id_ticket'] ?? null) : null, 'plano' => $plano],
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);

        return [
            'ixc_id'                   => $id,
            'protocolo'                => Ingest::txt($r['protocolo'] ?? null, 40),
            'status'                   => strtoupper(Ingest::txt($r['status'] ?? null, 5) ?? '?'),
            'id_assunto'               => Ingest::int($r['id_assunto'] ?? null),
            'id_ticket'                => $z($r['id_ticket'] ?? null),
            'id_cliente'               => $z($r['id_cliente'] ?? null),
            'id_tecnico'               => $z($r['id_tecnico'] ?? null),
            'id_setor'                 => $z($r['setor'] ?? $r['id_setor'] ?? null),
            'data_abertura'            => Ingest::data($r['data_abertura'] ?? null),
            'mensagem'                 => self::texto($r['mensagem'] ?? null),
            'origem_ixc_id'            => $oId,
            'origem_protocolo'         => $o ? Ingest::txt($o['protocolo'] ?? null, 40) : null,
            'origem_status'            => $o ? (strtoupper(Ingest::txt($o['status'] ?? null, 5) ?? '') ?: null) : null,
            'origem_id_assunto'        => $o ? Ingest::int($o['id_assunto'] ?? null) : null,
            'origem_id_tecnico'        => $o ? $z($o['id_tecnico'] ?? null) : null,
            'origem_data_abertura'     => $o ? Ingest::data($o['data_abertura'] ?? null) : null,
            'origem_data_fechamento'   => $o ? Ingest::data($o['data_fechamento'] ?? null) : null,
            'origem_mensagem'          => $o ? self::texto($o['mensagem'] ?? null) : null,
            'origem_mensagem_resposta' => $o ? self::texto($o['mensagem_resposta'] ?? null) : null,
            'detalhe'                  => $detalhe === false ? null : $detalhe,
            'qtd_msgs'                 => count($msgsOs),
            'qtd_arquivos'             => count($arquivos),
        ];
    }

    public static function texto(mixed $v): ?string
    {
        if (!is_string($v)) {
            return null;
        }
        $s = trim(html_entity_decode(strip_tags(str_replace(["\r\n", "\r"], "\n", $v)), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        return $s === '' ? null : mb_substr($s, 0, self::TAM_TEXTO);
    }

    // ================================================================== tela

    /** JSON da tela: auditorias ativas com nomes resolvidos + estado da última coleta por base. @return array<string,mixed> */
    public function listar(): array
    {
        $t = self::TABELA;
        $sql = "SELECT a.*, b.codigo AS base, b.ixc_url,
                       c.cliente, c.id_condominio, c.condominio, c.setor,
                       ta.nome AS tecnico, tor.nome AS origem_tecnico,
                       sa.nome AS assunto, so.nome AS origem_assunto
                  FROM `$t` a
                  JOIN `glpi_plugin_painelixc_bases` b ON b.id = a.plugin_painelixc_bases_id AND b.is_active = 1
             LEFT JOIN `glpi_plugin_painelixc_chamados` c
                    ON c.plugin_painelixc_bases_id = a.plugin_painelixc_bases_id AND c.tipo = 'os' AND c.ixc_id = a.ixc_id
             LEFT JOIN `glpi_plugin_painelixc_dicionarios` ta
                    ON ta.plugin_painelixc_bases_id = a.plugin_painelixc_bases_id AND ta.tipo = 'tecnicos' AND ta.ixc_id = a.id_tecnico
             LEFT JOIN `glpi_plugin_painelixc_dicionarios` tor
                    ON tor.plugin_painelixc_bases_id = a.plugin_painelixc_bases_id AND tor.tipo = 'tecnicos' AND tor.ixc_id = a.origem_id_tecnico
             LEFT JOIN `glpi_plugin_painelixc_dicionarios` sa
                    ON sa.plugin_painelixc_bases_id = a.plugin_painelixc_bases_id AND sa.tipo = 'assuntos' AND sa.ixc_id = a.id_assunto
             LEFT JOIN `glpi_plugin_painelixc_dicionarios` so
                    ON so.plugin_painelixc_bases_id = a.plugin_painelixc_bases_id AND so.tipo = 'assuntos' AND so.ixc_id = a.origem_id_assunto
                 WHERE a.is_active = 1
              ORDER BY a.data_abertura ASC, a.id ASC";
        $res = $this->db->doQuery($sql);
        $ints = ['id', 'ixc_id', 'id_assunto', 'id_ticket', 'id_cliente', 'id_tecnico', 'id_setor', 'id_condominio',
            'origem_ixc_id', 'origem_id_assunto', 'origem_id_tecnico', 'qtd_msgs', 'qtd_arquivos'];
        $lista = [];
        while ($res && ($r = $res->fetch_assoc())) {
            foreach ($ints as $k) {
                $r[$k] = ($r[$k] ?? null) === null ? null : (int) $r[$k];
            }
            $det = json_decode((string) ($r['detalhe'] ?? ''), true);
            $r['detalhe'] = is_array($det) ? $det + ['msgs_os' => [], 'arquivos' => [], 'msgs_ticket' => []]
                : ['msgs_os' => [], 'arquivos' => [], 'msgs_ticket' => []];
            unset($r['plugin_painelixc_bases_id'], $r['sync_id'], $r['is_active']);
            $lista[] = $r;
        }

        $ult = (new AcaoAuditoria($this->db))->ultimas();
        $baseId = [];
        foreach ($this->estadoBases() as $b) {
            $baseId[$b['codigo']] = $b['id'];
        }
        $re = (new Reauditoria($this->db))->resumo();
        foreach ($lista as &$l) {
            $chaveB = ($baseId[$l['base']] ?? 0) . ':' . $l['ixc_id'];
            $l['ultima_acao'] = $ult[$chaveB] ?? null;
            $l['rodada'] = $re['rodadas'][$chaveB] ?? null;
        }
        unset($l);

        return [
            'ok'         => true,
            'pode_agir'  => Config::podeAgir(),
            'aguardando_correcao' => (object) array_combine(
                array_map(static fn($id) => (string) (array_search($id, $baseId, true) ?: $id), array_keys($re['aguardando'])),
                array_values($re['aguardando'])),
            'acoes'      => AcaoAuditoria::definicoes($this->db),
            'agora'      => date('Y-m-d H:i:s'),
            'versao'     => PLUGIN_PAINELIXC_VERSION,
            'status'     => Painel::STATUS,
            'bases'      => $this->estadoBases(),
            'auditorias' => $lista,
            'distribuicao' => (new Distribuicao($this->db, null, $this->agora))->quadro(),
        ];
    }

    /** Bases ativas + última coleta de auditoria (ok e tentativa). @return list<array<string,mixed>> */
    private function estadoBases(): array
    {
        $tipo = $this->db::quoteValue(self::TIPO_LOG);
        $sql = "SELECT b.id, b.codigo, b.nome, b.cor, b.ixc_url,
                       (b.api_token IS NOT NULL AND b.api_token <> '') AS tem_token,
                       (SELECT MAX(s.quando) FROM `glpi_plugin_painelixc_synclogs` s
                         WHERE s.plugin_painelixc_bases_id = b.id AND s.tipo = $tipo AND s.ok = 1) AS ultima_sync,
                       (SELECT s.quando FROM `glpi_plugin_painelixc_synclogs` s
                         WHERE s.plugin_painelixc_bases_id = b.id AND s.tipo = $tipo ORDER BY s.id DESC LIMIT 1) AS ultima_tentativa,
                       (SELECT s.erro FROM `glpi_plugin_painelixc_synclogs` s
                         WHERE s.plugin_painelixc_bases_id = b.id AND s.tipo = $tipo ORDER BY s.id DESC LIMIT 1) AS ultimo_erro,
                       (SELECT s.ok FROM `glpi_plugin_painelixc_synclogs` s
                         WHERE s.plugin_painelixc_bases_id = b.id AND s.tipo = $tipo ORDER BY s.id DESC LIMIT 1) AS ultimo_ok
                  FROM `glpi_plugin_painelixc_bases` b
                 WHERE b.is_active = 1
              ORDER BY b.ordem";
        $res = $this->db->doQuery($sql);
        $out = [];
        $botoes = Botao::todos($this->db);
        $resp = Botao::respostas($this->db);
        $osCfg = Botao::chamados($this->db);   // 0.14.0: assunto + resposta da O.S. nova (Aprova/Abrir Chamado)
        while ($res && ($b = $res->fetch_assoc())) {
            $b['id'] = (int) $b['id'];
            $b['ultimo_ok'] = $b['ultimo_ok'] === null ? null : (int) $b['ultimo_ok'];
            // quais ações a base tem configuradas (token + resposta padrão); o token em si nunca sai daqui
            $b['acoes_ok'] = [];
            $b['respostas'] = [];
            $b['os_assunto'] = [];
            foreach ($botoes as $k => $d) {
                $rid = (int) ($resp[$b['id']][$k] ?? 0);
                $b['acoes_ok'][$k] = (int) $b['tem_token'] === 1 && $rid > 0;
                $b['respostas'][$k] = $rid > 0 ? $rid : null;
                if ($d['abre_os']) {
                    $o = $osCfg[$b['id']][$k] ?? ['resposta' => 0, 'assunto' => 0];
                    $b['acoes_ok'][$k] = $b['acoes_ok'][$k] && $o['resposta'] > 0 && $o['assunto'] > 0;
                    $b['os_assunto'][$k] = $o['assunto'] ? ['id' => $o['assunto'], 'nome' => $this->nomeAssunto($b['id'], $o['assunto'])] : null;
                }
            }
            unset($b['tem_token']);
            $out[] = $b;
        }
        return $out;
    }

    /** Nome do assunto no dicionário da base (null = não coletado). */
    private function nomeAssunto(int $baseId, int $id): ?string
    {
        $r = $this->db->doQuery("SELECT `nome` FROM `glpi_plugin_painelixc_dicionarios` WHERE `plugin_painelixc_bases_id` = $baseId
            AND `tipo` = 'assuntos' AND `ixc_id` = $id LIMIT 1");
        $l = $r ? $r->fetch_assoc() : null;
        return is_array($l) ? (string) $l['nome'] : null;
    }
}
