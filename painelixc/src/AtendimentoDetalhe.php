<?php

namespace GlpiPlugin\Painelixc;

use DBmysql;

/**
 * 0.13.3 (P13-6) — detalhe de UM atendimento, consultado AO VIVO na API do IXC quando a linha é aberta na aba Atendimento
 * (token da Configuração, só "listar"; nada é gravado e nenhum workflow do n8n muda).
 *
 * Tabelas do IXC:
 *   su_ticket                 o atendimento (mensagem de abertura: "menssagem" — grafia do IXC — ou "mensagem")
 *   su_mensagens              mensagens do atendimento (id_ticket)
 *   su_ticket_arquivos        anexos do atendimento (id_ticket) — nome não documentado: tenta as candidatas em TAB_ANEXOS_ATD
 *   su_oss_chamado            O.S. do atendimento (id_ticket)
 *   su_oss_chamado_mensagem   mensagens das O.S. (id_chamado)
 *   su_oss_chamado_arquivos   anexos das O.S. (id_oss_chamado)
 * Falha numa parte vira aviso (o resto aparece). Só sai para o navegador o que a tela mostra.
 * Por segurança, só abre atendimentos que o painel conhece (tabela _atendimentos daquela base).
 */
final class AtendimentoDetalhe
{
    public const MAX_OS       = 100;
    public const MAX_MSGS     = 300;   // por O.S. e no atendimento
    public const MAX_ARQUIVOS = 200;
    /** candidatas para os anexos do atendimento: tabela => campo que liga ao su_ticket */
    public const TAB_ANEXOS_ATD = ['su_ticket_arquivos' => 'id_ticket', 'su_ticket_anexos' => 'id_ticket'];
    /**
     * Link do anexo na web do IXC (abre em outra aba, exige estar logado no IXC da base), como na Auditoria.
     * O.S.: su_oss_chamado/rel_30001.php. Atendimento: su_ticket_arquivos/rel_28010.php (capturado pelo F12 na BUZZ, 20/10).
     */
    public const URL_ANEXO_OS  = '/aplicativo/su_oss_chamado/rel_30001.php?id={id}';
    public const URL_ANEXO_ATD = '/aplicativo/su_ticket_arquivos/rel_28010.php?id={id}';

    /** @var callable(string,string,array,bool,string):array */
    private $http;

    public function __construct(private DBmysql $db, ?callable $http = null)
    {
        $this->http = $http ?? [AcaoAuditoria::class, 'httpIxc'];
    }

