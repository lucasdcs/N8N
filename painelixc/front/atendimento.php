<?php

use Glpi\Application\View\TemplateRenderer;
use GlpiPlugin\Painelixc\Config;
use GlpiPlugin\Painelixc\Direito;
use GlpiPlugin\Painelixc\Menu;

Direito::exigirTela(Direito::ATENDIMENTO);

$dir = 'plugins/painelixc';
Html::header('Atendimentos · ' . Menu::getTypeName(), "/$dir/front/atendimento.php", 'helpdesk', Menu::class, 'atendimento');

TemplateRenderer::getInstance()->display('@painelixc/atendimento.html.twig', [
    'nav' => Direito::navComum() + [
        'url_dados'      => "/$dir/front/atendimento_dados.php",
        'url_detalhe'    => "/$dir/front/atendimento_detalhe.php",
        'pode_atualizar' => Direito::pode(Direito::ATENDIMENTO, UPDATE),
        'historico_dias' => (int) Config::get('historico_dias'),
    ],
]);

Html::footer();
