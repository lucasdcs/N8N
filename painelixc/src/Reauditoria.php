<?php

namespace GlpiPlugin\Painelixc;

use DBmysql;
use Toolbox;

/**
 * 0.10.0 (P10-5; entra na produção com a 0.13.2) — o processo do IXC passou a abrir sozinho uma Auditoria NOVA quando o técnico finaliza a Ativação de novo.
 * Agora o painel não reabre mais a antiga: quando a Ativação vigiada volta a F, procura a Auditoria nova do mesmo
 * cliente aberta depois da reprovação, liga a ela (selo "Reauditoria (Nª)") e encaminha ao auditor que reprovou.
 * Só se o processo não abrir nada em ESPERA_PROCESSO_MIN (2 h) depois do fechamento é que reabre a antiga, como antes.
 *
 * Reauditoria (0.7.0): quando o painel reprova uma Auditoria e reabre a Ativação, a Ativação fica "aguardando".
 * Quando ela for FINALIZADA de novo, o painel abre uma nova O.S. de Auditoria (o processo do IXC não abre).
 * Só Ativações reabertas pelo painel são vigiadas → a 1ª finalização (do processo) nunca gera duplicata.
 *
 * Verificação: a cada retrato de auditorias da base (n8n, 10 min), depois do commit.
 * Reauditoria = a própria Auditoria anterior REABERTA (EN, mesmo auditor, mesmo atendimento/processo) — o IXC não
 * deixa criar 2ª O.S. no atendimento fora do processo (0.7.1).
 * Prazo: 30 dias (PRAZO_DIAS); Ativação cancelada → encerra sem abrir.
 */
final class Reauditoria
{
    public const TABELA = 'glpi_plugin_painelixc_reauditorias';
    public const PRAZO_DIAS = 30;
    public const MAX_TENTATIVAS = 5;
    public const ESPERA_PROCESSO_MIN = 120;

    /** Minutos que espera o processo do IXC abrir a Auditoria nova antes de reabrir a antiga (teste pode mudar). */
    public int $esperaMin = self::ESPERA_PROCESSO_MIN;

    /** @var callable */
    private $http;

    public function __construct(private DBmysql $db, ?callable $http = null, private ?string $agora = null)
    {
        $this->http = $http ?? [AcaoAuditoria::class, 'httpIxc'];
    }

    private function agora(): string
    {
        return $this->agora ?? date('Y-m-d H:i:s');
    }

