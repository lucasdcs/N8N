<?php

use Glpi\Application\View\TemplateRenderer;
use GlpiPlugin\Painelixc\Direito;
use GlpiPlugin\Painelixc\Menu;
use GlpiPlugin\Painelixc\Relatorio;

Direito::exigirTela(Direito::RELATORIO);

$dir = 'plugins/painelixc';
Html::requireJs('charts');   // ECharts do próprio GLPI
Html::header('Relatório · ' . Menu::getTypeName(), "/$dir/front/relatorio.php", 'helpdesk', Menu::class, 'relatorio');

TemplateRenderer::getInstance()->display('@painelixc/relatorio.html.twig', [
    'nav' => Direito::navComum() + [
        'url_dados'  => "/$dir/front/relatorio_dados.php",
        'pode_atualizar' => false,
        'url_csv'    => "/$dir/front/relatorio_csv.php",
        'url_pdf'    => "/$dir/front/relatorio_pdf.php",
        'modos'      => Relatorio::MODOS,
        'hoje'       => date('Y-m-d'),
        'inicio'     => date('Y-m-d', strtotime('-30 days')),
    ],
]);

Html::footer();
