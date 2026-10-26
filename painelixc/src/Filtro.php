<?php

namespace GlpiPlugin\Painelixc;

use DBmysql;
use Session;

/**
 * Filtros salvos do painel, do relatório e da tela Atendimentos (glpi_plugin_painelixc_filtros).
 * Cada usuário salva os seus; pode marcar "visível para todos" e um "padrão" (por tela, por usuário).
 * O conteúdo do filtro é um JSON opaco montado pela tela (não é interpretado aqui).
 */
final class Filtro
{
    public const TELAS = ['painel', 'relatorio', 'atendimento', 'clientes'];
    private const TAM_MAX_JSON = 20000;

    public function __construct(private DBmysql $db)
    {
    }

    public static function tela(mixed $t): string
    {
        return in_array($t, self::TELAS, true) ? (string) $t : 'painel';
    }

    /** 0.12.0: direito da categoria da tela (Ler/Atualizar/Criar/Deletar). */
    public static function pode(string $tela, int $bit): bool
    {
        return Direito::pode(Direito::TELA[$tela] ?? Direito::OS, $bit);
    }

    /** Meus filtros + os públicos dos outros, com o nome do dono. @return list<array<string,mixed>> */
    public function listar(string $tela): array
    {
        $uid = (int) Session::getLoginUserID();
        $it = $this->db->request([
            'SELECT'    => ['f.id', 'f.users_id', 'f.nome', 'f.filtro', 'f.is_publico', 'f.is_padrao', 'f.date_mod',
                new \QueryExpression("TRIM(CONCAT(COALESCE(u.realname,''),' ',COALESCE(u.firstname,''))) AS dono_nome"), 'u.name AS dono_login'],
            'FROM'      => 'glpi_plugin_painelixc_filtros AS f',
            'LEFT JOIN' => ['glpi_users AS u' => ['ON' => ['u' => 'id', 'f' => 'users_id']]],
            'WHERE'     => ['f.tela' => $tela, 'OR' => [['f.users_id' => $uid], ['f.is_publico' => 1]]],
            'ORDER'     => ['f.is_publico ASC', 'f.nome ASC'],
        ]);
        $out = [];
        foreach ($it as $r) {
            $meu = (int) $r['users_id'] === $uid;
            $out[] = [
                'id'         => (int) $r['id'],
                'nome'       => (string) $r['nome'],
                'filtro'     => json_decode((string) $r['filtro'], true) ?: new \stdClass(),
                'publico'    => (bool) $r['is_publico'],
                'padrao'     => $meu && (bool) $r['is_padrao'],
                'meu'        => $meu,
                'pode_apagar' => self::pode($tela, DELETE) && ($meu || Session::haveRight(PLUGIN_PAINELIXC_RIGHT, UPDATE)),
                'dono'       => $meu ? '' : (trim((string) $r['dono_nome']) ?: (string) $r['dono_login']),
            ];
        }
        return $out;
    }

