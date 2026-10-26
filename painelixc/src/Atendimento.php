<?php

namespace GlpiPlugin\Painelixc;

use DBmysql;
use Toolbox;

/**
 * Atendimentos do IXC (su_ticket) com a lista de O.S. de cada um (0.11.0).
 *
 * O n8n (workflow "Painel IXC - Atendimentos", id pixcAtendimentos01) manda um retrato por base:
 *   { "base": "buzz", "tipo": "atendimentos", "modo": "abertos"|"finalizados", "ixc_url": "...", "total": 42,
 *     "atendimentos": [ { "id", "protocolo", "status", "id_assunto", "titulo", "id_setor", "id_responsavel",
 *                         "id_cliente", "cliente", "id_condominio", "data_abertura", "ultima_atualizacao",
 *                         "os": [ { "id", "protocolo", "id_assunto", "status" } ] } ],
 *     "avisos": [...] }
 *   ou { "base": "buzz", "tipo": "atendimentos", "modo": "...", "erro": "mensagem" }
 *
 * Regras:
 *  - modo "abertos" (a cada 10 min): o que veio = aberto (is_active 1); aberto que não veio = saiu (is_active 0, saiu_em).
 *    Retrato com erro ou truncado não encerra nada.
 *  - modo "finalizados" (a cada hora, janela curta; "carga" = 90 dias): grava como finalizado (is_active 0). Não encerra nada.
 *  - Finalizados mais velhos que historico_dias saem do banco.
 */
final class Atendimento
{
    public const TABELA = 'glpi_plugin_painelixc_atendimentos';
    public const TIPO_LOG = 'atendimentos';      // coleta dos abertos (é a que diz se a base está em dia)
    public const TIPO_LOG_FIN = 'atend_fin';     // coleta dos finalizados (synclogs.tipo é varchar(12))
    public const MAX_OS = 200;
    public const MAX_LISTA = 5000;

    /** su_ticket.su_status do IXC. "S" é o que o painel chama de finalizado. */
    public const STATUS = [
        'N' => 'Novo', 'P' => 'Pendente', 'EP' => 'Em progresso', 'S' => 'Solucionado', 'C' => 'Cancelado',
    ];
    public const FINALIZADOS = ['S'];

    public function __construct(private DBmysql $db, private ?string $agora = null)
    {
    }

    /**
     * P13-3 (20/10) — o setor do atendimento (su_ticket.id_ticket_setor) é um "departamento" da tabela su_ticket_setor do IXC,
     * diferente dos setores das O.S. (empresa_setor, dicionário "setores"). Usar o dicionário das O.S. trocava os nomes
     * (ex.: 4BTELECOM id 2 = "Departamento Comercial" no atendimento, mas "Financeiro" nas O.S.).
     */
    public const DIC_SETOR = 'setores_atd';

    // ================================================================== ingest

