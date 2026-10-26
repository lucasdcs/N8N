<?php

use Glpi\Application\View\TemplateRenderer;
use GlpiPlugin\Painelixc\Cliente;
use GlpiPlugin\Painelixc\Direito;
use GlpiPlugin\Painelixc\Menu;

/** @var \DBmysql $DB */
global $DB;

Direito::exigirTela(Direito::CLIENTES);

$dir = 'plugins/painelixc';
Html::header('Clientes · ' . Menu::getTypeName(), "/$dir/front/clientes.php", 'helpdesk', Menu::class, 'clientes');

TemplateRenderer::getInstance()->display('@painelixc/clientes.html.twig', [
    'nav' => Direito::navComum() + [
        'url_dados'      => "/$dir/front/clientes_dados.php",
        'pode_atualizar' => false,   // a busca é ao vivo no IXC: não há "Atualizar agora"
        'bases'          => (new Cliente($DB))->bases(),
        'por_pagina'     => Cliente::POR_PAGINA,
        'tamanhos'       => Cliente::TAMANHOS,
        'limite_csv'     => Cliente::LIMITE_CSV,
    ],
]);

Html::footer();
