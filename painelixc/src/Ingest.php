<?php

namespace GlpiPlugin\Painelixc;

use Toolbox;

use DBmysql;

/**
 * Recebe o retrato de uma base enviado pelo n8n e sincroniza glpi_plugin_painelixc_chamados.
 *
 * Payload:
 *   { "base": "resolutto", "tipo": "abertas"|"resolvidas", "ixc_url": "...", "total": 12,
 *     "os": [...su_oss_chamado...], "assuntos": [...], "tecnicos": [...], "setores": [...],
 *     "clientes": [...], "condominios": [...], "diagnosticos": [...], "avisos": [...] }
 *   ou { "base": "resolutto", "erro": "mensagem" }
 *
 * Regras (tipo abertas):
 *  - O.S. do retrato: insere/atualiza com is_active=1.
 *  - O.S. ativas que não vieram: is_active=0, saiu_em=agora.
 *  - Retrato com erro ou truncado (total > recebidas): não encerra nada.
 * Tipo resolvidas: insere/atualiza com is_active=0 (histórico), sem mexer nas abertas.
 */
final class Ingest
{
    public const TAM_TEXTO = 2000;

    public function __construct(private DBmysql $db, private ?string $agora = null)
    {
    }

    /** @param array<string,mixed> $p @return array<string,mixed> */
    public function receber(array $p): array
    {
        $inicio = microtime(true);
        $agora  = $this->agora ?? date('Y-m-d H:i:s');
        $codigo = strtolower(trim((string) ($p['base'] ?? '')));
        $tipo   = (($p['tipo'] ?? 'abertas') === 'resolvidas') ? 'resolvidas' : 'abertas';

        $base = $this->base($codigo);
        if ($base === null) {
            return ['ok' => false, 'http' => 404, 'erro' => "base desconhecida: '$codigo'"];
        }
        $baseId = (int) $base['id'];

        if (!empty($p['erro'])) {
            $erro = mb_substr((string) $p['erro'], 0, 1000);
            $this->db->update('glpi_plugin_painelixc_bases', ['ultima_tentativa' => $agora, 'ultimo_erro' => $erro], ['id' => $baseId]);
            $this->log($baseId, $tipo, $agora, false, null, 0, null, $inicio);
            $this->expurgarLogs($baseId);
            return ['ok' => true, 'registrado_erro' => true, 'base' => $codigo, 'tipo' => $tipo, 'erro' => $erro];
        }
        if (!isset($p['os']) || !is_array($p['os'])) {
            return ['ok' => false, 'http' => 422, 'erro' => "campo 'os' ausente ou não é lista"];
        }

        $os       = self::registros($p['os']);
        $totalIxc = isset($p['total']) && is_numeric($p['total']) ? (int) $p['total'] : null;
        $truncado = $totalIxc !== null && $totalIxc > count($os);

        $dic = [
            'assuntos'     => self::mapa($p['assuntos'] ?? [], ['assunto', 'descricao', 'nome']),
            'tecnicos'     => self::mapa($p['tecnicos'] ?? [], ['funcionario', 'nome', 'nome_funcionario']),
            'setores'      => self::mapa($p['setores'] ?? [], ['setor', 'descricao', 'nome']),
            'clientes'     => self::mapa($p['clientes'] ?? [], ['razao', 'fantasia', 'nome']),
            'condominios'  => self::mapa($p['condominios'] ?? [], ['condominio', 'nome', 'descricao']),
            'diagnosticos' => self::mapa($p['diagnosticos'] ?? [], ['descricao', 'diagnostico', 'nome']),
            // cliente -> id_condominio (para O.S. sem condomínio próprio)
            'cli_cond'     => self::mapa($p['clientes'] ?? [], ['id_condominio']),
        ];

        // Os 5 retratos chegam ao mesmo tempo (um POST por base): serializa os ingests para não haver deadlock
        // entre o upsert de uma base e o "encerrar não vistos" de outra (visto na produção).
        $res = $this->db->doQuery("SELECT GET_LOCK('painelixc_ingest', 90) AS t");
        $trava = $res ? $res->fetch_assoc() : null;
        if ((int) ($trava['t'] ?? 0) !== 1) {
            return ['ok' => false, 'http' => 503, 'erro' => 'ingest ocupado (outro retrato em gravação há mais de 90 s); tente de novo'];
        }
        $this->db->beginTransaction();
        try {
            $syncId = $this->log($baseId, $tipo, $agora, true, $totalIxc, count($os), null, $inicio);

            $novas = $atualizadas = $ignoradas = 0;
            $osComErro = [];
            foreach ($os as $r) {
                $c = self::normalizar($r, $dic);
                if ($c === null) {
                    $ignoradas++;
                    continue;
                }
                $c['plugin_painelixc_bases_id'] = $baseId;
                $c['tipo']       = 'os';
                $c['is_active']  = $tipo === 'abertas' ? 1 : 0;
                $c['sync_id']    = $syncId;
                $c['ultimo_visto'] = $agora;
                try {
                    $this->upsert($c, $agora, $tipo) ? $novas++ : $atualizadas++;
                } catch (\Throwable $e) {
                    // uma O.S. com dado que o banco recusa não derruba o retrato da base: pula e avisa
                    if (str_contains($e->getMessage(), 'Deadlock')) {
                        throw $e;   // isso é concorrência, não dado: deixa subir (o n8n tenta de novo)
                    }
                    $ignoradas++;
                    $osComErro[] = (string) ($r['id'] ?? '?') . ': ' . mb_substr($e->getMessage(), 0, 160);
                }
            }

            $sairam = 0;
            if ($tipo === 'abertas' && !$truncado) {
                $this->db->doQuery(
                    "UPDATE `glpi_plugin_painelixc_chamados` SET `is_active` = 0, `saiu_em` = " . $this->db::quoteValue($agora) . "
                      WHERE `plugin_painelixc_bases_id` = $baseId AND `tipo` = 'os' AND `is_active` = 1
                        AND (`sync_id` IS NULL OR `sync_id` <> $syncId)"
                );
                $sairam = $this->db->affectedRows();
            }

            $aviso = null;
            if ($osComErro) {
                $aviso = mb_substr(count($osComErro) . ' O.S. não gravada(s): ' . implode('; ', array_slice($osComErro, 0, 3)), 0, 1000);
                Toolbox::logInFile('php-errors', 'painelixc ingest ' . $codigo . ': ' . $aviso . "\n");
            } elseif ($truncado) {
                $aviso = "retrato truncado: IXC informou $totalIxc, chegaram " . count($os) . ' — nada foi encerrado';
            } elseif (!empty($p['avisos']) && is_array($p['avisos'])) {
                $txt   = implode('; ', array_map(static fn($a) => mb_substr((string) $a, 0, 160), array_slice($p['avisos'], 0, 4)));
                $aviso = mb_substr('nomes indisponíveis (aparece #id): ' . $txt, 0, 1000);
            }

            $this->db->update('glpi_plugin_painelixc_synclogs', [
                'novas' => $novas, 'atualizadas' => $atualizadas, 'sairam' => $sairam, 'erro' => $aviso,
                'duracao_ms' => (int) ((microtime(true) - $inicio) * 1000),
            ], ['id' => $syncId]);

            $up = ['ultima_tentativa' => $agora, 'ultimo_erro' => $aviso, 'ultimo_total_ixc' => $totalIxc, 'ultimo_recebido' => count($os)];
            if ($tipo === 'abertas') {
                $up['ultima_sync'] = $agora;
            }
            $ixcUrl = isset($p['ixc_url']) && preg_match('#^https?://#i', (string) $p['ixc_url'])
                ? mb_substr(rtrim((string) $p['ixc_url'], '/'), 0, 255) : null;
            if ($ixcUrl !== null) {
                $up['ixc_url'] = $ixcUrl;
            }
            $this->db->update('glpi_plugin_painelixc_bases', $up, ['id' => $baseId]);
            $this->guardarDicionarios($baseId, $dic, $agora);
            $this->expurgarLogs($baseId);

            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        } finally {
            $this->db->doQuery("SELECT RELEASE_LOCK('painelixc_ingest')");
        }

        return [
            'ok' => true, 'base' => $codigo, 'tipo' => $tipo, 'sync_id' => $syncId, 'recebidas' => count($os),
            'novas' => $novas, 'atualizadas' => $atualizadas, 'sairam' => $sairam, 'ignoradas' => $ignoradas,
            'truncado' => $truncado, 'total_ixc' => $totalIxc,
        ];
    }