    /** @return array<string,mixed> */
    public function buscar(string $codigo, int $ticket): array
    {
        if ($ticket <= 0) {
            return ['ok' => false, 'erro' => 'Atendimento inválido.'];
        }
        $base = $this->db->request(['FROM' => 'glpi_plugin_painelixc_bases', 'WHERE' => ['codigo' => $codigo, 'is_active' => 1]])->current();
        if (!$base) {
            return ['ok' => false, 'erro' => 'Base desconhecida.'];
        }
        $conhecido = $this->db->request(['COUNT' => 'n', 'FROM' => Atendimento::TABELA,
            'WHERE' => ['plugin_painelixc_bases_id' => (int) $base['id'], 'ixc_id' => $ticket]])->current();
        if ((int) ($conhecido['n'] ?? 0) === 0) {
            return ['ok' => false, 'erro' => 'Atendimento #' . $ticket . ' não está no painel desta base.'];
        }
        $ac = Cliente::acessoBase($this->db, $codigo);
        if (is_string($ac)) {
            return ['ok' => false, 'erro' => $ac];
        }
        $avisos = [];
        $nomes = $this->dicionarios((int) $base['id']);

        // 1) o atendimento (mensagem de abertura)
        $t = $this->listar($ac, 'su_ticket', 'su_ticket.id', [$ticket], 1);
        if (is_string($t)) {
            return ['ok' => false, 'erro' => 'Atendimento: ' . $t];
        }
        $tk = $t[0] ?? [];
        $atd = [
            'id'            => $ticket,
            'protocolo'     => Ingest::txt($tk['protocolo'] ?? null, 40),
            'titulo'        => Ingest::txt($tk['titulo'] ?? null, 255),
            'mensagem'      => Auditoria::texto($tk['menssagem'] ?? $tk['mensagem'] ?? null),
            'data_abertura' => Ingest::data($tk['data_criacao'] ?? $tk['data_abertura'] ?? null),
        ];

        // 2) mensagens do atendimento
        $msgsAtd = [];
        $m = $this->listar($ac, 'su_mensagens', 'su_mensagens.id_ticket', [$ticket], self::MAX_MSGS);
        if (is_string($m)) {
            $avisos[] = 'mensagens do atendimento (su_mensagens) indisponíveis: ' . $m;
        } else {
            foreach ($m as $x) {
                if (($txt = Auditoria::texto($x['mensagem'] ?? null)) === null) {
                    continue;
                }
                $msgsAtd[] = ['id' => (int) Ingest::int($x['id'] ?? null), 'data' => Ingest::data($x['data'] ?? null),
                    'autor' => $this->autor($x, $nomes), 'mensagem' => $txt];
            }
            self::ordenar($msgsAtd);
        }

        // 3) anexos do atendimento (tabela não documentada: tenta as candidatas)
        $arqsAtd = [];
        $falhas = [];
        $achou = false;
        foreach (self::TAB_ANEXOS_ATD as $tab => $campo) {
            $r = $this->listar($ac, $tab, "$tab.$campo", [$ticket], self::MAX_ARQUIVOS);
            if (is_string($r)) {
                $falhas[] = "$tab: $r";
                continue;
            }
            $achou = true;
            $arqsAtd = self::arquivos($r);
            break;
        }
        if (!$achou) {
            $avisos[] = 'anexos do atendimento indisponíveis (' . implode(' · ', $falhas) . ')';
        }

        // 4) O.S. do atendimento + mensagens e anexos de cada uma
        $os = [];
        $r = $this->listar($ac, 'su_oss_chamado', 'su_oss_chamado.id_ticket', [$ticket], self::MAX_OS);
        if (is_string($r)) {
            $avisos[] = 'O.S. do atendimento indisponíveis: ' . $r;
        } else {
            foreach ($r as $o) {
                $id = (int) Ingest::int($o['id'] ?? null);
                if ($id <= 0) {
                    continue;
                }
                $idAss = (int) Ingest::int($o['id_assunto'] ?? null);
                $idTec = (int) Ingest::int($o['id_tecnico'] ?? null);
                $idSet = (int) Ingest::int($o['setor'] ?? $o['id_setor'] ?? null);
                $os[$id] = [
                    'id' => $id, 'protocolo' => Ingest::txt($o['protocolo'] ?? null, 40),
                    'status' => strtoupper((string) Ingest::txt($o['status'] ?? null, 5)),
                    'id_assunto' => $idAss ?: null, 'assunto' => $nomes['assuntos'][$idAss] ?? null,
                    'id_tecnico' => $idTec ?: null, 'tecnico' => $nomes['tecnicos'][$idTec] ?? null,
                    'id_setor' => $idSet ?: null, 'setor' => $nomes['setores'][$idSet] ?? null,
                    'data_abertura' => Ingest::data($o['data_abertura'] ?? null),
                    'data_agenda' => Ingest::data($o['data_agenda'] ?? null),
                    'data_fechamento' => Ingest::data($o['data_fechamento'] ?? null),
                    'mensagem' => Auditoria::texto($o['mensagem'] ?? null),
                    'mensagem_resposta' => Auditoria::texto($o['mensagem_resposta'] ?? null),
                    'msgs' => [], 'arquivos' => [],
                ];
            }
            ksort($os);
            $ids = array_keys($os);
            if ($ids) {
                $mm = $this->listar($ac, 'su_oss_chamado_mensagem', 'su_oss_chamado_mensagem.id_chamado', $ids, 2000);
                if (is_string($mm)) {
                    $avisos[] = 'mensagens das O.S. (su_oss_chamado_mensagem) indisponíveis: ' . $mm;
                } else {
                    foreach ($mm as $x) {
                        $dono = (int) Ingest::int($x['id_chamado'] ?? null);
                        if (!isset($os[$dono]) || count($os[$dono]['msgs']) >= self::MAX_MSGS) {
                            continue;
                        }
                        $txt = Auditoria::texto($x['mensagem'] ?? null);
                        $hist = Auditoria::texto($x['historico'] ?? null);
                        if ($txt === null && $hist === null) {
                            continue;
                        }
                        $os[$dono]['msgs'][] = ['id' => (int) Ingest::int($x['id'] ?? null), 'data' => Ingest::data($x['data'] ?? null),
                            'status' => strtoupper((string) Ingest::txt($x['status'] ?? null, 5)) ?: null,
                            'autor' => $this->autor($x, $nomes), 'mensagem' => $txt, 'historico' => $hist];
                    }
                }
                $aa = $this->listar($ac, 'su_oss_chamado_arquivos', 'su_oss_chamado_arquivos.id_oss_chamado', $ids, 2000);
                if (is_string($aa)) {
                    $avisos[] = 'anexos das O.S. (su_oss_chamado_arquivos) indisponíveis: ' . $aa;
                } else {
                    $por = [];
                    foreach ($aa as $f) {
                        $por[(int) Ingest::int($f['id_oss_chamado'] ?? null)][] = $f;
                    }
                    foreach ($por as $dono => $lista) {
                        if (isset($os[$dono])) {
                            $os[$dono]['arquivos'] = self::arquivos($lista);
                        }
                    }
                }
                foreach ($os as &$o) {
                    self::ordenar($o['msgs']);
                }
                unset($o);
            }
        }

        return [
            'ok'          => true,
            'base'        => $codigo,
            'ixc_url'     => $ac['url'],
            'url_anexo'   => ['os' => self::URL_ANEXO_OS, 'atd' => self::URL_ANEXO_ATD],
            'consultado'  => date('Y-m-d H:i:s'),
            'atendimento' => $atd,
            'msgs'        => $msgsAtd,
            'arquivos'    => $arqsAtd,
            'os'          => array_values($os),
            'avisos'      => array_values(array_unique($avisos)),
        ];
    }

