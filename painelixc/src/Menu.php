<?php

namespace GlpiPlugin\Painelixc;

use CommonGLPI;

/** Item "Painel IXC" no menu Assistência. */
final class Menu extends CommonGLPI
{
    public static $rightname = PLUGIN_PAINELIXC_RIGHT;

    public static function getTypeName($nb = 0)
    {
        return 'Painel IXC';
    }

    public static function getMenuName()
    {
        return self::getTypeName();
    }

    public static function getIcon()
    {
        return 'ti ti-antenna-bars-5';
    }

    /** 0.12.0: vê o menu quem lê pelo menos uma categoria (Atendimento, Ordem de Serviço, Auditoria, Clientes ou Relatório). */
    public static function canView(): bool
    {
        return Direito::algumaLeitura();
    }

    public static function getMenuContent()
    {
        if (!self::canView()) {
            return false;
        }
        $dir = 'plugins/painelixc';
        $opcoes = [
            'relatorio'   => [Direito::RELATORIO, 'Relatório', '/front/relatorio.php', 'ti ti-chart-pie'],
            'atendimento' => [Direito::ATENDIMENTO, 'Atendimentos', '/front/atendimento.php', 'ti ti-headset'],
            'auditoria'   => [Direito::AUDITORIA, 'Auditoria de Ativação', '/front/auditoria.php', 'ti ti-clipboard-check'],
            'clientes'    => [Direito::CLIENTES, 'Clientes', '/front/clientes.php', 'ti ti-users'],
        ];
        $options = [];
        foreach ($opcoes as $k => [$direito, $titulo, $pagina, $icone]) {
            if (Direito::ler($direito)) {
                $options[$k] = ['title' => $titulo, 'page' => "/$dir$pagina", 'icon' => $icone];
            }
        }
        return [
            'title'   => self::getMenuName(),
            'page'    => Direito::primeiraPagina() ?? "/$dir/front/painel.php",
            'icon'    => self::getIcon(),
            'options' => $options,
        ];
    }
}