    /** @param array<string,mixed> $c  @return bool true = inseriu, false = atualizou */
    private function upsert(array $c, string $agora, string $tipo): bool
    {
        $campos = ['plugin_painelixc_bases_id', 'tipo', 'ixc_id', 'protocolo', 'status', 'prioridade', 'id_assunto', 'assunto',
            'id_setor', 'setor', 'id_tecnico', 'tecnico', 'id_cliente', 'cliente', 'id_condominio', 'condominio',
            'id_diagnostico', 'diagnostico', 'id_ticket', 'mensagem', 'mensagem_resposta', 'data_abertura', 'data_agenda',
            'data_inicio', 'data_final', 'data_fechamento', 'ultima_atualizacao', 'is_active', 'sync_id', 'ultimo_visto'];
        $cols = $vals = $upd = [];
        foreach ($campos as $k) {
            $cols[] = "`$k`";
            $vals[] = $this->db::quoteValue($c[$k] ?? null);
            if (!in_array($k, ['plugin_painelixc_bases_id', 'tipo', 'ixc_id'], true)) {
                $upd[] = "`$k` = VALUES(`$k`)";
            }
        }
        $cols[] = '`primeiro_visto`';
        $vals[] = $this->db::quoteValue($agora);
        $cols[] = '`saiu_em`';
        // abertas: voltou a estar aberta -> limpa saiu_em; resolvidas: mantém o que tiver
        $vals[] = 'NULL';
        if ($tipo === 'abertas') {
            $upd[] = '`saiu_em` = NULL';
        } else {
            $upd[] = '`saiu_em` = COALESCE(`saiu_em`, VALUES(`data_fechamento`))';
        }
        $this->db->doQuery(
            'INSERT INTO `glpi_plugin_painelixc_chamados` (' . implode(',', $cols) . ') VALUES (' . implode(',', $vals) . ')
             ON DUPLICATE KEY UPDATE ' . implode(', ', $upd)
        );
        return $this->db->affectedRows() === 1;   // 1 = inseriu, 2 = atualizou, 0 = idêntico
    }

