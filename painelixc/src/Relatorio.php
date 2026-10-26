<?php

namespace GlpiPlugin\Painelixc;

use DBmysql;

/**
 * Relatório / Indicadores: consulta filtrada + agregados por assunto, diagnóstico,
 * condomínio, colaborador, base, status e dia. Tudo calculado em PHP sobre as linhas
 * filtradas (volume: centenas a poucos milhares por período).
 */
final class Relatorio
{
    public const MODOS = [
        'resolvidas' => 'O.S. resolvidas no período (data de fechamento)',
        'abertas'    => 'O.S. abertas no período (data de abertura)',
    ];
    public const DIMENSOES = [
        'assunto'     => ['id_assunto',     'assunto',     'Assunto'],
        'diagnostico' => ['id_diagnostico', 'diagnostico', 'Diagnóstico'],
        'condominio'  => ['id_condominio',  'condominio',  'Condomínio'],
        'tecnico'     => ['id_tecnico',     'tecnico',     'Colaborador'],
        'base'        => ['plugin_painelixc_bases_id', 'base_nome', 'Base'],
        'status'      => ['status',         'status_nome', 'Status'],
    ];
    public const LIMITE_LINHAS = 20000;

    public function __construct(private DBmysql $db)
    {
    }

    // ------------------------------------------------------------------ filtros

    /** Normaliza o que veio da querystring. @param array<string,mixed> $q @return array<string,mixed> */
    public static function filtros(array $q): array
    {
        $ate = Painel::dia($q['ate'] ?? null) ?? date('Y-m-d');
        $de  = Painel::dia($q['de'] ?? null) ?? date('Y-m-d', strtotime($ate . ' -30 days'));
        if ($de > $ate) {
            [$de, $ate] = [$ate, $de];
        }
        $ids = static function (mixed $v): array {
            if (is_string($v)) {
                $v = explode(',', $v);
            }
            if (!is_array($v)) {
                return [];
            }
            $out = [];
            foreach ($v as $x) {
                if (is_numeric($x) && (int) $x > 0) {
                    $out[] = (int) $x;
                }
            }
            return array_values(array_unique($out));
        };
        // dimensões por nome (mesmo nome em bases diferentes = um item só); "id:N" quando não há nome; "id:0" = sem valor
        $valores = static function (mixed $v): array {
            if (is_string($v)) {
                $v = [$v];
            }
            if (!is_array($v)) {
                return [];
            }
            $out = [];
            foreach ($v as $x) {
                if (!is_string($x) && !is_numeric($x)) {
                    continue;
                }
                $x = trim((string) $x);
                if ($x !== '' && mb_strlen($x) <= 200) {
                    $out[] = $x;
                }
            }
            return array_values(array_unique($out));
        };
        return [
            'modo'        => (($q['modo'] ?? 'resolvidas') === 'abertas') ? 'abertas' : 'resolvidas',
            'de'          => $de,
            'ate'         => $ate,
            'bases'       => $ids($q['bases'] ?? []),
            'assunto'     => $valores($q['assunto'] ?? []),
            'diagnostico' => $valores($q['diagnostico'] ?? []),
            'condominio'  => $valores($q['condominio'] ?? []),
            'tecnico'     => $valores($q['tecnico'] ?? []),
            'sem_diagnostico' => !empty($q['sem_diagnostico']) && $q['sem_diagnostico'] !== '0',
        ];
    }

