<?php

namespace GlpiPlugin\Painelbot;

use CommonGLPI;

/** Item "Painel do Bot" no menu Administração. */
final class Menu extends CommonGLPI
{
    public static $rightname = Direito::GERAL;

    public static function getTypeName($nb = 0)
    {
        return 'Painel do Bot';
    }

    public static function getMenuName()
    {
        return self::getTypeName();
    }

    public static function getIcon()
    {
        return 'ti ti-robot';
    }

    /** Vê o menu quem tem Visualizar em pelo menos uma área. */
    public static function canView(): bool
    {
        return Direito::algumaLeitura();
    }

    public static function getMenuContent()
    {
        if (!self::canView()) {
            return false;
        }
        return [
            'title' => self::getMenuName(),
            'page'  => '/plugins/painelbot/front/painel.php',
            'icon'  => self::getIcon(),
        ];
    }
}