    /** @return array<string,mixed>|null */
    private function base(string $codigo): ?array
    {
        if ($codigo === '') {
            return null;
        }
        $it = $this->db->request(['FROM' => 'glpi_plugin_painelixc_bases', 'WHERE' => ['codigo' => $codigo, 'is_active' => 1]]);
        foreach ($it as $row) {
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

    // ------------------------------------------------------------------ helpers puros

    /** @return list<array<string,mixed>> */
    public static function registros(mixed $v): array
    {
        if (!is_array($v)) {
            return [];
        }
        if (isset($v['registros']) && is_array($v['registros'])) {
            $v = $v['registros'];
        }
        $saida = [];
        foreach ($v as $r) {
            if (is_array($r) && isset($r['json']) && is_array($r['json']) && !isset($r['id'])) {
                $r = $r['json'];
            }
            if (is_array($r)) {
                $saida[] = $r;
            }
        }
        return $saida;
    }

    /** @param list<string> $campos @return array<int,string> */
    /** Apaga o log de sincronizações desta base mais velho que synclog_dias (em lotes; roda a cada retrato). */
    private function expurgarLogs(int $baseId): void
    {
        $dias = max(1, (int) Config::get('synclog_dias'));
        $limite = date('Y-m-d H:i:s', strtotime("-$dias days"));
        $this->db->doQuery(
            "DELETE FROM `glpi_plugin_painelixc_synclogs` WHERE `plugin_painelixc_bases_id` = $baseId AND `quando` < " . $this->db::quoteValue($limite) . ' LIMIT 2000'
        );
    }

    /**
     * Guarda os dicionários completos da base (o filtro de assunto lista tudo, mesmo sem O.S.).
     * Dicionário vazio = não veio nesta rodada (ex.: falha de DNS): mantém o que já havia.
     * @param array<string,array<int,string>> $dic
     */
    private function guardarDicionarios(int $baseId, array $dic, string $agora): void
    {
        foreach (['assuntos', 'tecnicos', 'setores', 'diagnosticos', 'condominios'] as $tipo) {
            $itens = $dic[$tipo] ?? [];
            if ($itens === []) {
                continue;
            }
            $vals = [];
            foreach ($itens as $id => $nome) {
                $vals[] = '(' . $baseId . ',' . $this->db::quoteValue($tipo) . ',' . (int) $id . ',' . $this->db::quoteValue($nome) . ',' . $this->db::quoteValue($agora) . ')';
            }
            foreach (array_chunk($vals, 500) as $bloco) {
                $this->db->doQuery(
                    'INSERT INTO `glpi_plugin_painelixc_dicionarios` (`plugin_painelixc_bases_id`,`tipo`,`ixc_id`,`nome`,`ultimo_visto`) VALUES '
                    . implode(',', $bloco) . ' ON DUPLICATE KEY UPDATE `nome` = VALUES(`nome`), `ultimo_visto` = VALUES(`ultimo_visto`)'
                );
            }
            // o que o IXC não mandou mais (cadastro apagado) sai da lista
            $this->db->doQuery(
                "DELETE FROM `glpi_plugin_painelixc_dicionarios` WHERE `plugin_painelixc_bases_id` = $baseId AND `tipo` = " . $this->db::quoteValue($tipo)
                . ' AND `ixc_id` NOT IN (' . implode(',', array_map('intval', array_keys($itens))) . ')'
            );
        }
    }

    public static function mapa(mixed $lista, array $campos): array
    {
        $m = [];
        foreach (self::registros($lista) as $r) {
            $id = self::int($r['id'] ?? null);
            if ($id === null) {
                continue;
            }
            foreach ($campos as $c) {
                $nome = trim((string) ($r[$c] ?? ''));
                if ($nome !== '' && $nome !== '0') {
                    $m[$id] = mb_substr($nome, 0, 200);
                    break;
                }
            }
        }
        return $m;
    }

    /** @param array<string,mixed> $r @param array<string,array<int,string>> $d @return array<string,mixed>|null */
    public static function normalizar(array $r, array $d): ?array
    {
        $id = self::int($r['id'] ?? null);
        if ($id === null || $id <= 0) {
            return null;
        }
        $z = static fn(?int $v) => ($v === null || $v === 0) ? null : $v;
        $idAssunto = self::int($r['id_assunto'] ?? null);
        $idSetor   = $z(self::int($r['setor'] ?? $r['id_setor'] ?? null));
        $idTecnico = $z(self::int($r['id_tecnico'] ?? null));
        $idCliente = $z(self::int($r['id_cliente'] ?? null));
        $idDiag    = $z(self::int($r['id_su_diagnostico'] ?? $r['id_diagnostico'] ?? null));
        $idCond    = $z(self::int($r['id_condominio'] ?? null));
        if ($idCond === null && $idCliente !== null && isset($d['cli_cond'][$idCliente])) {
            $idCond = $z(self::int($d['cli_cond'][$idCliente]));
        }
        $nome = static fn(string $dic, ?int $k) => ($k !== null && isset($d[$dic][$k])) ? $d[$dic][$k] : null;

        return [
            'ixc_id'             => $id,
            'protocolo'          => self::txt($r['protocolo'] ?? null, 40),
            'status'             => strtoupper(self::txt($r['status'] ?? null, 5) ?? '?'),
            'prioridade'         => self::txt($r['prioridade'] ?? null, 5),
            'id_assunto'         => $idAssunto,
            'assunto'            => $nome('assuntos', $idAssunto),
            'id_setor'           => $idSetor,
            'setor'              => $nome('setores', $idSetor),
            'id_tecnico'         => $idTecnico,
            'tecnico'            => $nome('tecnicos', $idTecnico),
            'id_cliente'         => $idCliente,
            'cliente'            => $nome('clientes', $idCliente),
            'id_condominio'      => $idCond,
            'condominio'         => $nome('condominios', $idCond),
            'id_diagnostico'     => $idDiag,
            'diagnostico'        => $nome('diagnosticos', $idDiag),
            'id_ticket'          => $z(self::int($r['id_ticket'] ?? null)),
            'mensagem'           => self::texto($r['mensagem'] ?? null),
            'mensagem_resposta'  => self::texto($r['mensagem_resposta'] ?? null),
            'data_abertura'      => self::data($r['data_abertura'] ?? null),
            'data_agenda'        => self::data($r['data_agenda'] ?? null),
            'data_inicio'        => self::data($r['data_inicio'] ?? null),
            'data_final'         => self::data($r['data_final'] ?? null),
            'data_fechamento'    => self::data($r['data_fechamento'] ?? null),
            'ultima_atualizacao' => self::data($r['ultima_atualizacao'] ?? null),
        ];
    }

    public static function texto(mixed $v): ?string
    {
        if (!is_string($v)) {
            return null;
        }
        $s = trim(html_entity_decode(strip_tags($v), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        return $s === '' ? null : mb_substr($s, 0, self::TAM_TEXTO);
    }

    public static function int(mixed $v): ?int
    {
        if (is_int($v)) {
            return $v;
        }
        if (is_string($v) && preg_match('/^\s*-?\d+\s*$/', $v)) {
            return (int) $v;
        }
        return null;
    }

    public static function txt(mixed $v, int $max): ?string
    {
        if ($v === null || is_array($v)) {
            return null;
        }
        $s = trim((string) $v);
        return $s === '' ? null : mb_substr($s, 0, $max);
    }

    public static function data(mixed $v): ?string
    {
        if (!is_string($v)) {
            return null;
        }
        $v = trim($v);
        if ($v === '' || str_starts_with($v, '0000-00-00')) {
            return null;
        }
        foreach (['Y-m-d H:i:s', 'Y-m-d H:i', 'Y-m-d', 'd/m/Y H:i:s', 'd/m/Y H:i', 'd/m/Y'] as $f) {
            $d = \DateTimeImmutable::createFromFormat('!' . $f, $v);
            if ($d !== false && $d->format($f) === $v) {
                return $d->format('Y-m-d H:i:s');
            }
        }
        return null;
    }
}
