<?php

use Glpi\Application\View\TemplateRenderer;
use GlpiPlugin\Painelixc\Config;
use GlpiPlugin\Painelixc\Direito;
use GlpiPlugin\Painelixc\Menu;

Direito::exigirTela(Direito::OS);

$dir = 'plugins/painelixc';
Html::header(Menu::getTypeName(), "/$dir/front/painel.php", 'helpdesk', Menu::class);

TemplateRenderer::getInstance()->display('@painelixc/painel.html.twig', [
    'nav' => Direito::navComum() + [
        'url_dados'      => "/$dir/front/dados.php",
        'pode_atualizar' => Config::podeAtualizar(),
        'historico_dias' => (int) Config::get('historico_dias'),
    ],
]);

Html::footer();
