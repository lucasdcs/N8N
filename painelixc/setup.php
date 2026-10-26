<?php

/**
 * Painel de Chamados IXC — plugin GLPI 11
 * Consolida as O.S. das bases IXC coletadas pelo n8n.
 * Teckcomp / Resolutto
 */

use Glpi\Http\Firewall;
use Glpi\Http\SessionManager;
use Glpi\Plugin\Hooks;
use GlpiPlugin\Painelixc\Config;
use GlpiPlugin\Painelixc\Menu;
use GlpiPlugin\Painelixc\Profile;

define('PLUGIN_PAINELIXC_VERSION', '0.14.0');
define('PLUGIN_PAINELIXC_ASSETS', '0.14.0.1');   // carimbo do JS/CSS (cache do navegador); muda a cada entrega de tela
define('PLUGIN_PAINELIXC_MIN_GLPI', '11.0.0');
define('PLUGIN_PAINELIXC_MAX_GLPI', '11.0.99');
define('PLUGIN_PAINELIXC_RIGHT', 'plugin_painelixc');

function plugin_init_painelixc(): void
{
    /** @var array $PLUGIN_HOOKS */
    global $PLUGIN_HOOKS;

    $PLUGIN_HOOKS[Hooks::CSRF_COMPLIANT]['painelixc'] = true;

    // Entrada do n8n: sem sessão (stateless) e sem checagem de login — a autenticação é o token Bearer
    SessionManager::registerPluginStatelessPath('painelixc', '#^/front/ingest\.php$#');
    Firewall::addPluginStrategyForLegacyScripts('painelixc', '#^/front/ingest\.php$#', Firewall::STRATEGY_NO_CHECK);

    Plugin::registerClass(Profile::class, ['addtabon' => ['Profile']]);
    Plugin::registerClass(Config::class, ['addtabon' => ['Config']]);

    if (Session::getLoginUserID()) {
        \GlpiPlugin\Painelixc\Direito::sincronizarSessao();   // 0.13.2: usuários já logados na atualização
    }
    if (Session::getLoginUserID() && \GlpiPlugin\Painelixc\Direito::algumaLeitura()) {
        $PLUGIN_HOOKS[Hooks::MENU_TOADD]['painelixc'] = ['helpdesk' => Menu::class];
    }
    if (Session::haveRight(PLUGIN_PAINELIXC_RIGHT, UPDATE)) {
        $PLUGIN_HOOKS[Hooks::CONFIG_PAGE]['painelixc'] = 'front/config.form.php';
    }
}

function plugin_version_painelixc(): array
{
    return [
        'name'         => 'Painel IXC',
        'version'      => PLUGIN_PAINELIXC_VERSION,
        'author'       => 'Teckcomp',
        'license'      => 'GPLv3+',
        'homepage'     => 'https://teckcomp.com.br',
        'requirements' => [
            'glpi' => [
                'min' => PLUGIN_PAINELIXC_MIN_GLPI,
                'max' => PLUGIN_PAINELIXC_MAX_GLPI,
            ],
            'php' => ['min' => '8.2'],
        ],
    ];
}

function plugin_painelixc_check_prerequisites(): bool
{
    return true;
}

function plugin_painelixc_check_config(bool $verbose = false): bool
{
    return true;
}
