<?php

namespace GlpiPlugin\Painelixc;

use DBmysql;
use Session;

/** 0.12.0 — preferências por usuário do painel (por enquanto só o tema: claro, escuro ou auto = segue o GLPI). */
final class Preferencia
{
    public const TABELA = 'glpi_plugin_painelixc_preferencias';
    public const TEMAS  = ['claro', 'escuro', 'auto'];

    public static function normalizarTema(mixed $t): string
    {
        return in_array($t, self::TEMAS, true) ? (string) $t : 'claro';
    }

    /** Tema do usuário logado ('claro' se nunca escolheu ou se a tabela ainda não existe). */
    public static function tema(?DBmysql $db = null): string
    {
        /** @var DBmysql $DB */
        global $DB;
        $db ??= $DB;
        $uid = (int) Session::getLoginUserID();
        if ($uid <= 0 || !$db->tableExists(self::TABELA)) {
            return 'claro';
        }
        $r = $db->request(['SELECT' => ['tema'], 'FROM' => self::TABELA, 'WHERE' => ['users_id' => $uid]])->current();
        return self::normalizarTema($r['tema'] ?? 'claro');
    }

    public static function salvarTema(string $tema, ?DBmysql $db = null): string
    {
        /** @var DBmysql $DB */
        global $DB;
        $db ??= $DB;
        $tema = self::normalizarTema($tema);
        $uid = (int) Session::getLoginUserID();
        if ($uid <= 0) {
            return $tema;
        }
        $agora = date('Y-m-d H:i:s');
        $existe = $db->request(['SELECT' => ['users_id'], 'FROM' => self::TABELA, 'WHERE' => ['users_id' => $uid]])->count() > 0;
        if ($existe) {
            $db->update(self::TABELA, ['tema' => $tema, 'date_mod' => $agora], ['users_id' => $uid]);
        } else {
            $db->insert(self::TABELA, ['users_id' => $uid, 'tema' => $tema, 'date_mod' => $agora]);
        }
        return $tema;
    }
}