    /** @param array<string,mixed> $p @return array<string,mixed> */
    public function receber(array $p): array
    {
        $inicio = microtime(true);
        $agora  = $this->agora ?? date('Y-m-d H:i:s');
        $codigo = strtolower(trim((string) ($p['base'] ?? '')));
        $modo   = (($p['modo'] ?? '') === 'finalizados') ? 'finalizados' : 'abertos';
        $tipoLog = $modo === 'abertos' ? self::TIPO_LOG : self::TIPO_LOG_FIN;

        $base = $this->base($codigo);
        if ($base === null) {
            return ['ok' => false, 'http' => 404, 'erro' => "base desconhecida: '$codigo'"];
        }
        $baseId = (int) $base['id'];

        if (!empty($p['erro'])) {
            $erro = mb_substr((string) $p['erro'], 0, 1000);
            $this->log($baseId, $tipoLog, $agora, false, null, 0, $erro, $inicio);
            return ['ok' => true, 'registrado_erro' => true, 'base' => $codigo, 'tipo' => self::TIPO_LOG, 'modo' => $modo, 'erro' => $erro];
        }
        if (!isset($p['atendimentos']) || !is_array($p['atendimentos'])) {
            return ['ok' => false, 'http' => 422, 'erro' => "campo 'atendimentos' ausente ou não é lista"];
        }

        $lista    = Ingest::registros($p['atendimentos']);
        $totalIxc = isset($p['total']) && is_numeric($p['total']) ? (int) $p['total'] : null;
        $truncado = $totalIxc !== null && $totalIxc > count($lista);

        $res = $this->db->doQuery("SELECT GET_LOCK('painelixc_atendimento', 60) AS t");
        $trava = $res ? $res->fetch_assoc() : null;
        if ((int) ($trava['t'] ?? 0) !== 1) {
            return ['ok' => false, 'http' => 503, 'erro' => 'ingest de atendimentos ocupado; tente de novo'];
        }
        $this->db->beginTransaction();
        try {
            $syncId = $this->log($baseId, $tipoLog, $agora, true, $totalIxc, count($lista), null, $inicio);
            $novas = $atualizadas = $ignoradas = 0;
            $comErro = [];
            foreach ($lista as $r) {
                $a = self::normalizar($r);
                if ($a === null) {
                    $ignoradas++;
                    continue;
                }
                $a['plugin_painelixc_bases_id'] = $baseId;
                $a['is_active'] = $modo === 'abertos' ? 1 : 0;
                $a['sync_id'] = $syncId;
                $a['ultimo_visto'] = $agora;
                $a['saiu_em'] = $modo === 'abertos' ? null : $agora;
                try {
                    $this->upsert($a, $agora, $modo) ? $novas++ : $atualizadas++;
                } catch (\Throwable $e) {
                    if (str_contains($e->getMessage(), 'Deadlock')) {
                        throw $e;
                    }
                    $ignoradas++;
                    $comErro[] = (string) ($r['id'] ?? '?') . ': ' . mb_substr($e->getMessage(), 0, 160);
                }
            }

            $sairam = 0;
            if ($modo === 'abertos' && !$truncado) {
                $this->db->doQuery(
                    'UPDATE `' . self::TABELA . '` SET `is_active` = 0, `saiu_em` = ' . $this->db::quoteValue($agora) . "
                      WHERE `plugin_painelixc_bases_id` = $baseId AND `is_active` = 1
                        AND (`sync_id` IS NULL OR `sync_id` <> $syncId)"
                );
                $sairam = $this->db->affectedRows();
            }

            $aviso = null;
            if ($comErro) {
                $aviso = mb_substr(count($comErro) . ' atendimento(s) não gravado(s): ' . implode('; ', array_slice($comErro, 0, 3)), 0, 1000);
                Toolbox::logInFile('php-errors', 'painelixc atendimentos ' . $codigo . ': ' . $aviso . "\n");
            } elseif ($truncado) {
                $aviso = "retrato truncado: IXC informou $totalIxc, chegaram " . count($lista) . ($modo === 'abertos' ? ' — nada foi encerrado' : '');
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
            $this->guardarSetores($baseId, $p['setores'] ?? null, $agora);
            $this->expurgar($baseId, $agora);
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        } finally {
            $this->db->doQuery("SELECT RELEASE_LOCK('painelixc_atendimento')");
        }

        return [
            'ok' => true, 'base' => $codigo, 'tipo' => self::TIPO_LOG, 'modo' => $modo, 'sync_id' => $syncId,
            'recebidas' => count($lista), 'novas' => $novas, 'atualizadas' => $atualizadas, 'sairam' => $sairam,
            'ignoradas' => $ignoradas, 'truncado' => $truncado, 'total_ixc' => $totalIxc,
        ];
    }

    private const CAMPOS = ['plugin_painelixc_bases_id', 'ixc_id', 'protocolo', 'status', 'id_assunto', 'titulo',
        'id_setor', 'id_responsavel', 'id_cliente', 'cliente', 'id_condominio', 'data_abertura', 'ultima_atualizacao',
        'os_lista', 'qtd_os', 'is_active', 'sync_id', 'ultimo_visto'];

    /** @param array<string,mixed> $a @return bool true = inseriu */
    private function upsert(array $a, string $agora, string $modo): bool
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
        $cols[] = '`saiu_em`';
        $vals[] = $this->db::quoteValue($a['saiu_em'] ?? null);
        // aberto de novo zera a saída; finalizado guarda a 1ª vez que foi visto fora dos abertos
        $upd[] = $modo === 'abertos' ? '`saiu_em` = NULL' : '`saiu_em` = COALESCE(`saiu_em`, VALUES(`saiu_em`))';
        $this->db->doQuery(
            'INSERT INTO `' . self::TABELA . '` (' . implode(',', $cols) . ') VALUES (' . implode(',', $vals) . ')
             ON DUPLICATE KEY UPDATE ' . implode(', ', $upd)
        );
        return $this->db->affectedRows() === 1;
    }

