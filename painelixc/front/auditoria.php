<?php

use Glpi\Application\View\TemplateRenderer;
use GlpiPlugin\Painelixc\Direito;
use GlpiPlugin\Painelixc\Menu;

Direito::exigirTela(Direito::AUDITORIA);

$dir = 'plugins/painelixc';
Html::header('Auditoria de Ativação · ' . Menu::getTypeName(), "/$dir/front/auditoria.php", 'helpdesk', Menu::class, 'auditoria');

TemplateRenderer::getInstance()->display('@painelixc/auditoria.html.twig', [
    'nav' => Direito::navComum() + [
        'url_dados'      => "/$dir/front/auditoria_dados.php",
        'url_acao'       => "/$dir/front/auditoria_acao.php",
        'pode_atualizar' => true,   // recarregar a lista é de quem lê (como na 0.11.1); Aprovar/Reprovar = Auditoria → Atualizar
    ],
]);

Html::footer();