    /** Nomes dos campos das tabelas usadas (para conferir no IXC real; só quem tem a Configuração). @return array<string,mixed> */
    public function diagnostico(string $codigo, int $ticket): array
    {
        $ac = Cliente::acessoBase($this->db, $codigo);
        if (is_string($ac)) {
            return ['ok' => false, 'erro' => $ac];
        }
        $tabs = ['su_ticket' => 'id', 'su_mensagens' => 'id_ticket', 'su_oss_chamado' => 'id_ticket'] + self::TAB_ANEXOS_ATD
            + ['su_oss_chamado_mensagem' => null, 'su_oss_chamado_arquivos' => null];
        $out = ['ok' => true, 'base' => $codigo, 'ticket' => $ticket, 'tabelas' => []];
        foreach ($tabs as $tab => $campo) {
            $corpo = ($campo !== null && $ticket > 0)
                ? self::corpo("$tab.$campo", [$ticket], 1)
                : ['qtype' => "$tab.id", 'oper' => '>', 'query' => '0', 'page' => '1', 'rp' => '1', 'sortname' => "$tab.id", 'sortorder' => 'desc'];
            $r = ($this->http)($ac['url'], $tab, $corpo, true, $ac['token']);
            $reg = $r['registros'][0] ?? null;
            $out['tabelas'][$tab] = (($r['type'] ?? '') === 'error') ? ['erro' => AcaoAuditoria::erroIxc($r)]
                : ['total' => (int) ($r['total'] ?? 0), 'campos' => is_array($reg) ? array_keys($reg) : []];
        }
        return $out;
    }