    /** Fora dos abertos e sem movimento há mais de historico_dias: sai do banco. */
    private function expurgar(int $baseId, string $agora): void
    {
        $dias = max(7, (int) Config::get('historico_dias'));
        $limite = $this->db::quoteValue(date('Y-m-d H:i:s', strtotime($agora . " -$dias days")));
        $this->db->doQuery(
            'DELETE FROM `' . self::TABELA . "` WHERE `plugin_painelixc_bases_id` = $baseId AND `is_active` = 0
               AND COALESCE(`ultima_atualizacao`, `saiu_em`) < $limite LIMIT 5000"
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

    private function log(int $baseId, string $tipo, string $agora, bool $ok, ?int $total, int $recebidas, ?string $erro, float $inicio): int
    {
        $this->db->insert('glpi_plugin_painelixc_synclogs', [
            'plugin_painelixc_bases_id' => $baseId, 'tipo' => $tipo, 'quando' => $agora, 'ok' => $ok ? 1 : 0,
            'total_ixc' => $total, 'recebidas' => $recebidas, 'erro' => $erro,
            'duracao_ms' => (int) ((microtime(true) - $inicio) * 1000),
        ]);
        return (int) $this->db->insertId();
    }

    // ------------------------------------------------------------------ normalização (pura)

    /**
     * Aceita os nomes do plugin e os do IXC (su_ticket), para o caso de o n8n mandar o registro cru.
     * @param array<string,mixed> $r @return array<string,mixed>|null
     */
    public static function normalizar(array $r): ?array
    {
        $id = Ingest::int($r['id'] ?? null);
        if ($id === null || $id <= 0) {
            return null;
        }
        $z = static fn(mixed $v) => (($i = Ingest::int($v)) === null || $i === 0) ? null : $i;
        $pri = static function (array $r, array $ks): mixed {
            foreach ($ks as $k) {
                if (isset($r[$k]) && $r[$k] !== '') {
                    return $r[$k];
                }
            }
            return null;
        };

        $os = [];
        $vistos = [];
        foreach (array_slice(Ingest::registros($r['os'] ?? []), 0, self::MAX_OS) as $o) {
            $oid = $z($o['id'] ?? null);
            if ($oid === null || isset($vistos[$oid])) {
                continue;
            }
            $vistos[$oid] = true;
            $os[] = [
                'id'         => $oid,
                'protocolo'  => Ingest::txt($o['protocolo'] ?? null, 40),
                'id_assunto' => $z($o['id_assunto'] ?? null),
                'status'     => strtoupper(Ingest::txt($o['status'] ?? null, 5) ?? '') ?: null,
            ];
        }
        usort($os, static fn($a, $b) => $a['id'] <=> $b['id']);
        $osJson = json_encode($os, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);

        $status = strtoupper(Ingest::txt($pri($r, ['status', 'su_status']), 5) ?? '?');
        return [
            'ixc_id'             => $id,
            'protocolo'          => Ingest::txt($r['protocolo'] ?? null, 40),
            'status'             => $status,
            'id_assunto'         => $z($r['id_assunto'] ?? null),
            'titulo'             => ($t = Auditoria::texto($r['titulo'] ?? null)) === null ? null : mb_substr(preg_replace('/\s+/', ' ', $t), 0, 255),
            'id_setor'           => $z($pri($r, ['id_setor', 'id_ticket_setor', 'setor'])),
            'id_responsavel'     => $z($pri($r, ['id_responsavel', 'id_responsavel_tecnico'])),
            'id_cliente'         => $z($r['id_cliente'] ?? null),
            'cliente'            => Ingest::txt($r['cliente'] ?? null, 200),
            'id_condominio'      => $z($r['id_condominio'] ?? null),
            'data_abertura'      => Ingest::data($pri($r, ['data_abertura', 'data_criacao'])),
            'ultima_atualizacao' => Ingest::data($pri($r, ['ultima_atualizacao', 'data_ultima_alteracao'])),
            'os_lista'           => $osJson === false ? '[]' : $osJson,
            'qtd_os'             => count($os),
        ];
    }

    // ================================================================== tela

    /**
     * JSON da tela. modo "abertos" = is_active 1; "finalizados" = fora dos abertos, status S, última atualização no período.
     * @return array<string,mixed>
     */
    public function listar(string $modo, ?string $de = null, ?string $ate = null): array
    {
        $modo = $modo === 'finalizados' ? 'finalizados' : 'abertos';
        $t = self::TABELA;
        $q = fn($v) => $this->db::quoteValue($v);
        if ($modo === 'abertos') {
            $onde = 'a.is_active = 1';
            $ordem = 'a.data_abertura ASC, a.id ASC';
        } else {
            $de  = $de ?? date('Y-m-d', strtotime('-30 days'));
            $ate = $ate ?? date('Y-m-d');
            $fin = implode(',', array_map($q, self::FINALIZADOS));
            $onde = "a.is_active = 0 AND a.status IN ($fin)
                     AND COALESCE(a.ultima_atualizacao, a.saiu_em) >= " . $q($de . ' 00:00:00') . '
                     AND COALESCE(a.ultima_atualizacao, a.saiu_em) <= ' . $q($ate . ' 23:59:59');
            $ordem = 'COALESCE(a.ultima_atualizacao, a.saiu_em) DESC, a.id DESC';
        }
        $sql = "SELECT a.id, a.ixc_id, a.protocolo, a.status, a.id_assunto, a.titulo, a.id_setor, a.id_responsavel,
                       a.id_cliente, a.cliente, a.id_condominio, a.data_abertura, a.ultima_atualizacao, a.os_lista, a.qtd_os,
                       a.primeiro_visto, a.saiu_em, b.codigo AS base,
                       sa.nome AS assunto, se.nome AS setor, tr.nome AS responsavel, co.nome AS condominio
                  FROM `$t` a
                  JOIN `glpi_plugin_painelixc_bases` b ON b.id = a.plugin_painelixc_bases_id AND b.is_active = 1
             LEFT JOIN `glpi_plugin_painelixc_dicionarios` sa
                    ON sa.plugin_painelixc_bases_id = a.plugin_painelixc_bases_id AND sa.tipo = 'assuntos' AND sa.ixc_id = a.id_assunto
             LEFT JOIN `glpi_plugin_painelixc_dicionarios` se
                    ON se.plugin_painelixc_bases_id = a.plugin_painelixc_bases_id AND se.tipo = '" . self::DIC_SETOR . "' AND se.ixc_id = a.id_setor
             LEFT JOIN `glpi_plugin_painelixc_dicionarios` tr
                    ON tr.plugin_painelixc_bases_id = a.plugin_painelixc_bases_id AND tr.tipo = 'tecnicos' AND tr.ixc_id = a.id_responsavel
             LEFT JOIN `glpi_plugin_painelixc_dicionarios` co
                    ON co.plugin_painelixc_bases_id = a.plugin_painelixc_bases_id AND co.tipo = 'condominios' AND co.ixc_id = a.id_condominio
                 WHERE $onde
              ORDER BY $ordem
                 LIMIT " . self::MAX_LISTA;
        $res = $this->db->doQuery($sql);
        $assuntos = $this->assuntosPorBase();
        $ints = ['id', 'ixc_id', 'id_assunto', 'id_setor', 'id_responsavel', 'id_cliente', 'id_condominio', 'qtd_os'];
        $lista = [];
        while ($res && ($r = $res->fetch_assoc())) {
            foreach ($ints as $k) {
                $r[$k] = ($r[$k] ?? null) === null ? null : (int) $r[$k];
            }
            $os = json_decode((string) ($r['os_lista'] ?? ''), true);
            $os = is_array($os) ? $os : [];
            foreach ($os as &$o) {
                $o['assunto'] = $assuntos[$r['base']][(int) ($o['id_assunto'] ?? 0)] ?? null;
            }
            unset($o);
            $r['os'] = $os;
            unset($r['os_lista']);
            $lista[] = $r;
        }

        $out = [
            'ok'           => true,
            'modo'         => $modo,
            'agora'        => date('Y-m-d H:i:s'),
            'versao'       => PLUGIN_PAINELIXC_VERSION,
            'status'       => self::STATUS,
            'status_os'    => Painel::STATUS,
            'bases'        => $this->estadoBases(),
            'atendimentos' => $lista,
            'assuntos'     => (new Painel($this->db))->dicionario('assuntos'),
            'sla'          => (new Sla($this->db))->configs(),   // 0.13.5: cadastro de SLA dos assuntos (o % é calculado na tela)
            'limite'       => count($lista) >= self::MAX_LISTA,
        ];
        if ($modo === 'finalizados') {
            $out['periodo'] = ['de' => $de, 'ate' => $ate];
        }
        return $out;
    }

    /** [base => [id_assunto => nome]] das bases ativas (nome dos assuntos das O.S.). @return array<string,array<int,string>> */
    private function assuntosPorBase(): array
    {
        $m = [];
        foreach ((new Painel($this->db))->dicionario('assuntos') as $d) {
            $m[$d['base']][$d['id']] = $d['nome'];
        }
        return $m;
    }

    /** Bases ativas + última coleta dos abertos e dos finalizados. @return list<array<string,mixed>> */
    private function estadoBases(): array
    {
        $sub = function (string $tipo, string $campo, bool $soOk = false): string {
            $t = $this->db::quoteValue($tipo);
            if ($campo === 'ultima_sync') {
                return "(SELECT MAX(s.quando) FROM `glpi_plugin_painelixc_synclogs` s
                          WHERE s.plugin_painelixc_bases_id = b.id AND s.tipo = $t AND s.ok = 1)";
            }
            return "(SELECT s.$campo FROM `glpi_plugin_painelixc_synclogs` s
                      WHERE s.plugin_painelixc_bases_id = b.id AND s.tipo = $t ORDER BY s.id DESC LIMIT 1)";
        };
        $sql = 'SELECT b.id, b.codigo, b.nome, b.cor, b.ixc_url, '
            . $sub(self::TIPO_LOG, 'ultima_sync') . ' AS ultima_sync, '
            . $sub(self::TIPO_LOG, 'quando') . ' AS ultima_tentativa, '
            . $sub(self::TIPO_LOG, 'erro') . ' AS ultimo_erro, '
            . $sub(self::TIPO_LOG, 'ok') . ' AS ultimo_ok, '
            . $sub(self::TIPO_LOG_FIN, 'ultima_sync') . ' AS fin_ultima_sync, '
            . $sub(self::TIPO_LOG_FIN, 'quando') . ' AS fin_ultima_tentativa, '
            . $sub(self::TIPO_LOG_FIN, 'erro') . ' AS fin_ultimo_erro, '
            . $sub(self::TIPO_LOG_FIN, 'ok') . ' AS fin_ultimo_ok
                  FROM `glpi_plugin_painelixc_bases` b
                 WHERE b.is_active = 1
              ORDER BY b.ordem';
        $res = $this->db->doQuery($sql);
        $out = [];
        while ($res && ($b = $res->fetch_assoc())) {
            $b['id'] = (int) $b['id'];
            foreach (['ultimo_ok', 'fin_ultimo_ok'] as $k) {
                $b[$k] = $b[$k] === null ? null : (int) $b[$k];
            }
            $out[] = $b;
        }
        return $out;
    }

