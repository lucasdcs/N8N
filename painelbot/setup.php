<?php

/**
 * Painel do Bot — plugin GLPI 11
 * Gerencia o bot de WhatsApp da automação whatsapp-ixc (n8n + WAHA): funcionalidades, escala,
 * técnicos, contatos de setor, mensagens e perguntas. Os dados ficam no Postgres do bot (schema ixc).
 * SCDell / Resolutto
 */

use Glpi\Plugin\Hooks;
use GlpiPlugin\Painelbot\Config;
use GlpiPlugin\Painelbot\Direito;
use GlpiPlugin\Painelbot\Menu;
use GlpiPlugin\Painelbot\Profile;

define('PLUGIN_PAINELBOT_VERSION', '0.1.0');
define('PLUGIN_PAINELBOT_ASSETS', '0.1.0');   // carimbo do JS/CSS (cache do navegador); muda a cada entrega de tela
define('PLUGIN_PAINELBOT_MIN_GLPI', '11.0.0');
define('PLUGIN_PAINELBOT_MAX_GLPI', '11.0.99');

function plugin_init_painelbot(): void
{
    /** @var array $PLUGIN_HOOKS */
    global $PLUGIN_HOOKS;

    $PLUGIN_HOOKS[Hooks::CSRF_COMPLIANT]['painelbot'] = true;

    Plugin::registerClass(Profile::class, ['addtabon' => ['Profile']]);
    Plugin::registerClass(Config::class, ['addtabon' => ['Config']]);

    if (Session::getLoginUserID()) {
        Direito::sincronizarSessao();   // usuários já logados quando o plugin foi instalado/atualizado
        if (Direito::algumaLeitura()) {
            $PLUGIN_HOOKS[Hooks::MENU_TOADD]['painelbot'] = ['admin' => Menu::class];   // menu Administração (pedido de 23/11)
        }
        if (Direito::pode(Direito::CONFIG, UPDATE)) {
            $PLUGIN_HOOKS[Hooks::CONFIG_PAGE]['painelbot'] = 'front/config.form.php';
        }
    }
}

function plugin_version_painelbot(): array
{
    return [
        'name'         => 'Painel do Bot',
        'version'      => PLUGIN_PAINELBOT_VERSION,
        'author'       => 'SCDell',
        'license'      => 'GPLv3+',
        'homepage'     => 'https://github.com/lucasdcs/N8N',
        'requirements' => [
            'glpi' => [
                'min' => PLUGIN_PAINELBOT_MIN_GLPI,
                'max' => PLUGIN_PAINELBOT_MAX_GLPI,
            ],
            'php' => ['min' => '8.2'],
        ],
    ];
}

function plugin_painelbot_check_prerequisites(): bool
{
    return true;
}

function plugin_painelbot_check_config(bool $verbose = false): bool
{
    return true;
}