    /**
     * Opções dos dropdowns, hierárquicas da esquerda para a direita:
     * Bases → Assunto → Diagnóstico → Condomínio → Colaborador. Cada lista só traz o que existe
     * no período/modo e dentro do que foi escolhido nas dimensões anteriores. Itens agrupados por nome.
     * @param array<string,mixed> $f @return array<string,mixed>
     */
    public function opcoes(array $f): array
    {
        $bases = [];
        foreach ($this->db->request(['FROM' => 'glpi_plugin_painelixc_bases', 'WHERE' => ['is_active' => 1], 'ORDER' => 'ordem']) as $b) {
            $bases[] = ['valor' => (int) $b['id'], 'nome' => $b['nome'], 'cor' => $b['cor']];
        }
        $dims = ['assunto' => ['id_assunto', 'assunto', 'Sem assunto'], 'diagnostico' => ['id_diagnostico', 'diagnostico', 'Sem diagnóstico'],
            'condominio' => ['id_condominio', 'condominio', 'Sem condomínio'], 'tecnico' => ['id_tecnico', 'tecnico', 'Sem técnico']];
        $out = ['modos' => self::MODOS, 'bases' => $bases];
        foreach ($dims as $dim => [$idCol, $nomeCol, $rotNulo]) {
            $it = $this->db->request([
                'SELECT'     => ["c.$idCol", "c.$nomeCol", new \QueryExpression('COUNT(*) AS n')],
                'FROM'       => 'glpi_plugin_painelixc_chamados AS c',
                'INNER JOIN' => ['glpi_plugin_painelixc_bases AS b' => ['ON' => ['b' => 'id', 'c' => 'plugin_painelixc_bases_id']]],
                'WHERE'      => $this->where($f, $dim),
                'GROUPBY'    => ["c.$idCol", "c.$nomeCol"],
            ]);
            $porNome = [];   // chave normalizada => ['n' => total, 'nome' => nome exibido]
            $nulos = 0;
            foreach ($it as $r) {
                if ($r[$idCol] === null) {
                    $nulos += (int) $r['n'];
                    continue;
                }
                $bruto = ($r[$nomeCol] !== null && $r[$nomeCol] !== '') ? trim((string) $r[$nomeCol]) : '';
                $chave = $bruto !== '' ? self::normalizar($bruto) : 'id:' . (int) $r[$idCol];
                if (!isset($porNome[$chave])) {
                    $porNome[$chave] = ['n' => 0, 'nome' => $bruto !== '' ? $bruto : '#' . (int) $r[$idCol]];
                } elseif ($bruto !== '' && !preg_match('/\(\d+\)\s*$/', $bruto) && preg_match('/\(\d+\)\s*$/', $porNome[$chave]['nome'])) {
                    $porNome[$chave]['nome'] = $bruto;   // prefere o nome sem "(1)"
                }
                $porNome[$chave]['n'] += (int) $r['n'];
            }
            $lista = [];
            foreach ($porNome as $chave => $x) {
                $lista[] = ['valor' => $chave, 'nome' => $x['nome'], 'n' => $x['n']];
            }
            usort($lista, static fn($a, $b) => strcoll(mb_strtolower($a['nome']), mb_strtolower($b['nome'])));
            if ($nulos > 0) {
                $lista[] = ['valor' => 'id:0', 'nome' => $rotNulo, 'n' => $nulos];
            }
            $out[$dim] = $lista;
        }
        return $out;
    }

