<?php

namespace GlpiPlugin\Painelbot;

use CommonGLPI;
use Html;
use Profile as GlpiProfile;
use Session;

/** Aba "Painel do Bot" no perfil: matriz Área × Visualizar / Editar / Excluir. */
final class Profile extends GlpiProfile
{
    public static $rightname = 'profile';

    /** Rótulos das colunas. */
    private const COLUNAS = [READ => 'Visualizar', UPDATE => 'Editar', DELETE => 'Excluir'];

    public static function getTypeName($nb = 0)
    {
        return 'Painel do Bot';
    }

    /**
     * Uma linha por área, só com as colunas que a área usa (as outras ficam vazias na matriz).
     * @return array<int,array<string,mixed>>
     */
    public static function getAllRights(bool $all = false): array
    {
        $linhas = [];
        foreach (Direito::AREAS as $campo => [$rotulo, $descricao, $bits]) {
            $direitos = [];
            foreach (self::COLUNAS as $bit => $nome) {
                if (($bits & $bit) === $bit) {
                    $direitos[$bit] = $nome;
                }
            }
            $linhas[] = [
                'itemtype' => Menu::class,
                'label'    => $rotulo . ' — ' . $descricao,
                'field'    => $campo,
                'rights'   => $direitos,
            ];
        }
        return $linhas;
    }

    public function getTabNameForItem(CommonGLPI $item, $withtemplate = 0)
    {
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
            'title'         => 'Painel do Bot — acessos por área',
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
            'Visualizar' => 'ver a área no Painel do Bot. Sem Visualizar em nenhuma área, o menu Administração > Painel do Bot não aparece.',
            'Editar'     => 'alterar, adicionar, ligar/desligar e restaurar o padrão (ex.: texto de uma mensagem, nova pergunta). Em "Parâmetros e conexão": a conexão com o banco do bot em Configurar > Geral > Painel do Bot.',
            'Excluir'    => 'apagar o que foi criado no painel. Os padrões do bot não se apagam: só se desligam ou se restauram.',
        ];
        $h = "<div class='mx-2 mb-3 small text-muted'><b>O que cada coluna libera</b><ul class='mb-1 mt-1'>";
        foreach ($l as $k => $v) {
            $h .= '<li><b>' . htmlspecialchars($k) . '</b>: ' . htmlspecialchars($v) . '</li>';
        }
        return $h . '</ul>Na versão 0.1.0 o painel é só de consulta: Editar e Excluir passam a valer nas próximas versões. '
            . 'A mudança vale a partir do próximo login (ou da próxima troca de perfil) de cada usuário.</div>';
    }
}
