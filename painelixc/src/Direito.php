<?php

namespace GlpiPlugin\Painelixc;

use Session;

/**
 * 0.12.0 — direitos por categoria (aba "Painel IXC" no perfil).
 *
 * Cada categoria tem Ler / Atualizar / Criar / Deletar:
 *   Ler       ver a tela, buscar, filtrar e exportar (CSV/PDF)
 *   Atualizar O.S. e Atendimento: botão "Atualizar agora"; Auditoria: botões Aprovar/Reprovar
 *   Criar     salvar filtros (novo ou alterando um seu) e marcar o padrão (0.13.2);
 *             na Auditoria, adicionar botões de auditoria (Configuração)
 *   Deletar   excluir filtro salvo; na Auditoria, apagar botões de auditoria (Configuração)
 *
 * O direito antigo PLUGIN_PAINELIXC_RIGHT continua existindo só para a Configuração (UPDATE).
 */
final class Direito
{
    public const ATENDIMENTO = 'plugin_painelixc_atendimento';
    public const OS          = 'plugin_painelixc_os';
    public const AUDITORIA   = 'plugin_painelixc_auditoria';
    public const RELATORIO   = 'plugin_painelixc_relatorio';
    public const CLIENTES    = 'plugin_painelixc_clientes';   // 0.13.0

    /** Todos os direitos de categoria, na ordem da matriz. */
    public const CATEGORIAS = [
        self::ATENDIMENTO => 'Atendimento',
        self::OS          => 'Ordem de Serviço',
        self::AUDITORIA   => 'Auditoria',
        self::CLIENTES    => 'Clientes',
        self::RELATORIO   => 'Relatório',
    ];

    /** Chave curta usada no Twig/JS → direito. */
    public const CURTO = [
        'atd' => self::ATENDIMENTO,
        'os'  => self::OS,
        'aud' => self::AUDITORIA,
        'cli' => self::CLIENTES,
        'rel' => self::RELATORIO,
    ];

    /** Tela dos filtros salvos (Filtro::TELAS) → direito. */
    public const TELA = [
        'atendimento' => self::ATENDIMENTO,
        'painel'      => self::OS,
        'relatorio'   => self::RELATORIO,
        'clientes'    => self::CLIENTES,
    ];

    /** Página de cada categoria (relativa a /plugins/painelixc). */
    public const PAGINA = [
        self::OS          => '/front/painel.php',
        self::ATENDIMENTO => '/front/atendimento.php',
        self::AUDITORIA   => '/front/auditoria.php',
        self::CLIENTES    => '/front/clientes.php',
        self::RELATORIO   => '/front/relatorio.php',
    ];

    public const TUDO = READ | UPDATE | CREATE | DELETE;   // 15

    /**
     * 0.13.2 — quem já estava logado quando o plugin foi atualizado não tem os direitos por categoria na sessão
     * (o GLPI só carrega no login/troca de perfil). Aqui eles são lidos do perfil ativo uma vez, sem precisar de novo login.
     */
    public static function sincronizarSessao(): void
    {
        /** @var \DBmysql $DB */
        global $DB;
        $perfil = (int) ($_SESSION['glpiactiveprofile']['id'] ?? 0);
        if ($perfil <= 0) {
            return;
        }
        $faltam = array_values(array_filter(array_keys(self::CATEGORIAS), fn($n) => !array_key_exists($n, $_SESSION['glpiactiveprofile'])));
        if ($faltam === []) {
            return;
        }
        try {
            foreach ($faltam as $n) {
                $_SESSION['glpiactiveprofile'][$n] = 0;
            }
            foreach ($DB->request(['SELECT' => ['name', 'rights'], 'FROM' => 'glpi_profilerights',
                'WHERE' => ['profiles_id' => $perfil, 'name' => $faltam]]) as $r) {
                $_SESSION['glpiactiveprofile'][(string) $r['name']] = (int) $r['rights'];
            }
        } catch (\Throwable $e) {
            // sem banco ainda (instalação): fica sem os direitos até o próximo login
        }
    }

    public static function pode(string $direito, int $bit): bool
    {
        return (bool) Session::haveRight($direito, $bit);
    }

    public static function ler(string $direito): bool
    {
        return self::pode($direito, READ);
    }

