<?php

namespace GlpiPlugin\Painelbot;

use CommonDBTM;
use CommonGLPI;
use Config as GlpiConfig;
use Glpi\Application\View\TemplateRenderer;
use Session;

/**
 * Configuração do plugin (glpi_configs, contexto plugin:painelbot): conexão com o Postgres do bot.
 * Aba em Configurar > Geral > Painel do Bot. Ver: "Parâmetros e conexão" Visualizar; salvar: Editar.
 */
final class Config extends CommonDBTM
{
    public const CONTEXTO = 'plugin:painelbot';
    public static $rightname = Direito::CONFIG;

    public const PADROES = [
        'pg_host'    => '127.0.0.1',
        'pg_porta'   => 5433,
        'pg_banco'   => 'ixc',
        'pg_usuario' => 'painel_glpi',
        'pg_senha'   => '',   // cifrada (GLPIKey); nunca vai para a tela
        'migracao'   => '',   // 0.4.0: última migração de direitos aplicada (ver Install::migrar)
    ];

    /** @return array<string,mixed> */
    public static function todos(): array
    {
        return GlpiConfig::getConfigurationValues(self::CONTEXTO) + self::PADROES;
    }

    public static function garantirPadroes(): void
    {
        $atual = GlpiConfig::getConfigurationValues(self::CONTEXTO);
        $novos = array_diff_key(self::PADROES, $atual);
        if ($novos) {
            GlpiConfig::setConfigurationValues(self::CONTEXTO, $novos);
        }
    }

    public static function apagarTudo(): void
    {
        GlpiConfig::deleteConfigurationValues(self::CONTEXTO, array_keys(self::PADROES));
    }

    public static function getTypeName($nb = 0)
    {
        return 'Painel do Bot';
    }

    public function getTabNameForItem(CommonGLPI $item, $withtemplate = 0)
    {
        if ($item instanceof GlpiConfig && Direito::ler(Direito::CONFIG)) {
            return self::createTabEntry(self::getTypeName(), 0, $item::getType(), Menu::getIcon());
        }
        return '';
    }

    public static function displayTabContentForItem(CommonGLPI $item, $tabnum = 1, $withtemplate = 0)
    {
        if ($item instanceof GlpiConfig && Direito::ler(Direito::CONFIG)) {
            self::mostrarFormulario();
        }
        return true;
    }

    public static function mostrarFormulario(): void
    {
        $cfg = self::todos();
        $temSenha = (string) ($cfg['pg_senha'] ?? '') !== '';
        unset($cfg['pg_senha']);   // a senha nunca vai para a tela

        $bot = new Bot();
        $teste = $bot->conexao()['pronta'] ? $bot->testar() : ['ok' => false, 'msg' => 'Preencha os campos e a senha para conectar.'];

        TemplateRenderer::getInstance()->display('@painelbot/config.html.twig', [
            'cfg'         => $cfg,
            'tem_senha'   => $temSenha,
            'teste'       => $teste,
            'pode_editar' => Direito::pode(Direito::CONFIG, UPDATE),
            'action'      => '/plugins/painelbot/front/config.form.php',
            'url_painel'  => '/plugins/painelbot/front/painel.php',
            'url_perfis'  => '/front/profile.php',
        ]);
    }

    /**
     * Valida o POST do formulário (CSRF já validado pelo core) e devolve só os valores a gravar.
     * Campo inválido mantém o valor atual; senha vazia mantém a atual; "apagar" remove.
     * @param array<string,mixed> $post @param array<string,mixed> $atual @return array<string,mixed>
     */
    public static function valoresDoPost(array $post, array $atual, ?callable $cifrar = null): array
    {
        $v = [];
        $host = trim((string) ($post['pg_host'] ?? ''));
        $v['pg_host'] = preg_match('/^[A-Za-z0-9._-]{1,120}$/', $host) ? $host : (string) ($atual['pg_host'] ?? self::PADROES['pg_host']);
        $porta = (int) ($post['pg_porta'] ?? 0);
        $v['pg_porta'] = $porta >= 1 && $porta <= 65535 ? $porta : (int) ($atual['pg_porta'] ?? self::PADROES['pg_porta']);
        foreach (['pg_banco', 'pg_usuario'] as $k) {
            $x = trim((string) ($post[$k] ?? ''));
            $v[$k] = preg_match('/^[A-Za-z0-9_]{1,63}$/', $x) ? $x : (string) ($atual[$k] ?? self::PADROES[$k]);
        }
        $senha = (string) ($post['pg_senha'] ?? '');
        if (!empty($post['pg_apagar_senha'])) {
            $v['pg_senha'] = '';
        } elseif ($senha !== '') {
            $cifrar ??= fn(string $s) => (new \GLPIKey())->encrypt($s);
            $v['pg_senha'] = $cifrar($senha);
        }
        return $v;
    }

    /** @param array<string,mixed> $post */
    public static function salvar(array $post): void
    {
        Session::checkRight(Direito::CONFIG, UPDATE);
        GlpiConfig::setConfigurationValues(self::CONTEXTO, self::valoresDoPost($post, self::todos()));
        Session::addMessageAfterRedirect('Conexão do Painel do Bot salva.', false, INFO);
    }
}
