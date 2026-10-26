<?php

namespace GlpiPlugin\Painelixc;

use DBmysql;
use Toolbox;

/**
 * Distribuição de auditorias (0.9.0).
 *
 * O processo do IXC encaminha toda Auditoria nova para o técnico padrão (Lucas). A cada retrato de auditorias
 * de uma base (n8n, 10 min), as auditorias novas ainda com o padrão são reencaminhadas para o auditor que
 * RECEBEU MENOS na janela (30 dias, ou desde a ativação se for mais recente) — cota igual de recebidas.
 * Não olha o que está em aberto: segurar chamado aberto não diminui o que a pessoa recebe.
 *
 * - Pendente = ativa no painel, status A/EN, técnico 0 ou o padrão, aberta depois de "dist_desde",
 *   sem distribuição real gravada e que não seja reauditoria (reauditoria fica com quem auditou).
 * - Contagem = auditorias das 5 bases na janela, pelo técnico atual, sem contar as pendentes.
 * - Empate → sorteio. Escolheu o próprio padrão → só registra (não chama o IXC).
 * - Simulação (dist_simular): grava só a última decisão por base (modo "simulado"), não mexe no IXC.
 * - Encaminhar: su_oss_chamado_alterar_setor (status EN, setor mantido). 5 falhas na mesma O.S. → desiste.
 */
final class Distribuicao
{
    public const TABELA = 'glpi_plugin_painelixc_distribuicoes';
    public const JANELA_DIAS = 30;
    public const MAX_FALHAS = 5;

    /** @var callable */
    private $http;
    /** @var callable */
    private $sortear;

    public function __construct(private DBmysql $db, ?callable $http = null, private ?string $agora = null, ?callable $sortear = null)
    {
        $this->http = $http ?? [AcaoAuditoria::class, 'httpIxc'];
        $this->sortear = $sortear ?? static fn(array $ids) => $ids[array_rand($ids)];
    }

    private function agora(): string
    {
        return $this->agora ?? date('Y-m-d H:i:s');
    }

    /** @return list<int> */
    public static function auditores(): array
    {
        return array_values(array_unique(array_filter(array_map('intval', explode(',', (string) Config::get('dist_auditores'))))));
    }

    /** Início da contagem: o mais recente entre (agora − 30 dias) e "dist_desde". */
    public function inicioJanela(): string
    {
        $janela = date('Y-m-d H:i:s', strtotime($this->agora() . ' -' . self::JANELA_DIAS . ' days'));
        $desde = (string) Config::get('dist_desde');
        return ($desde !== '' && $desde > $janela) ? $desde : $janela;
    }