    /** Vê pelo menos uma tela do painel (menu e entrada). */
    public static function algumaLeitura(): bool
    {
        foreach (array_keys(self::CATEGORIAS) as $d) {
            if (self::ler($d)) {
                return true;
            }
        }
        return false;
    }

    /** URL da primeira tela que o perfil pode ver (O.S. → Atendimento → Auditoria → Clientes → Relatório), ou null. */
    public static function primeiraPagina(): ?string
    {
        foreach (self::PAGINA as $d => $p) {
            if (self::ler($d)) {
                return '/plugins/painelixc' . $p;
            }
        }
        return null;
    }

    /** @return array{ler:bool, atualizar:bool, criar:bool, deletar:bool} */
    public static function mapa(string $direito): array
    {
        return [
            'ler'       => self::pode($direito, READ),
            'atualizar' => self::pode($direito, UPDATE),
            'criar'     => self::pode($direito, CREATE),
            'deletar'   => self::pode($direito, DELETE),
        ];
    }

    /** Tudo o que as telas precisam saber, numa variável só (Twig strict). @return array<string, array<string,bool>> */
    public static function nav(): array
    {
        $out = [];
        foreach (self::CURTO as $k => $d) {
            $out[$k] = self::mapa($d);
        }
        return $out;
    }

    /**
     * Exige o direito ou encerra: sem o direito mas com outra tela liberada, manda para ela; sem nenhuma, o "acesso negado" do GLPI.
     */
    public static function exigirTela(string $direito): void
    {
        if (self::ler($direito)) {
            return;
        }
        $outra = self::primeiraPagina();
        if ($outra !== null) {
            \Html::redirect($outra);
        }
        Session::checkRight($direito, READ);   // mostra o acesso negado padrão
    }

    /**
     * Valor de cada direito novo para um perfil, a partir do que ele tinha na 0.11 (migração da instalação).
     * @param int $antigo        direito plugin_painelixc do perfil (READ=ver painel, UPDATE=configuração)
     * @param bool $botaoAtualizar perfil podia ver o botão Atualizar das O.S. (lista vazia = todos)
     * @param bool $agir          perfil estava na lista "Ações de auditoria"
     * @return array<string,int>
     */
    public static function migrarPerfil(int $antigo, bool $botaoAtualizar, bool $agir): array
    {
        $le  = ($antigo & READ) === READ;
        $cfg = ($antigo & UPDATE) === UPDATE;
        // 0.13.0: Clientes (dados cadastrais) nasce só para quem tem a Configuração
        $cli = $cfg ? self::TUDO : 0;
        if (!$le) {
            return [self::ATENDIMENTO => 0, self::OS => 0, self::AUDITORIA => 0, self::CLIENTES => $cli, self::RELATORIO => 0];
        }
        return [
            self::ATENDIMENTO => self::TUDO,
            self::OS          => READ | CREATE | DELETE | ($botaoAtualizar ? UPDATE : 0),
            self::AUDITORIA   => READ | ($agir ? UPDATE : 0) | ($cfg ? CREATE | DELETE : 0),
            self::CLIENTES    => $cli,
            self::RELATORIO   => self::TUDO,
        ];
    }

    /**
     * Chaves comuns do "nav" das telas (abas, Relatório, engrenagem, tema e direitos). Cada front/*.php junta com as suas.
     * @return array<string,mixed>
     */
    public static function navComum(): array
    {
        $dir = '/plugins/painelixc';
        return [
            'url_painel'      => "$dir/front/painel.php",
            'url_atendimento' => "$dir/front/atendimento.php",
            'url_auditoria'   => "$dir/front/auditoria.php",
            'url_relatorio'   => "$dir/front/relatorio.php",
            'url_clientes'    => "$dir/front/clientes.php",
            'url_filtros'     => "$dir/front/filtros.php",
            'url_tema'        => "$dir/front/tema.php",
            'url_assets'      => $dir,
            'versao'          => PLUGIN_PAINELIXC_VERSION,
            'assets'          => PLUGIN_PAINELIXC_ASSETS,
            'pode_config'     => self::pode(PLUGIN_PAINELIXC_RIGHT, UPDATE),
            'url_config'      => '/front/config.form.php?forcetab=' . urlencode(Config::class . '$1'),
            'direitos'        => self::nav(),
            'tema'            => Preferencia::tema(),
        ];
    }
}