    /**
     * 0.13.4.2 — diagnóstico do SLA: para o atendimento N e as O.S. dele, devolve só os campos de SLA/prazo/datas/status (com valor)
     * e o cadastro de SLA dos assuntos envolvidos (su_oss_assunto) — para conferir um percentual que não bater com a tela do IXC.
     * Nada de cliente, mensagem ou documento sai daqui.
     */
    public function diagnosticoSla(string $codigo, int $ticket): array
    {
        $ac = Cliente::acessoBase($this->db, $codigo);
        if (is_string($ac)) {
            return ['ok' => false, 'erro' => $ac];
        }
        $filtro = static function (array $reg): array {
            $o = [];
            foreach ($reg as $k => $v) {
                if (preg_match('/sla|prazo|tempo|limite|venc|data_|hora|status|prioridade|id_assunto|id_ticket_setor|origem/i', (string) $k)
                    && !preg_match('/senha|token|cpf|cnpj|mensagem|menssagem|titulo|descricao|historico/i', (string) $k)) {
                    $o[$k] = is_scalar($v) ? mb_substr((string) $v, 0, 80) : gettype($v);
                }
            }
            return $o;
        };
        $out = ['ok' => true, 'base' => $codigo, 'ticket' => $ticket, 'tabelas' => []];
        foreach (['su_ticket' => ['id', 1], 'su_oss_chamado' => ['id_ticket', 20]] as $tab => [$campo, $rp]) {   // 0.13.5: su_ticket_sla/su_sla/sla não existem na API
            $corpo = ($campo !== null && $ticket > 0)
                ? self::corpo("$tab.$campo", [$ticket], $rp)
                : ['qtype' => "$tab.id", 'oper' => '>', 'query' => '0', 'page' => '1', 'rp' => (string) $rp, 'sortname' => "$tab.id", 'sortorder' => 'asc'];
            $r = ($this->http)($ac['url'], $tab, $corpo, true, $ac['token']);
            if (($r['type'] ?? '') === 'error') {
                $out['tabelas'][$tab] = ['erro' => AcaoAuditoria::erroIxc($r)];
                continue;
            }
            $regs = Ingest::registros($r);
            $out['tabelas'][$tab] = ['total' => (int) ($r['total'] ?? 0), 'campos' => is_array($regs[0] ?? null) ? array_keys($regs[0]) : [],
                'registros' => array_map(fn($x) => ($campo === null) ? array_map(fn($v) => is_scalar($v) ? mb_substr((string) $v, 0, 80) : gettype($v), $x) : $filtro($x), $regs)];
        }
        // 0.13.4.3: o SLA do IXC é configurado por ASSUNTO (Sistema > Suporte > Cadastros > Assuntos > aba SLA: horas para a O.S. e
        // horas para o atendimento) — traz o cadastro dos assuntos envolvidos, só com os campos de SLA/horas/prazo
        $assuntos = [];
        foreach (array_merge($out['tabelas']['su_ticket']['registros'] ?? [], $out['tabelas']['su_oss_chamado']['registros'] ?? []) as $x) {
            if ((int) ($x['id_assunto'] ?? 0) > 0) {
                $assuntos[] = (int) $x['id_assunto'];
            }
        }
        foreach (['su_oss_assunto'] as $tab) {   // o assunto do atendimento usa a mesma tabela (su_ticket_assunto não existe na API)
            $corpo = $assuntos ? self::corpo("$tab.id", array_values(array_unique($assuntos)), 50)
                : ['qtype' => "$tab.id", 'oper' => '>', 'query' => '0', 'page' => '1', 'rp' => '3', 'sortname' => "$tab.id", 'sortorder' => 'asc'];
            $r = ($this->http)($ac['url'], $tab, $corpo, true, $ac['token']);
            if (($r['type'] ?? '') === 'error') {
                $out['tabelas'][$tab] = ['erro' => AcaoAuditoria::erroIxc($r)];
                continue;
            }
            $regs = Ingest::registros($r);
            $out['tabelas'][$tab] = ['total' => (int) ($r['total'] ?? 0), 'campos' => is_array($regs[0] ?? null) ? array_keys($regs[0]) : [],
                'registros' => array_map(static function (array $x): array {
                    $o = [];
                    foreach ($x as $k => $v) {
                        if (preg_match('/^id$|assunto|sla|hora|prazo|dia|agend|tempo|meta|tipo/i', (string) $k)) {
                            $o[$k] = is_scalar($v) ? mb_substr((string) $v, 0, 80) : gettype($v);
                        }
                    }
                    return $o;
                }, $regs)];
        }
        return $out;
    }

