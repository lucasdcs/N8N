<?php

namespace GlpiPlugin\Painelbot;

use DBConnection;
use ProfileRight;

/**
 * Instalação idempotente: tabela de preferências (tema), direitos e configuração inicial.
 * Os dados do bot NÃO ficam no MariaDB do GLPI: ficam no Postgres do bot (schema ixc, ver sql/).
 */
final class Install
{
    public static function install(): bool
    {
        /** @var \DBmysql $DB */
        global $DB;

        $charset   = DBConnection::getDefaultCharset();
        $collation = DBConnection::getDefaultCollation();
        $sign      = DBConnection::getDefaultPrimaryKeySignOption();

        if (!$DB->tableExists(Preferencia::TABELA)) {
            $DB->doQuery("CREATE TABLE `" . Preferencia::TABELA . "` (
                `users_id` int {$sign} NOT NULL,
                `tema` varchar(10) NOT NULL DEFAULT 'claro',
                `date_mod` timestamp NULL DEFAULT NULL,
                PRIMARY KEY (`users_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET={$charset} COLLATE={$collation} ROW_FORMAT=DYNAMIC");
        }

        self::criarDireitos($DB);
        Config::garantirPadroes();
        return true;
    }

    public static function uninstall(): bool
    {
        /** @var \DBmysql $DB */
        global $DB;

        if ($DB->tableExists(Preferencia::TABELA)) {
            $DB->doQuery('DROP TABLE `' . Preferencia::TABELA . '`');
        }
        $nomes = array_keys(Direito::AREAS);
        ProfileRight::deleteProfileRights($nomes);
        Config::apagarTudo();
        foreach ($nomes as $n) {
            unset($_SESSION['glpiactiveprofile'][$n]);
        }
        return true;
    }

    /**
     * Cria a linha de cada área em todos os perfis que ainda não a têm.
     * Perfil com Configuração > Atualizar (Super-Admin) recebe a área completa; os demais nascem sem nada.
     * Linha que já existe nunca é alterada (reinstalar não desfaz o que o administrador marcou).
     */
    public static function criarDireitos(\DBmysql $DB): void
    {
        $admins = [];
        foreach ($DB->request(['SELECT' => ['profiles_id', 'rights'], 'FROM' => 'glpi_profilerights', 'WHERE' => ['name' => 'config']]) as $r) {
            if (((int) $r['rights'] & UPDATE) === UPDATE) {
                $admins[(int) $r['profiles_id']] = true;
            }
        }
        $perfis = [];
        foreach ($DB->request(['SELECT' => ['id'], 'FROM' => 'glpi_profiles']) as $p) {
            $perfis[] = (int) $p['id'];
        }
        $ativo = (int) ($_SESSION['glpiactiveprofile']['id'] ?? 0);

        foreach (array_keys(Direito::AREAS) as $nome) {
            $existentes = [];
            foreach ($DB->request(['SELECT' => ['profiles_id'], 'FROM' => 'glpi_profilerights', 'WHERE' => ['name' => $nome]]) as $r) {
                $existentes[(int) $r['profiles_id']] = true;
            }
            foreach ($perfis as $pid) {
                if (isset($existentes[$pid])) {
                    continue;
                }
                $valor = isset($admins[$pid]) ? Direito::completo($nome) : 0;
                $DB->insert('glpi_profilerights', ['profiles_id' => $pid, 'name' => $nome, 'rights' => $valor]);
                if ($pid === $ativo) {
                    $_SESSION['glpiactiveprofile'][$nome] = $valor;   // quem instalou já enxerga o menu sem novo login
                }
            }
        }
    }
}
