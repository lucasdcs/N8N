<?php

namespace GlpiPlugin\Painelixc;

use TCPDF;

/**
 * PDF do relatório: capa com filtros e KPIs, gráficos (PNG gerados no navegador pelo ECharts)
 * e tabelas por dimensão. Usa o TCPDF que já vem com o GLPI.
 */
final class RelatorioPdf
{
    /**
     * @param array<string,mixed> $dados     saída de Relatorio::agregar()
     * @param array<string,string> $imagens  dimensao => data:image/png;base64,...
     */
    public static function gerar(array $dados, array $imagens, string $descricaoFiltros, string $usuario): string
    {
        $pdf = new TCPDF('P', 'mm', 'A4', true, 'UTF-8', false);
        $pdf->SetCreator('GLPI · plugin Painel IXC');
        $pdf->SetAuthor($usuario);
        $pdf->SetTitle('Relatório IXC ' . $dados['filtros']['de'] . ' a ' . $dados['filtros']['ate']);
        $pdf->setPrintHeader(false);
        $pdf->setPrintFooter(true);
        $pdf->setFooterFont(['helvetica', '', 8]);
        $pdf->setFooterMargin(10);
        $pdf->SetMargins(14, 14, 14);
        $pdf->SetAutoPageBreak(true, 16);
        $pdf->AddPage();

        $f = $dados['filtros'];
        $k = $dados['kpis'];
        $periodo = self::dia($f['de']) . ' a ' . self::dia($f['ate']);

        // ---- título
        $pdf->SetFont('helvetica', 'B', 18);
        $pdf->SetTextColor(29, 39, 59);
        $pdf->Cell(0, 9, 'Relatório de Chamados IXC', 0, 1);
        $pdf->SetFont('helvetica', '', 10);
        $pdf->SetTextColor(97, 104, 118);
        $pdf->MultiCell(0, 5, $dados['modo_rotulo'] . ' · Período: ' . $periodo, 0, 'L');
        $pdf->MultiCell(0, 5, 'Filtros: ' . $descricaoFiltros, 0, 'L');
        $pdf->MultiCell(0, 5, 'Gerado em ' . self::dataHora($dados['gerado_em']) . ' por ' . $usuario, 0, 'L');
        $pdf->Ln(3);

        // ---- KPIs
        $tiles = [
            ['O.S. no período', (string) $k['total']],
            ['Média por dia', self::num($k['por_dia'])],
            ['Duração média', $k['media_h'] !== null ? self::horas($k['media_h']) : '—'],
            ['Duração mediana', $k['mediana_h'] !== null ? self::horas($k['mediana_h']) : '—'],
            ['Com diagnóstico', self::num($k['com_diagnostico_pct']) . '%'],
            ['Condomínios', (string) $k['condominios']],
            ['Colaboradores', (string) $k['colaboradores']],
        ];
        $w = (210 - 28) / count($tiles);
        $y = $pdf->GetY();
        foreach ($tiles as $i => [$rot, $val]) {
            $x = 14 + $i * $w;
            $pdf->SetFillColor(245, 247, 251);
            $pdf->SetDrawColor(230, 231, 233);
            $pdf->Rect($x, $y, $w - 2, 18, 'DF');
            $pdf->SetXY($x, $y + 2);
            $pdf->SetFont('helvetica', 'B', 13);
            $pdf->SetTextColor(29, 39, 59);
            $pdf->Cell($w - 2, 7, $val, 0, 0, 'C');
            $pdf->SetXY($x, $y + 9.5);
            $pdf->SetFont('helvetica', '', 7);
            $pdf->SetTextColor(97, 104, 118);
            $pdf->MultiCell($w - 2, 3.5, $rot, 0, 'C');
        }
        $pdf->SetY($y + 22);

        // ---- gráficos (2 por linha)
        $ordem = ['por_dia', 'assunto', 'diagnostico', 'condominio', 'tecnico', 'base', 'status'];
        $titulos = ['por_dia' => 'O.S. por dia', 'assunto' => 'Por assunto', 'diagnostico' => 'Por diagnóstico',
            'condominio' => 'Por condomínio (top 12)', 'tecnico' => 'Por colaborador', 'base' => 'Por base', 'status' => 'Por status'];
        $col = 0;
        $larg = (210 - 28 - 6) / 2;
        $alt = $larg * 0.62;
        foreach ($ordem as $chave) {
            if (empty($imagens[$chave])) {
                continue;
            }
            $bin = self::png($imagens[$chave]);
            if ($bin === null) {
                continue;
            }
            if ($col === 0 && $pdf->GetY() + $alt + 10 > 297 - 16) {
                $pdf->AddPage();
            }
            $x = 14 + $col * ($larg + 6);
            $y = $pdf->GetY();
            $pdf->SetFont('helvetica', 'B', 10);
            $pdf->SetTextColor(29, 39, 59);
            $pdf->SetXY($x, $y);
            $pdf->Cell($larg, 6, $titulos[$chave] ?? $chave, 0, 0);
            $pdf->Image('@' . $bin, $x, $y + 6, $larg, $alt, 'PNG', '', '', true, 300, '', false, false, 0, 'CM');
            if ($col === 1) {
                $pdf->SetY($y + $alt + 10);
            }
            $col = 1 - $col;
        }
        if ($col === 1) {
            $pdf->SetY($pdf->GetY() + $alt + 10);
        }

        // ---- tabelas por dimensão
        foreach (['assunto', 'diagnostico', 'condominio', 'tecnico', 'base'] as $dim) {
            $d = $dados['dimensoes'][$dim];
            $itens = array_slice($d['itens'], 0, 25);
            if (!$itens) {
                continue;
            }
            if ($pdf->GetY() + 8 * (min(count($itens), 6) + 2) > 297 - 16) {
                $pdf->AddPage();
            }
            $pdf->Ln(2);
            $pdf->SetFont('helvetica', 'B', 11);
            $pdf->SetTextColor(29, 39, 59);
            $pdf->Cell(0, 7, $d['rotulo'] . (count($d['itens']) > 25 ? ' (25 primeiros de ' . count($d['itens']) . ')' : ''), 0, 1);
            $pdf->SetFont('helvetica', 'B', 8);
            $pdf->SetFillColor(248, 250, 252);
            $pdf->SetTextColor(97, 104, 118);
            $pdf->Cell(110, 6, $d['rotulo'], 1, 0, 'L', true);
            $pdf->Cell(22, 6, 'O.S.', 1, 0, 'R', true);
            $pdf->Cell(22, 6, '%', 1, 0, 'R', true);
            $pdf->Cell(28, 6, 'Duração média', 1, 1, 'R', true);
            $pdf->SetFont('helvetica', '', 8);
            $pdf->SetTextColor(29, 39, 59);
            foreach ($itens as $it) {
                $pdf->Cell(110, 5.5, self::corta($it['nome'], 70), 1, 0, 'L');
                $pdf->Cell(22, 5.5, (string) $it['n'], 1, 0, 'R');
                $pdf->Cell(22, 5.5, self::num($it['pct']) . '%', 1, 0, 'R');
                $pdf->Cell(28, 5.5, $it['media_h'] !== null ? self::horas($it['media_h']) : '—', 1, 1, 'R');
            }
        }

        if (!empty($dados['truncado'])) {
            $pdf->Ln(3);
            $pdf->SetFont('helvetica', 'I', 8);
            $pdf->SetTextColor(180, 35, 24);
            $pdf->MultiCell(0, 4, 'Atenção: o período tem mais O.S. do que o limite do relatório (' . Relatorio::LIMITE_LINHAS . '). Reduza o período.', 0, 'L');
        }

        return $pdf->Output('', 'S');
    }