    /**
     * Cria ou atualiza (id > 0 e meu). @param array<string,mixed> $d {id, nome, filtro, publico, padrao}
     * @return array{ok:bool, id?:int, erro?:string}
     */
    public function salvar(string $tela, array $d): array
    {
        $uid  = (int) Session::getLoginUserID();
        $nome = mb_substr(trim((string) ($d['nome'] ?? '')), 0, 80);
        if ($nome === '') {
            return ['ok' => false, 'erro' => 'Dê um nome ao filtro.'];
        }
        $json = json_encode($d['filtro'] ?? new \stdClass(), JSON_UNESCAPED_UNICODE);
        if ($json === false || strlen($json) > self::TAM_MAX_JSON) {
            return ['ok' => false, 'erro' => 'Filtro inválido ou grande demais.'];
        }
        $publico = !empty($d['publico']) ? 1 : 0;
        $padrao  = !empty($d['padrao']) ? 1 : 0;
        $agora   = date('Y-m-d H:i:s');
        $id      = (int) ($d['id'] ?? 0);

        if ($id > 0) {
            $dono = $this->db->request(['SELECT' => 'users_id', 'FROM' => 'glpi_plugin_painelixc_filtros', 'WHERE' => ['id' => $id, 'tela' => $tela]])->current();
            if (!$dono || (int) $dono['users_id'] !== $uid) {
                return ['ok' => false, 'erro' => 'Só o dono pode alterar este filtro.'];
            }
        } else {
            // mesmo nome meu na mesma tela = sobrescreve
            $ex = $this->db->request(['SELECT' => 'id', 'FROM' => 'glpi_plugin_painelixc_filtros', 'WHERE' => ['tela' => $tela, 'users_id' => $uid, 'nome' => $nome]])->current();
            $id = $ex ? (int) $ex['id'] : 0;
        }
        // 0.13.2: salvar (novo ou sobrescrevendo um filtro meu) e marcar o padrão = "Criar" (como na 0.11.1, quem salvava também ajustava)
        if (!self::pode($tela, CREATE)) {
            return ['ok' => false, 'erro' => 'Seu perfil não pode salvar filtros nesta tela (falta o direito "Criar").'];
        }
        if ($padrao) {
            $this->db->update('glpi_plugin_painelixc_filtros', ['is_padrao' => 0], ['tela' => $tela, 'users_id' => $uid]);
        }
        $campos = ['nome' => $nome, 'filtro' => $json, 'is_publico' => $publico, 'is_padrao' => $padrao, 'date_mod' => $agora];
        if ($id > 0) {
            $this->db->update('glpi_plugin_painelixc_filtros', $campos, ['id' => $id]);
        } else {
            $this->db->insert('glpi_plugin_painelixc_filtros', $campos + ['users_id' => $uid, 'tela' => $tela, 'date_creation' => $agora]);
            $id = (int) $this->db->insertId();
        }
        return ['ok' => true, 'id' => $id];
    }

    /** Marca/desmarca o meu padrão (só um por tela). @return array{ok:bool, erro?:string} */
    public function padrao(string $tela, int $id, bool $ligar): array
    {
        $uid = (int) Session::getLoginUserID();
        if (!self::pode($tela, CREATE)) {
            return ['ok' => false, 'erro' => 'Seu perfil não pode marcar o filtro padrão desta tela (falta o direito "Criar").'];
        }
        $this->db->update('glpi_plugin_painelixc_filtros', ['is_padrao' => 0], ['tela' => $tela, 'users_id' => $uid]);
        if ($ligar) {
            // padrão pode apontar para um filtro público de outro: guardo como cópia minha? Não — regra simples: só os meus.
            $dono = $this->db->request(['SELECT' => 'users_id', 'FROM' => 'glpi_plugin_painelixc_filtros', 'WHERE' => ['id' => $id, 'tela' => $tela]])->current();
            if (!$dono || (int) $dono['users_id'] !== $uid) {
                return ['ok' => false, 'erro' => 'Só um filtro seu pode ser o padrão. Salve uma cópia antes.'];
            }
            $this->db->update('glpi_plugin_painelixc_filtros', ['is_padrao' => 1], ['id' => $id]);
        }
        return ['ok' => true];
    }

    /** Apaga: o dono sempre; quem tem direito de configuração apaga qualquer um. @return array{ok:bool, erro?:string} */
    public function excluir(string $tela, int $id): array
    {
        $uid = (int) Session::getLoginUserID();
        if (!self::pode($tela, DELETE)) {
            return ['ok' => false, 'erro' => 'Seu perfil não pode excluir filtros salvos desta tela (falta o direito "Deletar").'];
        }
        $r = $this->db->request(['SELECT' => 'users_id', 'FROM' => 'glpi_plugin_painelixc_filtros', 'WHERE' => ['id' => $id, 'tela' => $tela]])->current();
        if (!$r) {
            return ['ok' => false, 'erro' => 'Filtro não encontrado.'];
        }
        if ((int) $r['users_id'] !== $uid && !Session::haveRight(PLUGIN_PAINELIXC_RIGHT, UPDATE)) {
            return ['ok' => false, 'erro' => 'Só o dono (ou quem configura o painel) pode apagar.'];
        }
        $this->db->delete('glpi_plugin_painelixc_filtros', ['id' => $id]);
        return ['ok' => true];
    }
}