    /**
     * Guarda os nomes dos setores do atendimento que o workflow mandou ({id, setor}). Lista vazia ou ausente = não veio nesta
     * rodada (workflow antigo ou falha no IXC): mantém o que já havia. @param mixed $lista
     */
    private function guardarSetores(int $baseId, mixed $lista, string $agora): void
    {
        $itens = [];
        foreach (is_array($lista) ? $lista : [] as $x) {
            $id = (int) ($x['id'] ?? 0);
            $nome = mb_substr(trim((string) ($x['setor'] ?? $x['nome'] ?? '')), 0, 200);
            if ($id > 0 && $nome !== '') {
                $itens[$id] = $nome;
            }
        }
        if ($itens === []) {
            return;
        }
        $q = fn($v) => $this->db::quoteValue($v);
        $vals = [];
        foreach ($itens as $id => $nome) {
            $vals[] = '(' . $baseId . ',' . $q(self::DIC_SETOR) . ',' . (int) $id . ',' . $q($nome) . ',' . $q($agora) . ')';
        }
        foreach (array_chunk($vals, 500) as $bloco) {
            $this->db->doQuery('INSERT INTO `glpi_plugin_painelixc_dicionarios` (`plugin_painelixc_bases_id`,`tipo`,`ixc_id`,`nome`,`ultimo_visto`) VALUES '
                . implode(',', $bloco) . ' ON DUPLICATE KEY UPDATE `nome` = VALUES(`nome`), `ultimo_visto` = VALUES(`ultimo_visto`)');
        }
        $this->db->doQuery("DELETE FROM `glpi_plugin_painelixc_dicionarios` WHERE `plugin_painelixc_bases_id` = $baseId AND `tipo` = " . $q(self::DIC_SETOR)
            . ' AND `ixc_id` NOT IN (' . implode(',', array_keys($itens)) . ')');
    }
}
