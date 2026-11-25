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
        // 0.5.0: operação (vistos do servidor do GLPI). Chaves cifradas (GLPIKey); nunca vão para a tela.
        'n8n_url'          => '',
        'n8n_chave'        => '',
        'n8n_controlaveis' => '',   // ids extras de workflows que o painel pode pausar (além dos 4 do bot), separados por vírgula
        'waha_url'         => '',
        'waha_chave'       => '',
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
        $temN8n = (string) ($cfg['n8n_chave'] ?? '') !== '';
        $temWaha = (string) ($cfg['waha_chave'] ?? '') !== '';
        unset($cfg['pg_senha'], $cfg['n8n_chave'], $cfg['waha_chave']);   // senha e chaves nunca vão para a tela

        $bot = new Bot();
        $teste = $bot->conexao()['pronta'] ? $bot->testar() : ['ok' => false, 'msg' => 'Preencha os campos e a senha para conectar.'];

        TemplateRenderer::getInstance()->display('@painelbot/config.html.twig', [
            'cfg'         => $cfg,
            'tem_senha'   => $temSenha,
            'tem_n8n'     => $temN8n,
            'tem_waha'    => $temWaha,
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
        $cifrar ??= fn(string $s) => (new \GLPIKey())->encrypt($s);
        foreach (['pg_senha' => 'pg_apagar_senha', 'n8n_chave' => 'n8n_apagar_chave', 'waha_chave' => 'waha_apagar_chave'] as $k => $apagar) {
            $segredo = (string) ($post[$k] ?? '');
            if (!empty($post[$apagar])) {
                $v[$k] = '';
            } elseif ($segredo !== '') {
                $v[$k] = $cifrar($k === 'pg_senha' ? $segredo : trim($segredo));   // senha do banco como digitada
            }
        }
        // 0.5.0: endereços do n8n e do WAHA vistos do servidor do GLPI (vazio = desliga a parte de operação daquele serviço)
        foreach (['n8n_url', 'waha_url'] as $k) {
            if (!array_key_exists($k, $post)) {
                continue;
            }
            $u = rtrim(trim((string) $post[$k]), '/');
            $v[$k] = $u === '' || (preg_match('#^https?://[A-Za-z0-9._\-\[\]:]{1,120}(/[A-Za-z0-9._~/-]*)?$#', $u) && strlen($u) <= 200) ? $u : (string) ($atual[$k] ?? '');
        }
        if (array_key_exists('n8n_controlaveis', $post)) {
            $ids = array_filter(array_map('trim', explode(',', (string) $post['n8n_controlaveis'])), fn($x) => preg_match('/^[A-Za-z0-9_-]{1,40}$/', $x));
            $v['n8n_controlaveis'] = implode(',', array_values(array_unique($ids)));
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