    /** Técnicos que o painel conhece (dicionário), um por id: [{id, nome, bases}]. */
    public static function tecnicosConhecidos(): array
    {
        global $DB;
        $r = $DB->doQuery("SELECT `ixc_id` id, MAX(`nome`) nome, COUNT(DISTINCT `plugin_painelixc_bases_id`) bases
            FROM `glpi_plugin_painelixc_dicionarios` WHERE `tipo` = 'tecnicos' AND `ixc_id` > 0 GROUP BY `ixc_id` ORDER BY nome");
        $o = [];
        while ($r && ($l = $r->fetch_assoc())) {
            $o[] = ['id' => (int) $l['id'], 'nome' => (string) $l['nome'], 'bases' => (int) $l['bases']];
        }
        return $o;
    }

    /**
     * Linhas de auditoria na janela (todas as bases) com a marca "pendente".
     * @return list<array<string,mixed>>
     */
    private function linhasJanela(string $inicio, int $padrao): array
    {
        $q = fn($v) => $this->db::quoteValue($v);
        $sql = "SELECT a.`plugin_painelixc_bases_id` base, a.`ixc_id`, a.`id_tecnico`, a.`id_setor`, a.`status`, a.`is_active`, a.`data_abertura`, a.`id`,
                   (SELECT COUNT(*) FROM `" . self::TABELA . "` d WHERE d.`plugin_painelixc_bases_id` = a.`plugin_painelixc_bases_id`
                      AND d.`auditoria_ixc_id` = a.`ixc_id` AND d.`modo` = 'real' AND d.`ok` = 1) dist_ok,
                   (SELECT COUNT(*) FROM `" . self::TABELA . "` d WHERE d.`plugin_painelixc_bases_id` = a.`plugin_painelixc_bases_id`
                      AND d.`auditoria_ixc_id` = a.`ixc_id` AND d.`modo` = 'real' AND d.`ok` = 0) falhas,
                   (SELECT COUNT(*) FROM `" . Reauditoria::TABELA . "` r WHERE r.`plugin_painelixc_bases_id` = a.`plugin_painelixc_bases_id`
                      AND (r.`nova_auditoria_ixc_id` = a.`ixc_id` OR r.`auditoria_ixc_id` = a.`ixc_id`
                           OR (r.`estado` = 'aguardando' AND a.`data_abertura` >= r.`reaberta_em` - INTERVAL 10 MINUTE
                               AND a.`id_cliente` > 0 AND a.`id_cliente` = (SELECT o.`id_cliente` FROM `glpi_plugin_painelixc_auditorias` o
                               WHERE o.`plugin_painelixc_bases_id` = r.`plugin_painelixc_bases_id` AND o.`ixc_id` = r.`auditoria_ixc_id` LIMIT 1)))) reaud
                FROM `glpi_plugin_painelixc_auditorias` a
                WHERE a.`data_abertura` >= " . $q($inicio) . " ORDER BY a.`data_abertura`, a.`ixc_id`";
        $r = $this->db->doQuery($sql);
        $o = [];
        while ($r && ($l = $r->fetch_assoc())) {
            $tec = (int) ($l['id_tecnico'] ?? 0);
            $l['pendente'] = (int) $l['is_active'] === 1 && in_array(strtoupper((string) $l['status']), ['A', 'EN'], true)
                && ($tec === 0 || $tec === $padrao) && (int) $l['dist_ok'] === 0 && (int) $l['reaud'] === 0;
            $l['desistiu'] = (int) $l['falhas'] >= self::MAX_FALHAS;
            $o[] = $l;
        }
        return $o;
    }

    /** Recebidas na janela por auditor (sem contar as pendentes). @param list<int> $aud @return array<int,int> */
    private function contagem(array $linhas, array $aud): array
    {
        $c = array_fill_keys($aud, 0);
        foreach ($linhas as $l) {
            $t = (int) ($l['id_tecnico'] ?? 0);
            if ((!$l['pendente'] || $l['desistiu']) && isset($c[$t])) {   // desistida fica com quem está
                $c[$t]++;
            }
        }
        return $c;
    }

    /**
     * Roda depois do retrato de uma base. Nunca lança exceção (está dentro do ingest).
     * @return array{ativo:bool, simulacao:bool, pendentes:int, decisoes:list<array<string,mixed>>, erros:list<string>}
     */
    public function executar(int $baseId): array
    {
        $res = ['ativo' => (bool) Config::get('dist_ativo'), 'simulacao' => (bool) Config::get('dist_simular'), 'pendentes' => 0, 'decisoes' => [], 'erros' => []];
        $aud = self::auditores();
        if (!$res['ativo'] || !$aud) {
            return $res;
        }
        $trava = 'painelixc_distribuicao';
        $r = $this->db->doQuery('SELECT GET_LOCK(' . $this->db::quoteValue($trava) . ', 10) AS t');
        if ((int) (($r ? $r->fetch_assoc() : [])['t'] ?? 0) !== 1) {
            $res['erros'][] = 'outra distribuição em andamento';
            return $res;
        }
        try {
            $padrao = (int) Config::get('dist_padrao');
            $inicio = $this->inicioJanela();
            $linhas = $this->linhasJanela($inicio, $padrao);
            $cont = $this->contagem($linhas, $aud);
            $pend = array_values(array_filter($linhas, fn($l) => $l['pendente'] && !$l['desistiu'] && (int) $l['base'] === $baseId));
            $res['pendentes'] = count($pend);
            if ($res['simulacao']) {
                $this->db->doQuery('DELETE FROM `' . self::TABELA . "` WHERE `plugin_painelixc_bases_id` = $baseId AND `modo` = 'simulado'");
            }
            $b = $pend ? $this->linha("SELECT * FROM `glpi_plugin_painelixc_bases` WHERE `id` = $baseId") : null;
            $chamar = null;
            if ($pend && !$res['simulacao']) {
                $url = rtrim((string) ($b['ixc_url'] ?? ''), '/');
                if (empty($b['api_token']) || !preg_match('#^https?://#i', $url)) {
                    $res['erros'][] = 'base sem token da API/URL: auditorias não distribuídas';
                    return $res;
                }
                $token = (new \GLPIKey())->decrypt((string) $b['api_token']);
                $chamar = fn(string $rota, array $corpo) => ($this->http)($url, $rota, $corpo, false, $token);
            }
            $nomes = $this->nomes($aud);
            foreach ($pend as $p) {
                $min = min($cont);
                $empatados = array_values(array_keys(array_filter($cont, fn($n) => $n === $min)));
                $para = (int) ($this->sortear)($empatados);
                $de = (int) ($p['id_tecnico'] ?? 0);
                $foto = 'recebidas antes: ' . implode(', ', array_map(fn($id) => ($nomes[$id] ?? "#$id") . ' ' . $cont[$id], $aud));
                $dec = ['os' => (int) $p['ixc_id'], 'de' => $de, 'para' => $para, 'nome' => $nomes[$para] ?? ('#' . $para)];
                if ($res['simulacao']) {
                    $this->gravar($baseId, (int) $p['ixc_id'], $de, $para, 'simulado', true, $foto);
                    $dec['ok'] = true;
                } elseif ($para === $de) {
                    $this->gravar($baseId, (int) $p['ixc_id'], $de, $para, 'real', true, 'mantida com o técnico atual (menor cota). ' . $foto);
                    $dec['ok'] = true;
                } else {
                    $rr = $chamar('su_oss_chamado_alterar_setor', [
                        'id_chamado' => (string) $p['ixc_id'], 'alterar_setor' => 'S', 'id_setor' => (string) ((int) ($p['id_setor'] ?? 0) ?: ''),
                        'id_tecnico' => (string) $para, 'status' => 'EN',
                        'mensagem' => 'Auditoria distribuída pelo Painel IXC para ' . ($nomes[$para] ?? ('#' . $para)) . ' (cota igual de auditorias recebidas).',
                        'id_assunto' => '', 'data' => '', 'id_evento' => '', 'latitude' => '', 'longitude' => '', 'gps_time' => '', 'historico' => '',
                    ]);
                    $ok = ($rr['type'] ?? '') === 'success';
                    $this->gravar($baseId, (int) $p['ixc_id'], $de, $para, 'real', $ok, ($ok ? 'encaminhada. ' : 'IXC recusou: ' . AcaoAuditoria::erroIxc($rr) . '. ') . $foto);
                    $dec['ok'] = $ok;
                    if ($ok) {
                        $this->db->doQuery('UPDATE `glpi_plugin_painelixc_auditorias` SET `id_tecnico` = ' . $para . ", `status` = 'EN' WHERE `id` = " . (int) $p['id']);
                    } else {
                        $res['erros'][] = 'O.S. ' . $p['ixc_id'] . ': ' . AcaoAuditoria::erroIxc($rr);
                        $res['decisoes'][] = $dec;
                        continue;   // não conta: fica pendente para a próxima rodada
                    }
                }
                $cont[$para]++;
                $res['decisoes'][] = $dec;
            }
        } catch (\Throwable $e) {
            $res['erros'][] = 'distribuição: ' . $e->getMessage();
            Toolbox::logInFile('php-errors', 'painelixc distribuicao: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() . "\n");
        } finally {
            $this->db->doQuery('SELECT RELEASE_LOCK(' . $this->db::quoteValue($trava) . ')');
        }
        return $res;
    }

    private function gravar(int $base, int $os, int $de, int $para, string $modo, bool $ok, string $det): void
    {
        $this->db->insert(self::TABELA, ['plugin_painelixc_bases_id' => $base, 'auditoria_ixc_id' => $os, 'de_tecnico' => $de ?: null,
            'para_tecnico' => $para, 'modo' => $modo, 'ok' => $ok ? 1 : 0, 'quando' => $this->agora(), 'detalhe' => mb_substr($det, 0, 2000)]);
    }

    /** @param list<int> $ids @return array<int,string> */
    private function nomes(array $ids): array
    {
        $o = [];
        if (!$ids) {
            return $o;
        }
        $r = $this->db->doQuery("SELECT `ixc_id`, MAX(`nome`) nome FROM `glpi_plugin_painelixc_dicionarios` WHERE `tipo` = 'tecnicos'
            AND `ixc_id` IN (" . implode(',', array_map('intval', $ids)) . ') GROUP BY `ixc_id`');
        while ($r && ($l = $r->fetch_assoc())) {
            $o[(int) $l['ixc_id']] = (string) $l['nome'];
        }
        return $o;
    }

    /** @return array<string,mixed>|null */
    private function linha(string $sql): ?array
    {
        $r = $this->db->doQuery($sql);
        $l = $r ? $r->fetch_assoc() : null;
        return is_array($l) ? $l : null;
    }

    /**
     * Quadro por auditor para a tela: recebidas (cota), abertas agora, mais antiga aberta, concluídas em 7 dias;
     * pendentes de distribuição e as últimas decisões (simuladas ou reais).
     */
    public function quadro(): array
    {
        $aud = self::auditores();
        if (!$aud) {
            return ['auditores' => []];
        }
        $padrao = (int) Config::get('dist_padrao');
        $inicio = $this->inicioJanela();
        $linhas = $this->linhasJanela($inicio, $padrao);
        $cont = $this->contagem($linhas, $aud);
        $nomes = $this->nomes($aud);
        $ids = implode(',', array_map('intval', $aud));
        $q = fn($v) => $this->db::quoteValue($v);
        $abertas = [];
        $r = $this->db->doQuery("SELECT `id_tecnico` t, COUNT(*) n, MIN(`data_abertura`) mais_antiga FROM `glpi_plugin_painelixc_auditorias`
            WHERE `is_active` = 1 AND `id_tecnico` IN ($ids) GROUP BY `id_tecnico`");
        while ($r && ($l = $r->fetch_assoc())) {
            $abertas[(int) $l['t']] = $l;
        }
        $conc = [];
        $r = $this->db->doQuery("SELECT `id_tecnico` t, COUNT(*) n FROM `glpi_plugin_painelixc_auditorias`
            WHERE `is_active` = 0 AND `id_tecnico` IN ($ids) AND `saiu_em` >= " . $q(date('Y-m-d H:i:s', strtotime($this->agora() . ' -7 days'))) . ' GROUP BY `id_tecnico`');
        while ($r && ($l = $r->fetch_assoc())) {
            $conc[(int) $l['t']] = (int) $l['n'];
        }
        $lista = [];
        foreach ($aud as $id) {
            $ma = $abertas[$id]['mais_antiga'] ?? null;
            $lista[] = ['id' => $id, 'nome' => $nomes[$id] ?? ('#' . $id), 'recebidas' => $cont[$id] ?? 0,
                'abertas' => (int) ($abertas[$id]['n'] ?? 0), 'mais_antiga' => $ma,
                'mais_antiga_dias' => $ma ? (int) floor((strtotime($this->agora()) - strtotime((string) $ma)) / 86400) : null,
                'concluidas_7d' => $conc[$id] ?? 0, 'padrao' => $id === $padrao];
        }
        $pend = count(array_filter($linhas, fn($l) => $l['pendente'] && !$l['desistiu']));
        $ult = [];
        $r = $this->db->doQuery('SELECT d.*, b.`codigo` base FROM `' . self::TABELA . '` d JOIN `glpi_plugin_painelixc_bases` b ON b.`id` = d.`plugin_painelixc_bases_id`
            WHERE d.`modo` = ' . $q(Config::get('dist_simular') ? 'simulado' : 'real') . ' ORDER BY d.`id` DESC LIMIT 15');
        while ($r && ($l = $r->fetch_assoc())) {
            $ult[] = ['base' => $l['base'], 'os' => (int) $l['auditoria_ixc_id'], 'para' => (int) $l['para_tecnico'],
                'nome' => $nomes[(int) $l['para_tecnico']] ?? ('#' . $l['para_tecnico']), 'ok' => (int) $l['ok'], 'quando' => $l['quando'], 'detalhe' => $l['detalhe']];
        }
        return ['auditores' => $lista, 'inicio' => $inicio, 'ativo' => (bool) Config::get('dist_ativo'),
            'simulacao' => (bool) Config::get('dist_simular'), 'pendentes' => $pend, 'ultimas' => $ult, 'padrao' => $padrao];
    }
}