    private static function png(string $dataUrl): ?string
    {
        if (!preg_match('#^data:image/png;base64,([A-Za-z0-9+/=\s]+)$#', $dataUrl, $m)) {
            return null;
        }
        $bin = base64_decode($m[1], true);
        if ($bin === false || strlen($bin) < 100 || strlen($bin) > 4_000_000 || !str_starts_with($bin, "\x89PNG")) {
            return null;
        }
        return $bin;
    }

    private static function dia(string $d): string
    {
        return substr($d, 8, 2) . '/' . substr($d, 5, 2) . '/' . substr($d, 0, 4);
    }

    private static function dataHora(string $d): string
    {
        return self::dia(substr($d, 0, 10)) . ' ' . substr($d, 11, 5);
    }

    private static function num(float|int|null $v): string
    {
        return $v === null ? '—' : number_format((float) $v, (float) $v == (int) $v ? 0 : 1, ',', '.');
    }

    private static function horas(float $h): string
    {
        if ($h < 48) {
            return self::num(round($h, 1)) . ' h';
        }
        return self::num(round($h / 24, 1)) . ' d';
    }

    private static function corta(string $s, int $n): string
    {
        return mb_strlen($s) > $n ? mb_substr($s, 0, $n - 1) . '…' : $s;
    }
}
