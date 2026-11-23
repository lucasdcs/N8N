<?php

use Glpi\Application\View\TemplateRenderer;
use GlpiPlugin\Painelbot\Bot;
use GlpiPlugin\Painelbot\Direito;
use GlpiPlugin\Painelbot\Menu;
use GlpiPlugin\Painelbot\Preferencia;

Direito::exigirAlguma();

$dir = '/plugins/painelbot';
Html::header(Menu::getTypeName(), "$dir/front/painel.php", 'admin', Menu::class);

TemplateRenderer::getInstance()->display('@painelbot/painel.html.twig', [
    'nav' => [
        'url_assets'  => $dir,
        'url_dados'   => "$dir/front/dados.php",
        'url_tema'    => "$dir/front/tema.php",
        'url_config'  => '/front/config.form.php?forcetab=' . urlencode(\GlpiPlugin\Painelbot\Config::class . '$1'),
        'versao'      => PLUGIN_PAINELBOT_VERSION,
        'assets'      => PLUGIN_PAINELBOT_ASSETS,
        'tema'        => Preferencia::tema(),
        'direitos'    => Direito::nav(),
        'secoes'      => Direito::secoes(),
        'pode_config' => Direito::ler(Direito::CONFIG),
        'conexao'     => (new Bot())->conexao(),
    ],
]);

Html::footer();
