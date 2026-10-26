<?php

namespace GlpiPlugin\Painelixc;

use CommonGLPI;
use Html;
use Profile as GlpiProfile;
use Session;

/** Aba "Painel IXC" no perfil: matriz Ler/Atualizar/Criar/Deletar por categoria (0.12.0) + Configuração. */
final class Profile extends GlpiProfile
{
    public static $rightname = 'profile';

    public static function getTypeName($nb = 0)
    {
        return 'Painel IXC';
    }

    /** Rótulos das colunas (iguais ao ShopMap: Ler, Atualizar, Criar, Deletar). */
    private const COLUNAS = [READ => 'Ler', UPDATE => 'Atualizar', CREATE => 'Criar', DELETE => 'Deletar'];

    /**
     * Matriz da aba: uma linha por categoria (Atendimento, Ordem de Serviço, Auditoria, Clientes, Relatório) com Ler/Atualizar/Criar/Deletar,
     * mais a linha da Configuração (só Atualizar). O "Marcar/desmarcar todos" é do próprio GLPI.
     * @return array<int,array<string,mixed>>
     */
    public static function getAllRights(bool $all = false): array
    {
        $linhas = [];
        foreach (Direito::CATEGORIAS as $campo => $rotulo) {
            $linhas[] = [
                'itemtype' => Menu::class,
                'label'    => $rotulo,
                'field'    => $campo,
                'rights'   => self::COLUNAS,
            ];
        }
        $linhas[] = [
            'itemtype' => Menu::class,
            'label'    => 'Configuração (bases, tokens, botões, distribuição)',
            'field'    => PLUGIN_PAINELIXC_RIGHT,
            'rights'   => [UPDATE => 'Atualizar'],
        ];
        return $linhas;
    }

    public function getTabNameForItem(CommonGLPI $item, $withtemplate = 0)
    {
        // 0.13.2: também nos perfis da interface simplificada (Self-Service etc.), para o administrador poder tirar o acesso herdado
        if ($item instanceof GlpiProfile) {
            return self::createTabEntry(self::getTypeName(), 0, $item::getType(), Menu::getIcon());
        }
        return '';
    }

    public static function displayTabContentForItem(CommonGLPI $item, $tabnum = 1, $withtemplate = 0)
    {
        if ($item instanceof GlpiProfile && (int) $item->getField('id') > 0) {
            $prof = new self();
            $prof->showForm((int) $item->getField('id'));
        }
        return true;
    }

    public function showForm($ID, array $options = [])
    {
        if (!Session::haveRightsOr('profile', [CREATE, UPDATE, PURGE])) {
            return false;
        }
        $profile = new GlpiProfile();
        $profile->getFromDB($ID);
        $podeEditar = $profile->canUpdate();

        echo "<div class='firstbloc'>";
        if ($podeEditar) {
            echo "<form method='post' action='" . $profile->getFormURL() . "'>";
        }
        $profile->displayRightsChoiceMatrix(self::getAllRights(), [
            'canedit'       => $podeEditar,
            'default_class' => 'tab_bg_2',
            'title'         => 'Painel IXC — acessos por módulo',
        ]);
        echo self::legenda();
        if ($podeEditar) {
            echo "<div class='center'>";
            echo Html::hidden('id', ['value' => $ID]);
            echo Html::submit(_sx('button', 'Save'), ['name' => 'update', 'class' => 'btn btn-primary mt-2']);
            echo "</div>";
            Html::closeForm();
        }
        echo "</div>";
        return true;
    }

    /** Explica o que cada coluna libera (fica abaixo da matriz). */
    private static function legenda(): string
    {
        $l = [
            'Ler'       => 'ver a tela, buscar, filtrar e exportar (CSV; no Relatório também PDF). Em Clientes: consultar o cadastro de clientes da base direto no IXC.',
            'Atualizar' => 'Ordem de Serviço e Atendimento: botão "Atualizar agora". Auditoria: botões Aprovar/Reprovar.',
            'Criar'     => 'salvar filtros (novo ou alterando um seu) e marcar o padrão. Na Auditoria: adicionar botões de auditoria (na Configuração).',
            'Deletar'   => 'excluir filtro salvo. Na Auditoria: apagar botões de auditoria (na Configuração).',
            'Configuração' => 'abrir Configurar > Geral > Painel IXC (bases, tokens, respostas, distribuição).',
        ];
        $h = "<div class='mx-2 mb-3 small text-muted'><b>O que cada direito libera</b><ul class='mb-1 mt-1'>";
        foreach ($l as $k => $v) {
            $h .= '<li><b>' . htmlspecialchars($k) . '</b>: ' . htmlspecialchars($v) . '</li>';
        }
        return $h . '</ul>A mudança vale a partir do próximo login (ou da próxima troca de perfil) de cada usuário.</div>';
    }
}