    // ------------------------------------------------------------------ apoio

    /** Corpo do "listar": um id em qtype/query; vários em grid_param IN. @param list<int> $ids @return array<string,string> */
    public static function corpo(string $campo, array $ids, int $rp): array
    {
        $tab = strstr($campo, '.', true) ?: $campo;
        $ids = array_values(array_unique(array_filter(array_map('intval', $ids), fn($i) => $i > 0)));
        $c = ['page' => '1', 'rp' => (string) max(1, $rp), 'sortname' => "$tab.id", 'sortorder' => 'asc'];
        if (count($ids) === 1) {
            return $c + ['qtype' => $campo, 'oper' => '=', 'query' => (string) $ids[0]];
        }
        return $c + ['qtype' => "$tab.id", 'oper' => '>', 'query' => '0',
            'grid_param' => json_encode([['TB' => $campo, 'OP' => 'IN', 'P' => implode(',', $ids)]])];
    }

    /** @param list<int> $ids @return list<array<string,mixed>>|string  string = erro */
    private function listar(array $ac, string $tabela, string $campo, array $ids, int $rp): array|string
    {
        $r = ($this->http)($ac['url'], $tabela, self::corpo($campo, $ids, $rp), true, $ac['token']);
        if (($r['type'] ?? '') === 'error') {
            return AcaoAuditoria::erroIxc($r);
        }
        if (!is_numeric($r['total'] ?? null)) {
            return 'resposta inesperada do IXC';
        }
        return Ingest::registros($r);
    }

    /** @param list<array<string,mixed>> $lista @return list<array<string,mixed>> */
    private static function arquivos(array $lista): array
    {
        $out = [];
        foreach (array_slice($lista, 0, self::MAX_ARQUIVOS) as $f) {
            $id = (int) Ingest::int($f['id'] ?? null);
            if ($id <= 0) {
                continue;
            }
            $out[] = ['id' => $id, 'descricao' => Ingest::txt($f['descricao'] ?? null, 200),
                'nome' => Ingest::txt($f['nome_arquivo'] ?? $f['arquivo'] ?? $f['nome'] ?? null, 255),
                'data' => Ingest::data($f['data_envio'] ?? $f['data'] ?? null)];
        }
        self::ordenar($out);
        return $out;
    }

    /** @param list<array<string,mixed>> $l */
    private static function ordenar(array &$l): void
    {
        usort($l, static fn($a, $b) => [(string) $a['data'], (int) $a['id']] <=> [(string) $b['data'], (int) $b['id']]);
    }

    /** Quem escreveu: colaborador (id_tecnico/id_operador) pelo dicionário, ou o nome que o IXC mandar. */
    private function autor(array $x, array $nomes): ?string
    {
        foreach (['id_tecnico', 'id_operador'] as $k) {
            $id = (int) Ingest::int($x[$k] ?? null);
            if ($id > 0) {
                return $nomes['tecnicos'][$id] ?? ('colaborador #' . $id);
            }
        }
        foreach (['operador', 'nome_operador', 'usuario'] as $k) {
            if (($s = Ingest::txt($x[$k] ?? null, 120)) !== null && !ctype_digit($s)) {
                return $s;
            }
        }
        return null;
    }

    /** @return array{assuntos:array<int,string>, tecnicos:array<int,string>, setores:array<int,string>} */
    private function dicionarios(int $baseId): array
    {
        $out = ['assuntos' => [], 'tecnicos' => [], 'setores' => []];
        foreach ($this->db->request(['SELECT' => ['tipo', 'ixc_id', 'nome'], 'FROM' => 'glpi_plugin_painelixc_dicionarios',
            'WHERE' => ['plugin_painelixc_bases_id' => $baseId, 'tipo' => array_keys($out)]]) as $d) {
            $out[$d['tipo']][(int) $d['ixc_id']] = (string) $d['nome'];
        }
        return $out;
    }
}