    /** Chave de mesclagem de um nome: minúsculas, sem acento, espaços colapsados, sem sufixo " (n)". */
    public static function normalizar(string $nome): string
    {
        $n = mb_strtolower(trim($nome));
        $n = preg_replace('/\s*\(\d+\)\s*$/u', '', $n) ?? $n;
        $n = preg_replace('/\s+/u', ' ', $n) ?? $n;
        $t = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $n);
        return trim(is_string($t) && $t !== '' ? $t : $n);
    }

    /** @var array<string,array<string,list<string>>> cache: coluna => chave => nomes brutos */
    private array $nomesBrutos = [];

    /** Nomes brutos gravados que caem na mesma chave normalizada. @param list<string> $chaves @return list<string> */
    private function expandirNomes(string $nomeCol, array $chaves): array
    {
        $col = preg_replace('/^c\./', '', $nomeCol);
        if (!isset($this->nomesBrutos[$col])) {
            $mapa = [];
            $it = $this->db->request(['SELECT' => $col, 'DISTINCT' => true, 'FROM' => 'glpi_plugin_painelixc_chamados', 'WHERE' => [['NOT' => [$col => null]]]]);
            foreach ($it as $r) {
                $v = (string) $r[$col];
                if ($v !== '') {
                    $mapa[self::normalizar($v)][] = $v;
                }
            }
            $this->nomesBrutos[$col] = $mapa;
        }
        $out = [];
        foreach ($chaves as $k) {
            foreach ($this->nomesBrutos[$col][self::normalizar($k)] ?? [$k] as $v) {
                $out[] = $v;
            }
        }
        return array_values(array_unique($out));
    }

    /** Condição de uma dimensão a partir dos valores (nomes normalizados, "id:N", "id:0"). @param list<string> $vals @return array<mixed>|null */
    private function condicao(string $idCol, string $nomeCol, array $vals): ?array
    {
        $nomes = [];
        $ids = [];
        $nulo = false;
        foreach ($vals as $v) {
            if (preg_match('/^id:(\d+)$/', $v, $m)) {
                if ((int) $m[1] === 0) {
                    $nulo = true;
                } else {
                    $ids[] = (int) $m[1];
                }
            } else {
                $nomes[] = $v;
            }
        }
        $or = [];
        if ($nomes) {
            $or[] = [$nomeCol => $this->expandirNomes($nomeCol, $nomes)];
        }
        if ($ids) {
            $or[] = [$idCol => $ids];
        }
        if ($nulo) {
            $or[] = [$idCol => null];
        }
        return $or ? ['OR' => $or] : null;
    }

    /** WHERE comum (período, modo, bases) + dimensões até $ateDim (null = todas). @param array<string,mixed> $f @return array<mixed> */
    private function where(array $f, ?string $ateDim = null): array
    {
        $dataCol = $f['modo'] === 'abertas' ? 'c.data_abertura' : 'c.data_fechamento';
        $where = [
            'b.is_active' => 1,
            [$dataCol => ['>=', $f['de'] . ' 00:00:00']],
            [$dataCol => ['<=', $f['ate'] . ' 23:59:59']],
        ];
        if ($f['modo'] === 'resolvidas') {
            $where['c.status'] = 'F';
        }
        if (!empty($f['bases'])) {
            $where['c.plugin_painelixc_bases_id'] = $f['bases'];
        }
        foreach (['assunto' => ['c.id_assunto', 'c.assunto'], 'diagnostico' => ['c.id_diagnostico', 'c.diagnostico'],
            'condominio' => ['c.id_condominio', 'c.condominio'], 'tecnico' => ['c.id_tecnico', 'c.tecnico']] as $dim => [$idc, $nc]) {
            if ($ateDim !== null && $dim === $ateDim) {
                break;   // hierarquia: só as dimensões à esquerda
            }
            $cond = !empty($f[$dim]) ? $this->condicao($idc, $nc, $f[$dim]) : null;
            if ($cond !== null) {
                $where[] = $cond;
            }
        }
        if (!empty($f['sem_diagnostico']) && ($ateDim === null || $ateDim === 'condominio' || $ateDim === 'tecnico')) {
            $where[] = ['c.id_diagnostico' => null];
        }
        return $where;
    }

    // ------------------------------------------------------------------ consulta

    /** @param array<string,mixed> $f @return list<array<string,mixed>> */
    public function linhas(array $f): array
    {
        $dataCol = $f['modo'] === 'abertas' ? 'c.data_abertura' : 'c.data_fechamento';
        $where = $this->where($f);
        $it = $this->db->request([
            'SELECT' => ['c.id', 'c.ixc_id', 'c.protocolo', 'c.status', 'c.id_assunto', 'c.assunto', 'c.id_diagnostico', 'c.diagnostico',
                'c.id_condominio', 'c.condominio', 'c.id_tecnico', 'c.tecnico', 'c.id_cliente', 'c.cliente', 'c.setor',
                'c.data_abertura', 'c.data_inicio', 'c.data_final', 'c.data_fechamento', 'c.mensagem', 'c.mensagem_resposta',
                'c.plugin_painelixc_bases_id', 'b.nome AS base_nome', 'b.codigo AS base', 'b.cor AS base_cor'],
            'FROM'   => 'glpi_plugin_painelixc_chamados AS c',
            'INNER JOIN' => ['glpi_plugin_painelixc_bases AS b' => ['ON' => ['b' => 'id', 'c' => 'plugin_painelixc_bases_id']]],
            'WHERE'  => $where,
            'ORDER'  => [$dataCol . ' DESC'],
            'LIMIT'  => self::LIMITE_LINHAS,
        ]);
        $rows = [];
        foreach ($it as $r) {
            $r['status_nome'] = Painel::STATUS[$r['status']] ?? $r['status'];
            $ab = $r['data_abertura'] ? strtotime($r['data_abertura']) : null;
            $fe = $r['data_fechamento'] ? strtotime($r['data_fechamento']) : ($r['data_final'] ? strtotime($r['data_final']) : null);
            $r['duracao_h'] = ($ab && $fe && $fe >= $ab) ? round(($fe - $ab) / 3600, 2) : null;
            $rows[] = $r;
        }
        return $rows;
    }

    /** @param array<string,mixed> $f @return array<string,mixed> */
    public function agregar(array $f): array
    {
        $rows = $this->linhas($f);
        $total = count($rows);

        $dims = [];
        foreach (self::DIMENSOES as $dim => [$idCol, $nomeCol]) {
            $acc = [];
            foreach ($rows as $r) {
                $id = $r[$idCol];
                $chave = ($id === null || $id === '' ) ? '0' : (string) $id;
                if (!isset($acc[$chave])) {
                    $nome = $r[$nomeCol];
                    if ($chave === '0') {
                        $nome = $dim === 'diagnostico' ? 'Sem diagnóstico' : ($dim === 'condominio' ? 'Sem condomínio' : ($dim === 'tecnico' ? 'Sem técnico' : 'Não informado'));
                    } elseif ($nome === null || $nome === '') {
                        $nome = '#' . $chave;
                    }
                    $acc[$chave] = ['id' => $chave === '0' ? null : (int) $chave, 'nome' => $nome, 'n' => 0, 'soma_h' => 0.0, 'com_h' => 0,
                        'cor' => $dim === 'base' ? ($r['base_cor'] ?? null) : null];
                }
                $acc[$chave]['n']++;
                if ($r['duracao_h'] !== null) {
                    $acc[$chave]['soma_h'] += $r['duracao_h'];
                    $acc[$chave]['com_h']++;
                }
            }
            $lista = array_values($acc);
            usort($lista, static fn($a, $b) => $b['n'] <=> $a['n'] ?: strcoll($a['nome'], $b['nome']));
            foreach ($lista as &$x) {
                $x['pct'] = $total ? round($x['n'] * 100 / $total, 1) : 0;
                $x['media_h'] = $x['com_h'] ? round($x['soma_h'] / $x['com_h'], 1) : null;
                unset($x['soma_h'], $x['com_h']);
            }
            unset($x);
            $dims[$dim] = ['rotulo' => self::DIMENSOES[$dim][2], 'itens' => $lista];
        }

        // série por dia
        $dataCol = $f['modo'] === 'abertas' ? 'data_abertura' : 'data_fechamento';
        $porDia = [];
        $d = new \DateTimeImmutable($f['de']);
        $fim = new \DateTimeImmutable($f['ate']);
        while ($d <= $fim) {
            $porDia[$d->format('Y-m-d')] = 0;
            $d = $d->modify('+1 day');
        }
        foreach ($rows as $r) {
            $k = substr((string) $r[$dataCol], 0, 10);
            if (isset($porDia[$k])) {
                $porDia[$k]++;
            }
        }

        $durs = array_values(array_filter(array_map(static fn($r) => $r['duracao_h'], $rows), static fn($v) => $v !== null));
        sort($durs);
        $mediana = $durs ? ($durs[intdiv(count($durs), 2)] + $durs[intdiv(count($durs) - 1, 2)]) / 2 : null;
        $comDiag = count(array_filter($rows, static fn($r) => $r['id_diagnostico'] !== null));
        $dias = max(1, (int) ((strtotime($f['ate']) - strtotime($f['de'])) / 86400) + 1);

        return [
            'ok'       => true,
            'filtros'  => $f,
            'modo_rotulo' => self::MODOS[$f['modo']],
            'gerado_em' => date('Y-m-d H:i:s'),
            'truncado' => $total >= self::LIMITE_LINHAS,
            'kpis'     => [
                'total'          => $total,
                'por_dia'        => round($total / $dias, 1),
                'media_h'        => $durs ? round(array_sum($durs) / count($durs), 1) : null,
                'mediana_h'      => $mediana !== null ? round($mediana, 1) : null,
                'com_diagnostico_pct' => $total ? round($comDiag * 100 / $total, 1) : 0,
                'condominios'    => count(array_filter($dims['condominio']['itens'], static fn($x) => $x['id'] !== null)),
                'colaboradores'  => count(array_filter($dims['tecnico']['itens'], static fn($x) => $x['id'] !== null)),
            ],
            'dimensoes' => $dims,
            'por_dia'   => array_map(static fn($k, $v) => ['dia' => $k, 'n' => $v], array_keys($porDia), $porDia),
            'amostra'   => array_slice(array_map(static fn($r) => [
                'base' => $r['base_nome'], 'ixc_id' => (int) $r['ixc_id'], 'status' => $r['status_nome'], 'assunto' => $r['assunto'],
                'diagnostico' => $r['diagnostico'], 'condominio' => $r['condominio'], 'tecnico' => $r['tecnico'], 'cliente' => $r['cliente'],
                'data_abertura' => $r['data_abertura'], 'data_fechamento' => $r['data_fechamento'], 'duracao_h' => $r['duracao_h'],
            ], $rows), 0, 150),
        ];
    }

    // ------------------------------------------------------------------ CSV

    /** @param array<string,mixed> $f */
    public function csv(array $f): string
    {
        $rows = $this->linhas($f);
        $out = fopen('php://temp', 'w+');
        fwrite($out, "\xEF\xBB\xBF");   // BOM: Excel abre em UTF-8
        $cab = ['Base', 'O.S.', 'Protocolo', 'Status', 'Assunto', 'Diagnóstico', 'Condomínio', 'Colaborador', 'Cliente', 'Setor',
            'Abertura', 'Início', 'Fim', 'Fechamento', 'Duração (h)', 'Mensagem', 'Resposta do técnico'];
        fputcsv($out, $cab, ';', '"', '\\');
        foreach ($rows as $r) {
            fputcsv($out, [
                $r['base_nome'], $r['ixc_id'], $r['protocolo'], $r['status_nome'], $r['assunto'] ?? ($r['id_assunto'] ? '#' . $r['id_assunto'] : ''),
                $r['diagnostico'] ?? ($r['id_diagnostico'] ? '#' . $r['id_diagnostico'] : ''), $r['condominio'] ?? ($r['id_condominio'] ? '#' . $r['id_condominio'] : ''),
                $r['tecnico'] ?? ($r['id_tecnico'] ? '#' . $r['id_tecnico'] : ''), $r['cliente'], $r['setor'],
                $r['data_abertura'], $r['data_inicio'], $r['data_final'], $r['data_fechamento'],
                $r['duracao_h'] !== null ? number_format($r['duracao_h'], 2, ',', '') : '',
                self::umaLinha($r['mensagem']), self::umaLinha($r['mensagem_resposta']),
            ], ';', '"', '\\');
        }
        rewind($out);
        return stream_get_contents($out) ?: '';
    }

    private static function umaLinha(?string $s): string
    {
        return $s === null ? '' : trim(preg_replace('/\s+/u', ' ', $s) ?? '');
    }

    /** Texto curto dos filtros para títulos de PDF/CSV. @param array<string,mixed> $f @param array<string,mixed> $op */
    public static function descreverFiltros(array $f, array $op): string
    {
        $nome = static function (string $dim, array $vals) use ($op): string {
            if (!$vals) {
                return '';
            }
            $m = [];
            foreach ($op[$dim] ?? [] as $o) {
                $m[(string) $o['valor']] = $o['nome'];
            }
            return implode(', ', array_map(static fn($v) => $m[(string) $v] ?? (string) $v, $vals));
        };
        $partes = [];
        foreach (['bases' => 'Bases', 'assunto' => 'Assunto', 'diagnostico' => 'Diagnóstico', 'condominio' => 'Condomínio', 'tecnico' => 'Colaborador'] as $k => $rot) {
            $t = $nome($k, $f[$k]);
            if ($t !== '') {
                $partes[] = "$rot: $t";
            }
        }
        if (!empty($f['sem_diagnostico'])) {
            $partes[] = 'Só sem diagnóstico';
        }
        return $partes ? implode(' · ', $partes) : 'Todas as bases, sem outros filtros';
    }
}
