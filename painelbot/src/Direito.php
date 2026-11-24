<?php

namespace GlpiPlugin\Painelbot;

use Session;

/**
 * Direitos do Painel do Bot (aba "Painel do Bot" em Administração > Perfis).
 *
 * Uma linha por área, com até três colunas:
 *   Visualizar = READ   ver a aba/área
 *   Editar     = UPDATE alterar, adicionar, ligar/desligar, restaurar padrão
 *   Excluir    = DELETE apagar o que foi criado no painel (os padrões do bot só se desligam/restauram)
 *
 * Todos nascem desmarcados; na instalação só os perfis com Configuração > Atualizar (Super-Admin) recebem tudo.
 */
final class Direito
{
    public const GERAL     = 'plugin_painelbot_geral';
    public const MENSAGENS = 'plugin_painelbot_mensagens';
    public const PERGUNTAS = 'plugin_painelbot_perguntas';
    public const ESCALA    = 'plugin_painelbot_escala';
    public const CADASTROS = 'plugin_painelbot_cadastros';
    public const AVISOS    = 'plugin_painelbot_avisos';
    public const CONFIG    = 'plugin_painelbot_config';

    /** Área → [rótulo, descrição, bits que a área usa]. Ordem = ordem da matriz no perfil. */
    public const AREAS = [
        self::GERAL     => ['Visão geral e últimos envios', 'funcionalidades, IXCs lidos, histórico de envios', READ],
        self::MENSAGENS => ['Mensagens', 'textos das respostas, avisos e lembretes · restaurar padrão · desativar · mensagens novas (Excluir = apagar as criadas no painel)', READ | UPDATE | DELETE],
        self::PERGUNTAS => ['Perguntas', 'frases que acionam o bot (algum n2?, financeiro?…)', READ | UPDATE | DELETE],
        self::ESCALA    => ['Shoppings e escala', 'apelidos, horários, exceções de férias/folga', READ | UPDATE | DELETE],
        self::CADASTROS => ['Técnicos e contatos de setor', 'nomes, telefones, N2/financeiro/comercial…', READ | UPDATE | DELETE],
        self::AVISOS    => ['Avisos automáticos', 'ligar/desligar, modo, tempos, filtros · avisos novos', READ | UPDATE | DELETE],
        self::CONFIG    => ['Parâmetros e conexão', 'modo de envio, grupos, sessão WAHA, banco do bot', READ | UPDATE],
    ];

    /** Chave curta usada no Twig/JS → direito. */
    public const CURTO = [
        'geral'     => self::GERAL,
        'mensagens' => self::MENSAGENS,
        'perguntas' => self::PERGUNTAS,
        'escala'    => self::ESCALA,
        'cadastros' => self::CADASTROS,
        'avisos'    => self::AVISOS,
        'config'    => self::CONFIG,
    ];

    /** Seção da tela → área que precisa de Visualizar. */
    public const SECOES = [
        'geral'      => self::GERAL,
        'shoppings'  => self::ESCALA,
        'tecnicos'   => self::CADASTROS,
        'contatos'   => self::CADASTROS,
        'mensagens'  => self::MENSAGENS,
        'variaveis'  => self::MENSAGENS,   // 0.4.1: variáveis das mensagens novas
        'parametros' => self::CONFIG,
        'eventos'    => self::GERAL,
    ];

    /** Valor completo de cada área (o que o Super-Admin recebe na instalação). */
    public static function completo(string $area): int
    {
        return self::AREAS[$area][2] ?? 0;
    }

    /**
     * Quem já estava logado na instalação/atualização não tem os direitos novos na sessão (o GLPI só carrega no login).
     * Lê do perfil ativo uma vez, sem novo login.
     */
    public static function sincronizarSessao(): void
    {
        /** @var \DBmysql $DB */
        global $DB;
        $perfil = (int) ($_SESSION['glpiactiveprofile']['id'] ?? 0);
        if ($perfil <= 0) {
            return;
        }
        $faltam = array_values(array_filter(array_keys(self::AREAS), fn($n) => !array_key_exists($n, $_SESSION['glpiactiveprofile'])));
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

    /** O perfil tem o bit na área? Bits que a área não usa nunca valem (ex.: Excluir em Mensagens). */
    public static function pode(string $area, int $bit): bool
    {
        if ((self::completo($area) & $bit) !== $bit) {
            return false;
        }
        return (bool) Session::haveRight($area, $bit);
    }

    public static function ler(string $area): bool
    {
        return self::pode($area, READ);
    }

    /** Vê pelo menos uma área (menu e entrada). */
    public static function algumaLeitura(): bool
    {
        foreach (array_keys(self::AREAS) as $a) {
            if (self::ler($a)) {
                return true;
            }
        }
        return false;
    }

    /** Seções da tela que o perfil vê, na ordem das abas. @return list<string> */
    public static function secoes(): array
    {
        return array_values(array_filter(array_keys(self::SECOES), fn($s) => self::ler(self::SECOES[$s])));
    }

    /** @return array{ver:bool, editar:bool, excluir:bool} */
    public static function mapa(string $area): array
    {
        return [
            'ver'     => self::pode($area, READ),
            'editar'  => self::pode($area, UPDATE),
            'excluir' => self::pode($area, DELETE),
        ];
    }

    /** @return array<string, array{ver:bool, editar:bool, excluir:bool}> */
    public static function nav(): array
    {
        $out = [];
        foreach (self::CURTO as $k => $a) {
            $out[$k] = self::mapa($a);
        }
        return $out;
    }

    /** Exige ver alguma área, ou mostra o "acesso negado" padrão do GLPI. */
    public static function exigirAlguma(): void
    {
        if (!self::algumaLeitura()) {
            Session::checkRight(self::GERAL, READ);
        }
    }
}
