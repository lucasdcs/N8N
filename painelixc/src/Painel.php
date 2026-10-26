<?php

namespace GlpiPlugin\Painelixc;

use DBmysql;

/** Dados das telas (JSON). Contagens por filtro são feitas no navegador. */
final class Painel
{
    public const STATUS = [
        'A' => 'Aberta', 'AN' => 'Análise', 'EN' => 'Encaminhada', 'AS' => 'Assumida', 'AG' => 'Agendada',
        'RAG' => 'Reagendar', 'DS' => 'Deslocamento', 'EX' => 'Execução', 'F' => 'Finalizada', 'C' => 'Cancelada',
    ];

    private const CAMPOS = ['c.id', 'b.codigo AS base', 'c.ixc_id', 'c.protocolo', 'c.status', 'c.prioridade',
        'c.id_assunto', 'c.assunto', 'c.id_setor', 'c.setor', 'c.id_tecnico', 'c.tecnico', 'c.id_cliente', 'c.cliente',
        'c.id_condominio', 'c.condominio', 'c.id_diagnostico', 'c.diagnostico', 'c.id_ticket', 'c.mensagem',
        'c.mensagem_resposta', 'c.data_abertura', 'c.data_agenda', 'c.data_inicio', 'c.data_final', 'c.data_fechamento',
        'c.ultima_atualizacao', 'c.primeiro_visto', 'c.saiu_em'];

    private const INTS = ['id', 'ixc_id', 'id_assunto', 'id_setor', 'id_tecnico', 'id_cliente', 'id_condominio',
        'id_diagnostico', 'id_ticket'];

    public function __construct(private DBmysql $db)
    {
    }

    /** @return array<string,mixed> */
    public function bases(): array
    {
        $rows = [];
        $it = $this->db->request([
            'SELECT' => ['b.*', new \QueryExpression(
                '(SELECT COUNT(*) FROM `glpi_plugin_painelixc_chamados` c2
                   WHERE c2.`plugin_painelixc_bases_id` = b.`id` AND c2.`is_active` = 0
                     AND c2.`saiu_em` >= NOW() - INTERVAL 24 HOUR) AS `sairam_24h`'
            )],
            'FROM'   => 'glpi_plugin_painelixc_bases AS b',
            'WHERE'  => ['b.is_active' => 1],
            'ORDER'  => 'b.ordem',
        ]);
        foreach ($it as $b) {
            foreach (['id', 'ordem', 'is_active', 'ultimo_total_ixc', 'ultimo_recebido', 'sairam_24h'] as $k) {
                $b[$k] = $b[$k] === null ? null : (int) $b[$k];
            }
            $rows[] = $b;
        }
        return $rows;
    }

    /** Aba Abertas. @return array<string,mixed> */
    public function abertas(): array
    {
        $it = $this->db->request([
            'SELECT'    => self::CAMPOS,
            'FROM'      => 'glpi_plugin_painelixc_chamados AS c',
            'INNER JOIN' => ['glpi_plugin_painelixc_bases AS b' => ['ON' => ['b' => 'id', 'c' => 'plugin_painelixc_bases_id']]],
            'WHERE'     => ['c.is_active' => 1, 'b.is_active' => 1],
            'ORDER'     => ['c.data_abertura ASC', 'c.id ASC'],
        ]);
        return $this->envelope($it, 'abertas');
    }

    /**
     * Aba Resolvidas: O.S. finalizadas/canceladas com data_fechamento no período.
     * @return array<string,mixed>
     */
    public function resolvidas(string $de, string $ate): array
    {
        $it = $this->db->request([
            'SELECT'    => self::CAMPOS,
            'FROM'      => 'glpi_plugin_painelixc_chamados AS c',
            'INNER JOIN' => ['glpi_plugin_painelixc_bases AS b' => ['ON' => ['b' => 'id', 'c' => 'plugin_painelixc_bases_id']]],
            'WHERE'     => [
                'c.is_active' => 0,
                'b.is_active' => 1,
                'c.status'    => ['F', 'C'],
                ['c.data_fechamento' => ['>=', $de . ' 00:00:00']],
                ['c.data_fechamento' => ['<=', $ate . ' 23:59:59']],
            ],
            'ORDER'     => ['c.data_fechamento DESC', 'c.id DESC'],
            'LIMIT'     => 5000,
        ]);
        $r = $this->envelope($it, 'resolvidas');
        $r['periodo'] = ['de' => $de, 'ate' => $ate];
        return $r;
    }

    /** @return array<string,mixed> */
    private function envelope(iterable $it, string $aba): array
    {
        $chamados = [];
        foreach ($it as $c) {
            foreach (self::INTS as $k) {
                $c[$k] = $c[$k] === null ? null : (int) $c[$k];
            }
            $chamados[] = $c;
        }
        return [
            'ok'       => true,
            'aba'      => $aba,
            'agora'    => date('Y-m-d H:i:s'),
            'versao'   => PLUGIN_PAINELIXC_VERSION,
            'config'   => [
                'atraso_horas'       => (int) Config::get('atraso_horas'),
                'sync_intervalo_min' => (int) Config::get('sync_intervalo_min'),
                'historico_dias'     => (int) Config::get('historico_dias'),
            ],
            'status'   => self::STATUS,
            'bases'    => $this->bases(),
            'chamados' => $chamados,
            'assuntos' => $this->dicionario('assuntos'),
            'sla'      => (new Sla($this->db))->configs(),   // 0.13.5: cadastro de SLA dos assuntos (o % é calculado na tela)
        ];
    }

    /** Dicionário completo de um tipo, das bases ativas: [{base, id, nome}]. @return list<array<string,mixed>> */
    public function dicionario(string $tipo): array
    {
        $out = [];
        $it = $this->db->request([
            'SELECT'     => ['d.ixc_id', 'd.nome', 'b.codigo'],
            'FROM'       => 'glpi_plugin_painelixc_dicionarios AS d',
            'INNER JOIN' => ['glpi_plugin_painelixc_bases AS b' => ['ON' => ['b' => 'id', 'd' => 'plugin_painelixc_bases_id']]],
            'WHERE'      => ['d.tipo' => $tipo, 'b.is_active' => 1],
            'ORDER'      => 'd.nome',
        ]);
        foreach ($it as $r) {
            $out[] = ['base' => $r['codigo'], 'id' => (int) $r['ixc_id'], 'nome' => (string) $r['nome']];
        }
        return $out;
    }

    /** Valida 'AAAA-MM-DD'; devolve null se inválida. */
    public static function dia(mixed $v): ?string
    {
        if (!is_string($v) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
            return null;
        }
        $d = \DateTimeImmutable::createFromFormat('!Y-m-d', $v);
        return ($d !== false && $d->format('Y-m-d') === $v) ? $v : null;
    }
}