    /** Chamado pela ação de reprovação que reabriu a Ativação. */
    public function marcar(int $baseId, int $osAtiv, int $osAud, string $acao, int $usersId, string $usuario): void
    {
        $q = fn($v) => $this->db::quoteValue($v);
        // rodada: a Auditoria reprovada era ela mesma uma reauditoria? então esta é a próxima
        $ant = $this->linha('SELECT `rodada` FROM `' . self::TABELA . "` WHERE `plugin_painelixc_bases_id` = $baseId
            AND `nova_auditoria_ixc_id` = $osAud ORDER BY `id` DESC LIMIT 1");
        $rodada = $ant ? ((int) $ant['rodada'] + 1) : 2;
        // uma espera por Ativação
        $this->db->doQuery('UPDATE `' . self::TABELA . "` SET `estado` = 'substituida', `atualizado_em` = " . $q($this->agora())
            . " WHERE `plugin_painelixc_bases_id` = $baseId AND `ativacao_ixc_id` = $osAtiv AND `estado` = 'aguardando'");
        $this->db->insert(self::TABELA, [
            'plugin_painelixc_bases_id' => $baseId, 'ativacao_ixc_id' => $osAtiv, 'auditoria_ixc_id' => $osAud,
            'rodada' => $rodada, 'acao' => $acao, 'users_id' => $usersId, 'usuario' => mb_substr($usuario, 0, 255),
            'reaberta_em' => $this->agora(), 'estado' => 'aguardando', 'tentativas' => 0, 'atualizado_em' => $this->agora(),
        ]);
    }

    /**
     * Vigia as Ativações "aguardando" da base e abre as reauditorias. Nunca lança exceção (roda dentro do ingest).
     * @return array{verificadas:int, criadas:list<int>, expiradas:int, canceladas:int, erros:list<string>}
     */
    public function verificar(int $baseId): array
    {
        $res = ['verificadas' => 0, 'criadas' => [], 'expiradas' => 0, 'canceladas' => 0, 'erros' => []];
        try {
            $b = $this->linha("SELECT * FROM `glpi_plugin_painelixc_bases` WHERE `id` = $baseId");
            $pend = $this->linhas('SELECT * FROM `' . self::TABELA . "` WHERE `plugin_painelixc_bases_id` = $baseId AND `estado` = 'aguardando' ORDER BY `id`");
            if (!$pend || !$b) {
                return $res;
            }
            $url = rtrim((string) ($b['ixc_url'] ?? ''), '/');
            if (empty($b['api_token']) || !preg_match('#^https?://#i', $url)) {
                $res['erros'][] = 'base sem token/URL para abrir reauditoria';
                return $res;
            }
            $token = (new \GLPIKey())->decrypt((string) $b['api_token']);
            $chamar = fn(string $rota, array $corpo, bool $listar = false) => ($this->http)($url, $rota, $corpo, $listar, $token);
            $limite = date('Y-m-d H:i:s', strtotime($this->agora() . ' -' . self::PRAZO_DIAS . ' days'));

            foreach ($pend as $p) {
                $res['verificadas']++;
                if ((string) $p['reaberta_em'] < $limite) {
                    $this->estado((int) $p['id'], 'expirada', 'Ativação não foi finalizada em ' . self::PRAZO_DIAS . ' dias.');
                    $res['expiradas']++;
                    continue;
                }
                $ativ = $this->os($chamar, (int) $p['ativacao_ixc_id']);
                if ($ativ === null) {
                    $this->falha($p, 'não consegui ler a Ativação O.S. ' . $p['ativacao_ixc_id'], $res);
                    continue;
                }
                $st = strtoupper((string) ($ativ['status'] ?? ''));
                if ($st === 'C') {
                    $this->estado((int) $p['id'], 'cancelada', 'Ativação cancelada; reauditoria não aberta.');
                    $res['canceladas']++;
                    continue;
                }
                // finalizada DE NOVO: status F e fechamento posterior à reabertura (10 min de folga para relógios diferentes)
                $fech = (string) ($ativ['data_fechamento'] ?? '');
                $folga = date('Y-m-d H:i:s', strtotime((string) $p['reaberta_em'] . ' -10 minutes'));
                if ($st !== 'F' || $fech === '' || str_starts_with($fech, '0000') || $fech < $folga) {
                    continue;   // ainda em correção
                }
                // P10-5: a Auditoria nova aberta pelo processo do IXC é a reauditoria
                $doProcesso = $this->auditoriaDoProcesso($baseId, $p, $ativ);
                if ($doProcesso !== null) {
                    $res['criadas'][] = $this->vincular($chamar, $p, $ativ, $doProcesso);
                    continue;
                }
                if (strtotime($this->agora()) - strtotime($fech) < $this->esperaMin * 60) {
                    continue;   // dá tempo ao processo do IXC abrir a Auditoria nova
                }
                $nova = $this->abrir($chamar, $p, $ativ);
                if (is_int($nova)) {
                    $res['criadas'][] = $nova;
                } else {
                    $this->falha($p, $nova, $res);
                }
            }
        } catch (\Throwable $e) {
            $res['erros'][] = 'reauditoria: ' . $e->getMessage();
            Toolbox::logInFile('php-errors', 'painelixc reauditoria: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() . "\n");
        }
        return $res;
    }

    /**
     * Reabre a própria Auditoria anterior (mesmo atendimento, mesmo processo, mesmo auditor).
     * Criar O.S. nova não dá: o IXC recusa 2ª O.S. no atendimento fora do processo
     * ("Esse ticket já possui uma O.S. vinculada… utilize PROCESSO!", visto em 05/10).
     * su_oss_chamado_reabrir com status EN mantém o técnico (validado na Ativação 134 em 02/10).
     * @param array<string,mixed> $p @param array<string,mixed> $ativ @return int|string O.S. reaberta ou mensagem de erro
     */
    private function abrir(callable $chamar, array $p, array $ativ): int|string
    {
        $osAud = (int) $p['auditoria_ixc_id'];
        $ant = $this->os($chamar, $osAud);
        if ($ant === null) {
            return 'não consegui ler a Auditoria anterior O.S. ' . $osAud;
        }
        $st = strtoupper((string) ($ant['status'] ?? ''));
        $rotAcao = AcaoAuditoria::descrever((string) $p['acao']);
        $msg = sprintf("Reauditoria (%dª) — a Ativação O.S. %d foi reprovada nesta Auditoria (%s, por %s em %s), reaberta para o técnico e finalizada novamente em %s. Verificar se a correção foi feita.",
            (int) $p['rodada'], (int) $p['ativacao_ixc_id'], $rotAcao, (string) $p['usuario'],
            date('d/m/Y H:i', strtotime((string) $p['reaberta_em'])), date('d/m/Y H:i', strtotime((string) $ativ['data_fechamento'])));
        if ($st !== 'F') {
            // já foi reaberta por alguém no IXC: só registra (não reabre de novo)
            $this->db->update(self::TABELA, ['estado' => 'criada', 'nova_auditoria_ixc_id' => $osAud, 'criada_em' => $this->agora(),
                'atualizado_em' => $this->agora(), 'detalhe' => "Auditoria O.S. $osAud já estava aberta no IXC (status $st)."], ['id' => (int) $p['id']]);
            return $osAud;
        }
        $r = $chamar('su_oss_chamado_reabrir', ['id_chamado' => (string) $osAud, 'status' => 'EN', 'mensagem' => $msg]);
        if (($r['type'] ?? '') !== 'success') {
            return 'IXC não reabriu a Auditoria O.S. ' . $osAud . ': ' . AcaoAuditoria::erroIxc($r);
        }
        $this->db->update(self::TABELA, ['estado' => 'criada', 'nova_auditoria_ixc_id' => $osAud, 'criada_em' => $this->agora(),
            'atualizado_em' => $this->agora(), 'detalhe' => "Auditoria O.S. $osAud reaberta (EN, mesmo auditor) para a reauditoria."], ['id' => (int) $p['id']]);
        return $osAud;
    }

    /**
     * Auditoria aberta pelo processo do IXC depois da reprovação, para o mesmo cliente (já recebida pelo painel).
     * @param array<string,mixed> $p @param array<string,mixed> $ativ @return array<string,mixed>|null
     */
    private function auditoriaDoProcesso(int $baseId, array $p, array $ativ): ?array
    {
        $osAud = (int) $p['auditoria_ixc_id'];
        $ant = $this->linha("SELECT `id_cliente`, `id_tecnico` FROM `glpi_plugin_painelixc_auditorias` WHERE `plugin_painelixc_bases_id` = $baseId AND `ixc_id` = $osAud");
        $cli = (int) ($ant['id_cliente'] ?? 0) ?: (int) ($ativ['id_cliente'] ?? 0);
        if ($cli <= 0) {
            return null;
        }
        $desde = date('Y-m-d H:i:s', strtotime((string) $p['reaberta_em'] . ' -10 minutes'));
        return $this->linha("SELECT n.* FROM `glpi_plugin_painelixc_auditorias` n
            WHERE n.`plugin_painelixc_bases_id` = $baseId AND n.`id_cliente` = $cli AND n.`ixc_id` <> $osAud
              AND n.`data_abertura` >= " . $this->db::quoteValue($desde) . "
              AND NOT EXISTS (SELECT 1 FROM `" . self::TABELA . "` r WHERE r.`plugin_painelixc_bases_id` = n.`plugin_painelixc_bases_id`
                              AND (r.`nova_auditoria_ixc_id` = n.`ixc_id` OR r.`auditoria_ixc_id` = n.`ixc_id`))
            ORDER BY n.`data_abertura`, n.`ixc_id` LIMIT 1");
    }

    /**
     * Liga a reprovação à Auditoria nova do processo e encaminha ao auditor que reprovou (se ainda A/EN com outro técnico).
     * @param array<string,mixed> $p @param array<string,mixed> $ativ @param array<string,mixed> $n
     */
    private function vincular(callable $chamar, array $p, array $ativ, array $n): int
    {
        $baseId = (int) $p['plugin_painelixc_bases_id'];
        $osNova = (int) $n['ixc_id'];
        $ant = $this->linha("SELECT `id_tecnico` FROM `glpi_plugin_painelixc_auditorias` WHERE `plugin_painelixc_bases_id` = $baseId AND `ixc_id` = " . (int) $p['auditoria_ixc_id']);
        $auditor = (int) ($ant['id_tecnico'] ?? 0);
        $det = "Auditoria O.S. $osNova aberta pelo processo do IXC ligada como Reauditoria (" . (int) $p['rodada'] . 'ª).';
        $st = strtoupper((string) ($n['status'] ?? ''));
        if ($auditor > 0 && (int) ($n['id_tecnico'] ?? 0) !== $auditor && in_array($st, ['A', 'EN'], true)) {
            $msg = sprintf('Reauditoria (%dª) — a Ativação O.S. %d foi reprovada na Auditoria O.S. %d (%s, por %s em %s), corrigida e finalizada em %s. Encaminhada ao auditor que reprovou.',
                (int) $p['rodada'], (int) $p['ativacao_ixc_id'], (int) $p['auditoria_ixc_id'], AcaoAuditoria::descrever((string) $p['acao']), (string) $p['usuario'],
                date('d/m/Y H:i', strtotime((string) $p['reaberta_em'])), date('d/m/Y H:i', strtotime((string) $ativ['data_fechamento'])));
            $r = $chamar('su_oss_chamado_alterar_setor', ['id_chamado' => (string) $osNova, 'alterar_setor' => 'S',
                'id_setor' => (string) ((int) ($n['id_setor'] ?? 0) ?: ''), 'id_tecnico' => (string) $auditor, 'status' => 'EN', 'mensagem' => $msg,
                'id_assunto' => '', 'data' => '', 'id_evento' => '', 'latitude' => '', 'longitude' => '', 'gps_time' => '', 'historico' => '']);
            if (($r['type'] ?? '') === 'success') {
                $det .= " Encaminhada ao auditor #$auditor.";
                $this->db->doQuery("UPDATE `glpi_plugin_painelixc_auditorias` SET `id_tecnico` = $auditor, `status` = 'EN' WHERE `id` = " . (int) $n['id']);
            } else {
                $det .= ' Não consegui encaminhar ao auditor #' . $auditor . ': ' . AcaoAuditoria::erroIxc($r) . '.';
                Toolbox::logInFile('php-errors', 'painelixc reauditoria: ' . $det . "\n");
            }
        }
        $this->db->update(self::TABELA, ['estado' => 'criada', 'nova_auditoria_ixc_id' => $osNova, 'criada_em' => $this->agora(),
            'atualizado_em' => $this->agora(), 'detalhe' => mb_substr($det, 0, 1000)], ['id' => (int) $p['id']]);
        return $osNova;
    }

    /** @param array<string,mixed> $p @param array<string,mixed> $res */
    private function falha(array $p, string $msg, array &$res): void
    {
        $t = (int) $p['tentativas'] + 1;
        $this->db->update(self::TABELA, ['tentativas' => $t, 'estado' => $t >= self::MAX_TENTATIVAS ? 'erro' : 'aguardando',
            'detalhe' => mb_substr($msg, 0, 1000), 'atualizado_em' => $this->agora()], ['id' => (int) $p['id']]);
        $res['erros'][] = $msg;
        Toolbox::logInFile('php-errors', 'painelixc reauditoria: ' . $msg . "\n");
    }

    private function estado(int $id, string $estado, string $det): void
    {
        $this->db->update(self::TABELA, ['estado' => $estado, 'detalhe' => $det, 'atualizado_em' => $this->agora()], ['id' => $id]);
    }

    /** @return array<string,mixed>|null */
    private function os(callable $chamar, int $id): ?array
    {
        $r = $chamar('su_oss_chamado', ['qtype' => 'su_oss_chamado.id', 'query' => (string) $id, 'oper' => '=', 'page' => '1',
            'rp' => '1', 'sortname' => 'su_oss_chamado.id', 'sortorder' => 'asc'], true);
        $o = $r['registros'][0] ?? null;
        return is_array($o) && (int) ($o['id'] ?? 0) === $id ? $o : null;
    }

    /** @return array<string,mixed>|null */
    private function linha(string $sql): ?array
    {
        $r = $this->db->doQuery($sql);
        $l = $r ? $r->fetch_assoc() : null;
        return is_array($l) ? $l : null;
    }

    /** @return list<array<string,mixed>> */
    private function linhas(string $sql): array
    {
        $r = $this->db->doQuery($sql);
        $o = [];
        while ($r && ($l = $r->fetch_assoc())) {
            $o[] = $l;
        }
        return $o;
    }

    /** Para a tela: rodada de cada reauditoria aberta ("baseId:os" => n) e quantas Ativações aguardam correção por base. */
    public function resumo(): array
    {
        $rod = [];
        foreach ($this->linhas('SELECT `plugin_painelixc_bases_id` b, `nova_auditoria_ixc_id` os, `rodada` FROM `' . self::TABELA . "` WHERE `estado` = 'criada' ORDER BY `id`") as $l) {
            $rod[$l['b'] . ':' . $l['os']] = (int) $l['rodada'];
        }
        $agu = [];
        foreach ($this->linhas('SELECT `plugin_painelixc_bases_id` b, COUNT(*) n FROM `' . self::TABELA . "` WHERE `estado` = 'aguardando' GROUP BY `plugin_painelixc_bases_id`") as $l) {
            $agu[(int) $l['b']] = (int) $l['n'];
        }
        return ['rodadas' => $rod, 'aguardando' => $agu];
    }
}
