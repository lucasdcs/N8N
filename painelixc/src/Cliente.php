<?php

namespace GlpiPlugin\Painelixc;

use DBmysql;

/**
 * 0.13.0 — aba Clientes: busca ao vivo na API do IXC de UMA base (token da Configuração), só leitura.
 *
 * Tabelas do IXC usadas (só "listar"):
 *   cliente             id, razao, fantasia, ativo (S/N), tipo_pessoa (F/J), id_tipo_cliente, id_condominio
 *   cliente_contrato    id, id_cliente, contrato (= plano de venda), status, status_internet (= status de acesso), data_ativacao, id_vd_contrato
 *   vd_contratos_produtos  produtos do contrato (0.13.4): id_contrato (vínculo Contrato) ou id_vd_contrato (vínculo Plano), descricao, id_produto, qtde
 *   produtos            id, descricao (nome do Serviço/Produto)
 *   cliente_condominio  id, condominio                          (lista do filtro)
 *   tipo de cliente     tabela "cliente_tipo" (ou "tipo_cliente"), campo de nome tipo_cliente/descricao (lista do filtro)
 * Só os campos acima saem para o navegador (o cadastro do IXC tem CPF, senhas do hotsite etc.).
 */
final class Cliente
{
    public const POR_PAGINA  = 50;                                   // padrão
    public const TAMANHOS    = [10, 15, 20, 25, 50, 100, 200, 500];   // 0.13.1: "linhas / página" como no GLPI
    public const LIMITE_CSV  = 10000;
    private const TTL_LISTAS = 600;   // condomínios e tipos ficam 10 min em cache
    private const TAB_TIPOS  = ['cliente_tipo', 'tipo_cliente'];
    private const NOME_TIPO  = ['tipo_cliente', 'descricao', 'tipo', 'nome'];
    /** 0.13.4: produtos do contrato (aba "Produtos" do contrato no IXC) e nome do Serviço/Produto */
    public const TAB_PRODUTOS = 'vd_contratos_produtos';
    public const TAB_SERVICOS = 'produtos';
    public const MAX_PRODUTOS = 50;   // por contrato

    /** @var callable(string,string,array,bool,string):array */
    private $http;

    public function __construct(private DBmysql $db, ?callable $http = null)
    {
        $this->http = $http ?? [AcaoAuditoria::class, 'httpIxc'];
    }

    // ------------------------------------------------------------------ bases

    /** Bases ativas com o que a tela precisa (sem token). @return list<array<string,mixed>> */
    public function bases(): array
    {
        $out = [];
        foreach ($this->db->request(['FROM' => 'glpi_plugin_painelixc_bases', 'WHERE' => ['is_active' => 1], 'ORDER' => 'ordem']) as $b) {
            $out[] = ['codigo' => (string) $b['codigo'], 'nome' => (string) $b['nome'], 'cor' => (string) $b['cor'],
                'pronta' => !empty($b['api_token']) && preg_match('#^https?://#i', (string) ($b['ixc_url'] ?? '')) === 1];
        }
        return $out;
    }

    /** @return array{url:string, token:string, nome:string}|string  string = mensagem de erro */
    private function acesso(string $codigo): array|string
    {
        return self::acessoBase($this->db, $codigo);
    }

    /**
     * URL e token (decifrado) de uma base ativa, para consultas ao vivo no IXC (Clientes e, desde a 0.13.3, detalhe do Atendimento).
     * @return array{url:string, token:string, nome:string}|string  string = mensagem de erro
     */
    public static function acessoBase(DBmysql $db, string $codigo): array|string
    {
        $b = $db->request(['FROM' => 'glpi_plugin_painelixc_bases', 'WHERE' => ['codigo' => $codigo, 'is_active' => 1]])->current();
        if (!$b) {
            return 'Base desconhecida.';
        }
        $url = rtrim((string) ($b['ixc_url'] ?? ''), '/');
        if (empty($b['api_token']) || !preg_match('#^https?://#i', $url)) {
            return 'A base ' . $b['nome'] . ' está sem URL ou sem token da API (Configurar > Geral > Painel IXC).';
        }
        return ['url' => $url, 'token' => (new \GLPIKey())->decrypt((string) $b['api_token']), 'nome' => (string) $b['nome']];
    }

    /** @return array<string,mixed> */
    private function listar(array $ac, string $tabela, array $corpo): array
    {
        return ($this->http)($ac['url'], $tabela, $corpo, true, $ac['token']);
    }

    private static function erro(array $r): ?string
    {
        return (($r['type'] ?? '') === 'error') ? AcaoAuditoria::erroIxc($r) : null;
    }

    // ------------------------------------------------------------------ filtros

    /**
     * Normaliza o que veio da tela. @param array<string,mixed> $in
     * @return array{base:string, ativo:string, id:int, razao:string, fantasia:string, tipo:int, condominio:int, produto:int, ordem:string, dir:string, pagina:int, rp:int}
     */
    public static function filtros(array $in): array
    {
        $txt = static fn($v) => mb_substr(trim(preg_replace('/[%_\\\\]+/', ' ', (string) $v) ?? ''), 0, 80);
        $ativo = (string) ($in['ativo'] ?? '');
        return [
            'base'       => preg_replace('/[^a-z0-9_-]/', '', strtolower((string) ($in['base'] ?? ''))) ?? '',
            'ativo'      => in_array($ativo, ['S', 'N'], true) ? $ativo : '',
            'id'         => max(0, (int) ($in['id'] ?? 0)),
            'razao'      => $txt($in['razao'] ?? ''),
            'fantasia'   => $txt($in['fantasia'] ?? ''),
            'tipo'       => max(0, (int) ($in['tipo'] ?? 0)),
            'condominio' => max(0, (int) ($in['condominio'] ?? 0)),
            'produto'    => max(0, (int) ($in['produto'] ?? 0)),   // 0.13.5.5: id do Serviço/Produto (tabela produtos)
            'ordem'      => in_array($in['ordem'] ?? '', ['id', 'razao', 'fantasia', 'ativo'], true) ? (string) $in['ordem'] : 'razao',
            'dir'        => ($in['dir'] ?? '') === 'desc' ? 'desc' : 'asc',   // 0.13.2.5: clicar de novo inverte
            'pagina'     => max(1, min(100000, (int) ($in['pagina'] ?? 1))),
            'rp'         => in_array((int) ($in['rp'] ?? 0), self::TAMANHOS, true) ? (int) $in['rp'] : self::POR_PAGINA,
        ];
    }

    /**
     * Corpo do "listar" de cliente: o 1º filtro vai em qtype/query e os demais em grid_param (todos com E).
     * Sem filtro nenhum = todos os clientes (cliente.id > 0).
     * $idsCliente (0.13.5.5, filtro Produto): restringe a esses clientes com cliente.id IN (...), sempre no grid_param.
     * @param array<string,mixed> $f @param list<int>|null $idsCliente @return array<string,string>
     */
    public static function corpoBusca(array $f, int $pagina, int $rp, ?array $idsCliente = null): array
    {
        $cond = [];
        if ($f['id'] > 0) {
            $cond[] = ['cliente.id', '=', (string) $f['id']];
        }
        if ($f['ativo'] !== '') {
            $cond[] = ['cliente.ativo', '=', $f['ativo']];
        }
        if ($f['condominio'] > 0) {
            $cond[] = ['cliente.id_condominio', '=', (string) $f['condominio']];
        }
        if ($f['tipo'] > 0) {
            $cond[] = ['cliente.id_tipo_cliente', '=', (string) $f['tipo']];
        }
        if ($f['razao'] !== '') {
            $cond[] = ['cliente.razao', 'L', '%' . $f['razao'] . '%'];
        }
        if ($f['fantasia'] !== '') {
            $cond[] = ['cliente.fantasia', 'L', '%' . $f['fantasia'] . '%'];
        }
        $primeiro = array_shift($cond) ?? ['cliente.id', '>', '0'];
        if ($idsCliente !== null) {
            $cond[] = ['cliente.id', 'IN', implode(',', array_map('intval', $idsCliente))];
        }
        $corpo = ['qtype' => $primeiro[0], 'oper' => $primeiro[1], 'query' => $primeiro[2], 'page' => (string) $pagina, 'rp' => (string) $rp,
            'sortname' => 'cliente.' . ($f['ordem'] ?? 'razao'), 'sortorder' => ($f['dir'] ?? 'asc') === 'desc' ? 'desc' : 'asc'];
        if ($cond) {
            $corpo['grid_param'] = json_encode(array_map(fn($c) => ['TB' => $c[0], 'OP' => $c[1], 'P' => $c[2]], $cond), JSON_UNESCAPED_UNICODE);
        }
        return $corpo;
    }

    // ------------------------------------------------------------------ listas dos filtros

    /** Condomínios e tipos de cliente da base (cache de 10 min). @return array<string,mixed> */
    public function opcoes(string $codigo): array
    {
        $ac = $this->acesso($codigo);
        if (is_string($ac)) {
            return ['ok' => false, 'erro' => $ac];
        }
        $avisos = [];
        $cond = $this->cache("cond_$codigo", function () use ($ac, &$avisos) {
            $r = $this->listar($ac, 'cliente_condominio', ['qtype' => 'cliente_condominio.id', 'oper' => '>', 'query' => '0',
                'page' => '1', 'rp' => '5000', 'sortname' => 'cliente_condominio.condominio', 'sortorder' => 'asc']);
            if ($e = self::erro($r)) {
                $avisos[] = 'Condomínios: ' . $e;
                return null;
            }
            $l = [];
            foreach ((array) ($r['registros'] ?? []) as $x) {
                $nome = trim((string) ($x['condominio'] ?? $x['nome'] ?? $x['descricao'] ?? ''));
                if ((int) ($x['id'] ?? 0) > 0) {
                    $l[] = ['id' => (int) $x['id'], 'nome' => $nome !== '' ? $nome : '#' . $x['id']];
                }
            }
            return $l;
        });
        if ($cond === null) {
            $cond = $this->condominiosDoDicionario($codigo);   // plano B: nomes que o coletor de O.S. já guardou
        }
        $tipos = $this->cache("tipo_$codigo", function () use ($ac, &$avisos) {
            $ultimo = '';
            foreach (self::TAB_TIPOS as $tab) {
                $r = $this->listar($ac, $tab, ['qtype' => "$tab.id", 'oper' => '>', 'query' => '0', 'page' => '1', 'rp' => '500',
                    'sortname' => "$tab.id", 'sortorder' => 'asc']);
                if ($e = self::erro($r)) {
                    $ultimo = $e;
                    continue;
                }
                $l = [];
                foreach ((array) ($r['registros'] ?? []) as $x) {
                    $l[] = ['id' => (int) ($x['id'] ?? 0), 'nome' => self::nomeTipo($x)];
                }
                return $l;
            }
            $avisos[] = 'Tipos de cliente: ' . $ultimo;
            return null;
        });
        // 0.13.5.5: lista do filtro Produto = serviços/produtos que aparecem em algum contrato da base (vd_contratos_produtos)
        $produtos = $this->cache("prod_$codigo", function () use ($ac, &$avisos) {
            $usados = [];
            $t = self::TAB_PRODUTOS;
            for ($pag = 1; $pag <= 20; $pag++) {
                $r = $this->listar($ac, $t, ['qtype' => "$t.id", 'oper' => '>', 'query' => '0', 'page' => (string) $pag, 'rp' => '5000',
                    'sortname' => "$t.id", 'sortorder' => 'asc']);
                if ($e = self::erro($r)) {
                    $avisos[] = 'Produtos (' . $t . '): ' . $e;
                    return null;
                }
                $regs = (array) ($r['registros'] ?? []);
                foreach ($regs as $x) {
                    if (is_array($x) && ($i = (int) ($x['id_produto'] ?? 0)) > 0) {
                        $usados[$i] = true;
                    }
                }
                if (count($regs) < 5000) {
                    break;
                }
            }
            $l = [];
            foreach (array_chunk(array_keys($usados), 300) as $lote) {
                $r = $this->listar($ac, self::TAB_SERVICOS, ['qtype' => self::TAB_SERVICOS . '.id', 'oper' => '>', 'query' => '0', 'page' => '1', 'rp' => '5000',
                    'sortname' => self::TAB_SERVICOS . '.id', 'sortorder' => 'asc',
                    'grid_param' => json_encode([['TB' => self::TAB_SERVICOS . '.id', 'OP' => 'IN', 'P' => implode(',', $lote)]])]);
                if ($e = self::erro($r)) {
                    $avisos[] = 'Produtos (' . self::TAB_SERVICOS . '): ' . $e;
                    return null;
                }
                foreach ((array) ($r['registros'] ?? []) as $x) {
                    if (is_array($x) && in_array((int) ($x['id'] ?? 0), $lote, true)) {
                        $nome = trim((string) ($x['descricao'] ?? $x['nome'] ?? ''));
                        $l[] = ['id' => (int) $x['id'], 'nome' => $nome !== '' ? $nome : '#' . $x['id']];
                    }
                }
            }
            return $l;
        });
        usort($cond, fn($a, $b) => strcasecmp($a['nome'], $b['nome']));
        $produtos = $produtos ?? [];
        usort($produtos, fn($a, $b) => strcasecmp($a['nome'], $b['nome']));
        return ['ok' => true, 'condominios' => $cond, 'tipos' => $tipos ?? [], 'produtos' => $produtos, 'avisos' => $avisos];
    }

    /** @param array<string,mixed> $x */
    private static function nomeTipo(array $x): string
    {
        foreach (self::NOME_TIPO as $k) {
            if (trim((string) ($x[$k] ?? '')) !== '') {
                return trim((string) $x[$k]);
            }
        }
        return '#' . ($x['id'] ?? '?');
    }

    /** @return list<array{id:int,nome:string}> */
    private function condominiosDoDicionario(string $codigo): array
    {
        $out = [];
        if (!$this->db->tableExists('glpi_plugin_painelixc_dicionarios')) {
            return $out;
        }
        $base = $this->db->request(['SELECT' => ['id'], 'FROM' => 'glpi_plugin_painelixc_bases', 'WHERE' => ['codigo' => $codigo]])->current();
        if (!$base) {
            return $out;
        }
        foreach ($this->db->request(['FROM' => 'glpi_plugin_painelixc_dicionarios', 'WHERE' => ['plugin_painelixc_bases_id' => (int) $base['id'], 'tipo' => 'condominios']]) as $r) {
            $out[] = ['id' => (int) ($r['ixc_id'] ?? 0), 'nome' => (string) ($r['nome'] ?? '')];
        }
        return array_values(array_filter($out, fn($c) => $c['id'] > 0));
    }

    /** Cache do GLPI (PSR-16) quando existir; sem cache, só executa. Não guarda falha (null). */
    private function cache(string $chave, callable $gerar): mixed
    {
        /** @var \Psr\SimpleCache\CacheInterface|null $GLPI_CACHE */
        global $GLPI_CACHE;
        $chave = 'painelixc_cli_' . $chave;
        try {
            if ($GLPI_CACHE && ($v = $GLPI_CACHE->get($chave)) !== null) {
                return $v;
            }
        } catch (\Throwable $e) {
            // sem cache
        }
        $v = $gerar();
        if ($v !== null) {
            try {
                $GLPI_CACHE?->set($chave, $v, self::TTL_LISTAS);
            } catch (\Throwable $e) {
                // sem cache
            }
        }
        return $v;
    }

    // ------------------------------------------------------------------ busca

    public const MAX_CLIENTES_PRODUTO = 5000;

    /**
     * 0.13.5.5 — clientes que têm o Serviço/Produto em algum contrato (como na aba "Produtos" do contrato):
     * vd_contratos_produtos.id_produto = X → contratos (id_contrato) + planos (id_vd_contrato, sem contrato) →
     * cliente_contrato → id_cliente. Cache de 10 min por base+produto (a paginação reaproveita).
     * @return list<int>|string  lista de ids de cliente, ou mensagem de erro
     */
    private function clientesDoProduto(array $ac, string $codigo, int $produto, array &$avisos): array|string
    {
        $r = $this->cache("cliprod_{$codigo}_$produto", function () use ($ac, $produto) {
            $t = self::TAB_PRODUTOS;
            $contratos = $planos = [];
            for ($pag = 1; $pag <= 10; $pag++) {
                $r = $this->listar($ac, $t, ['qtype' => "$t.id_produto", 'oper' => '=', 'query' => (string) $produto, 'page' => (string) $pag, 'rp' => '5000',
                    'sortname' => "$t.id", 'sortorder' => 'asc']);
                if ($e = self::erro($r)) {
                    return ['erro' => 'Produtos dos contratos (' . $t . '): ' . $e];
                }
                $regs = (array) ($r['registros'] ?? []);
                foreach ($regs as $x) {
                    if (!is_array($x) || (int) ($x['id_produto'] ?? 0) !== $produto) {
                        continue;   // proteção: se o filtro não pegou, ignora
                    }
                    if (($k = (int) ($x['id_contrato'] ?? 0)) > 0) {
                        $contratos[$k] = true;
                    } elseif (($pl = (int) ($x['id_vd_contrato'] ?? 0)) > 0) {
                        $planos[$pl] = true;
                    }
                }
                if (count($regs) < 5000) {
                    break;
                }
            }
            $clientes = [];
            $porLote = function (string $campo, array $ids) use ($ac, &$clientes): ?string {
                foreach (array_chunk($ids, 300) as $lote) {
                    $r = $this->listar($ac, 'cliente_contrato', ['qtype' => 'cliente_contrato.id', 'oper' => '>', 'query' => '0', 'page' => '1', 'rp' => '5000',
                        'sortname' => 'cliente_contrato.id', 'sortorder' => 'asc',
                        'grid_param' => json_encode([['TB' => "cliente_contrato.$campo", 'OP' => 'IN', 'P' => implode(',', $lote)]])]);
                    if ($e = self::erro($r)) {
                        return 'Contratos (cliente_contrato): ' . $e;
                    }
                    foreach ((array) ($r['registros'] ?? []) as $c) {
                        if (is_array($c) && in_array((int) ($c[$campo] ?? 0), $lote, true) && ($i = (int) ($c['id_cliente'] ?? 0)) > 0) {
                            $clientes[$i] = true;
                        }
                    }
                }
                return null;
            };
            if ($contratos && ($e = $porLote('id', array_keys($contratos)))) {
                return ['erro' => $e];
            }
            if ($planos && ($e = $porLote('id_vd_contrato', array_keys($planos)))) {
                return ['erro' => $e];
            }
            $ids = array_keys($clientes);
            sort($ids);
            return ['ids' => $ids];
        });
        if (isset($r['erro'])) {
            return $r['erro'];
        }
        $ids = $r['ids'] ?? [];
        if (count($ids) > self::MAX_CLIENTES_PRODUTO) {
            $avisos[] = 'O produto aparece em ' . count($ids) . ' clientes; a busca considera os ' . self::MAX_CLIENTES_PRODUTO . ' primeiros (por ID). Use mais filtros.';
            $ids = array_slice($ids, 0, self::MAX_CLIENTES_PRODUTO);
        }
        return $ids;
    }

    /** Uma página de clientes, já com os contratos. @param array<string,mixed> $f @return array<string,mixed> */
    public function buscar(array $f): array
    {
        $ac = $this->acesso($f['base']);
        if (is_string($ac)) {
            return ['ok' => false, 'erro' => $ac];
        }
        $avisos = [];
        $ids = null;
        if ($f['produto'] > 0) {
            $ids = $this->clientesDoProduto($ac, $f['base'], $f['produto'], $avisos);
            if (is_string($ids)) {
                return ['ok' => false, 'erro' => 'IXC (' . $ac['nome'] . '): ' . $ids];
            }
            if ($ids === []) {
                return ['ok' => true, 'base' => $f['base'], 'total' => 0, 'pagina' => 1, 'por_pagina' => $f['rp'], 'clientes' => [], 'avisos' => $avisos];
            }
        }
        $r = $this->listar($ac, 'cliente', self::corpoBusca($f, $f['pagina'], $f['rp'], $ids));
        if ($e = self::erro($r)) {
            return ['ok' => false, 'erro' => 'IXC (' . $ac['nome'] . '): ' . $e];
        }
        $clientes = array_map([self::class, 'cliente'], array_values(array_filter((array) ($r['registros'] ?? []), 'is_array')));
        $this->juntarContratos($ac, $clientes, $avisos);
        $this->juntarProdutos($ac, $clientes, $avisos);
        return ['ok' => true, 'base' => $f['base'], 'total' => (int) ($r['total'] ?? count($clientes)), 'pagina' => $f['pagina'],
            'por_pagina' => $f['rp'], 'clientes' => $clientes, 'avisos' => $avisos];
    }

    /** Só os campos que a tela usa. @param array<string,mixed> $x @return array<string,mixed> */
    public static function cliente(array $x): array
    {
        return [
            'id'            => (int) ($x['id'] ?? 0),
            'razao'         => trim((string) ($x['razao'] ?? '')),
            'fantasia'      => trim((string) ($x['fantasia'] ?? '')),
            'ativo'         => (string) ($x['ativo'] ?? ''),
            'tipo_pessoa'   => (string) ($x['tipo_pessoa'] ?? ''),
            'id_tipo'       => (int) ($x['id_tipo_cliente'] ?? 0),
            'id_condominio' => (int) ($x['id_condominio'] ?? 0),
            'contratos'     => [],
        ];
    }

    /** @param array<string,mixed> $x @return array<string,mixed> */
    public static function contrato(array $x): array
    {
        $d = (string) ($x['data_ativacao'] ?? '');
        return [
            'id'             => (int) ($x['id'] ?? 0),
            'plano'          => trim((string) ($x['contrato'] ?? '')),
            'status'         => (string) ($x['status'] ?? ''),
            'status_acesso'  => (string) ($x['status_internet'] ?? ''),
            'data_ativacao'  => preg_match('/^[1-9]\d{3}-\d{2}-\d{2}/', $d) ? substr($d, 0, 10) : '',
            'id_plano'       => (int) ($x['id_vd_contrato'] ?? 0),
            'produtos'       => [],
        ];
    }

    /**
     * 0.13.4 — produtos de cada contrato (igual à aba "Produtos" do contrato no IXC): os ligados ao contrato (id_contrato)
     * e os do plano de venda (id_vd_contrato, sem contrato). Nome do Serviço/Produto pela tabela "produtos".
     * Falha vira aviso (a tela continua com os contratos). Só sai descrição, serviço/produto, quantidade e vínculo.
     * @param list<array<string,mixed>> $clientes
     */
    private function juntarProdutos(array $ac, array &$clientes, array &$avisos): void
    {
        $idsContrato = $idsPlano = [];
        foreach ($clientes as $cl) {
            foreach ($cl['contratos'] as $k) {
                $idsContrato[] = $k['id'];
                if ($k['id_plano'] > 0) {
                    $idsPlano[] = $k['id_plano'];
                }
            }
        }
        $idsContrato = array_values(array_unique(array_filter($idsContrato)));
        $idsPlano = array_values(array_unique($idsPlano));
        if (!$idsContrato) {
            return;
        }
        $tab = self::TAB_PRODUTOS;
        $porContrato = $porPlano = [];
        $erro = null;
        $buscar = function (string $campo, array $ids) use ($ac, $tab, &$erro): array {
            $out = [];
            foreach (array_chunk($ids, 300) as $lote) {
                $r = $this->listar($ac, $tab, ['qtype' => "$tab.id", 'oper' => '>', 'query' => '0', 'page' => '1', 'rp' => '5000',
                    'sortname' => "$tab.id", 'sortorder' => 'asc',
                    'grid_param' => json_encode([['TB' => "$tab.$campo", 'OP' => 'IN', 'P' => implode(',', $lote)]])]);
                if ($e = self::erro($r)) {
                    $erro = $e;
                    return [];
                }
                foreach ((array) ($r['registros'] ?? []) as $x) {
                    // proteção: se o IN não filtrou, ignora o que não é do lote
                    if (is_array($x) && in_array((int) ($x[$campo] ?? 0), $lote, true)) {
                        $out[] = $x;
                    }
                }
            }
            return $out;
        };
        foreach ($buscar('id_contrato', $idsContrato) as $x) {
            $porContrato[(int) $x['id_contrato']][] = $x;
        }
        if ($erro === null && $idsPlano) {
            foreach ($buscar('id_vd_contrato', $idsPlano) as $x) {
                if ((int) ($x['id_contrato'] ?? 0) === 0) {   // do plano (não amarrado a um contrato)
                    $porPlano[(int) $x['id_vd_contrato']][] = $x;
                }
            }
        }
        if ($erro !== null) {
            $avisos[] = 'Produtos dos contratos (' . $tab . '): ' . $erro;
            return;
        }
        // nome do Serviço/Produto
        $idsServ = [];
        foreach (array_merge(...array_values($porContrato ?: [[]]), ...array_values($porPlano ?: [[]])) as $x) {
            if (($i = (int) ($x['id_produto'] ?? 0)) > 0) {
                $idsServ[$i] = true;
            }
        }
        $nomeServ = [];
        foreach (array_chunk(array_keys($idsServ), 300) as $lote) {
            $r = $this->listar($ac, self::TAB_SERVICOS, ['qtype' => self::TAB_SERVICOS . '.id', 'oper' => '>', 'query' => '0', 'page' => '1', 'rp' => '5000',
                'sortname' => self::TAB_SERVICOS . '.id', 'sortorder' => 'asc',
                'grid_param' => json_encode([['TB' => self::TAB_SERVICOS . '.id', 'OP' => 'IN', 'P' => implode(',', $lote)]])]);
            if ($e = self::erro($r)) {
                $avisos[] = 'Nomes dos serviços/produtos (' . self::TAB_SERVICOS . '): ' . $e;
                break;
            }
            foreach ((array) ($r['registros'] ?? []) as $x) {
                if (is_array($x) && in_array((int) ($x['id'] ?? 0), $lote, true)) {
                    $nomeServ[(int) $x['id']] = trim((string) ($x['descricao'] ?? $x['nome'] ?? ''));
                }
            }
        }
        $produto = static function (array $x, string $vinculo) use ($nomeServ): array {
            $ip = (int) ($x['id_produto'] ?? 0);
            $q = $x['qtde'] ?? $x['quantidade'] ?? '';
            return [
                'descricao' => mb_substr(trim((string) ($x['descricao'] ?? $x['descricao_produto'] ?? '')), 0, 255),
                'servico'   => $ip > 0 ? ($nomeServ[$ip] ?? '#' . $ip) : '',
                'qtde'      => is_numeric($q) ? (float) $q + 0 : null,
                'vinculo'   => $vinculo,
            ];
        };
        foreach ($clientes as &$cl) {
            foreach ($cl['contratos'] as &$k) {
                $l = [];
                foreach ($porContrato[$k['id']] ?? [] as $x) {
                    $l[] = $produto($x, 'Contrato');
                }
                foreach ($k['id_plano'] > 0 ? ($porPlano[$k['id_plano']] ?? []) : [] as $x) {
                    $l[] = $produto($x, 'Plano');
                }
                $k['produtos'] = array_slice($l, 0, self::MAX_PRODUTOS);
            }
            unset($k);
            foreach ($cl['contratos'] as &$k) {
                unset($k['id_plano']);   // só serviu para achar os produtos do plano
            }
            unset($k);
        }
        unset($cl);
    }

    /**
     * Contratos dos clientes da página: um "listar" com id_cliente IN (...); se a base recusar o IN, um por cliente.
     * @param list<array<string,mixed>> $clientes
     */
    private function juntarContratos(array $ac, array &$clientes, array &$avisos): void
    {
        $ids = array_values(array_filter(array_column($clientes, 'id')));
        if (!$ids) {
            return;
        }
        $porCliente = [];
        foreach (array_chunk($ids, 200) as $lote) {
            $r = $this->listar($ac, 'cliente_contrato', ['qtype' => 'cliente_contrato.id', 'oper' => '>', 'query' => '0', 'page' => '1', 'rp' => '5000',
                'sortname' => 'cliente_contrato.id', 'sortorder' => 'asc',
                'grid_param' => json_encode([['TB' => 'cliente_contrato.id_cliente', 'OP' => 'IN', 'P' => implode(',', $lote)]])]);
            $regs = self::erro($r) === null ? (array) ($r['registros'] ?? []) : null;
            // proteção: se o IN não filtrou (veio contrato de cliente fora do lote), descarta e vai um por um
            if ($regs !== null && array_filter($regs, fn($c) => !in_array((int) ($c['id_cliente'] ?? 0), $lote, true))) {
                $regs = null;
            }
            if ($regs === null) {
                $regs = [];
                foreach ($lote as $id) {
                    $r1 = $this->listar($ac, 'cliente_contrato', ['qtype' => 'cliente_contrato.id_cliente', 'oper' => '=', 'query' => (string) $id,
                        'page' => '1', 'rp' => '100', 'sortname' => 'cliente_contrato.id', 'sortorder' => 'asc']);
                    if ($e = self::erro($r1)) {
                        $avisos[] = 'Contratos do cliente ' . $id . ': ' . $e;
                        continue;
                    }
                    $regs = array_merge($regs, (array) ($r1['registros'] ?? []));
                }
            }
            foreach ($regs as $c) {
                if (is_array($c)) {
                    $porCliente[(int) ($c['id_cliente'] ?? 0)][] = self::contrato($c);
                }
            }
        }
        foreach ($clientes as &$cl) {
            $cl['contratos'] = $porCliente[$cl['id']] ?? [];
        }
        unset($cl);
    }

    // ------------------------------------------------------------------ CSV

    public const STATUS_CONTRATO = ['A' => 'Ativo', 'I' => 'Inativo', 'P' => 'Pré-contrato', 'N' => 'Negativado', 'D' => 'Desistiu', 'C' => 'Cancelado'];
    public const STATUS_ACESSO   = ['A' => 'Ativo', 'D' => 'Desativado', 'CM' => 'Bloqueio manual', 'CA' => 'Bloqueio automático',
        'FA' => 'Financeiro em atraso', 'AA' => 'Aguardando assinatura'];

    /** Todos os clientes do filtro (até LIMITE_CSV) em CSV para o Excel (";", UTF-8 com BOM). @return array{ok:bool, csv?:string, erro?:string, total?:int} */
    public function csv(array $f): array
    {
        $ac = $this->acesso($f['base']);
        if (is_string($ac)) {
            return ['ok' => false, 'erro' => $ac];
        }
        $op = $this->opcoes($f['base']);
        $nomeCond = array_column($op['condominios'] ?? [], 'nome', 'id');
        $nomeTipo = array_column($op['tipos'] ?? [], 'nome', 'id');
        $todos = [];
        $avisos = [];
        $total = 0;
        $ids = null;
        if ($f['produto'] > 0) {
            $ids = $this->clientesDoProduto($ac, $f['base'], $f['produto'], $avisos);
            if (is_string($ids)) {
                return ['ok' => false, 'erro' => 'IXC (' . $ac['nome'] . '): ' . $ids];
            }
        }
        for ($pag = 1; count($todos) < self::LIMITE_CSV && $ids !== []; $pag++) {
            $r = $this->listar($ac, 'cliente', self::corpoBusca($f, $pag, 500, $ids));
            if ($e = self::erro($r)) {
                return ['ok' => false, 'erro' => 'IXC (' . $ac['nome'] . '): ' . $e];
            }
            $regs = array_values(array_filter((array) ($r['registros'] ?? []), 'is_array'));
            $total = max($total, (int) ($r['total'] ?? 0));
            if (!$regs) {
                break;
            }
            $lote = array_map([self::class, 'cliente'], $regs);
            $this->juntarContratos($ac, $lote, $avisos);
            $this->juntarProdutos($ac, $lote, $avisos);
            array_push($todos, ...$lote);
            $temTotal = isset($r['total']) && is_numeric($r['total']);
            if (count($regs) < 500 || ($temTotal && count($todos) >= $total)) {
                break;   // sem "total" confiável, segue até vir uma página incompleta
            }
        }
        $todos = array_slice($todos, 0, self::LIMITE_CSV);
        $total = max($total, count($todos));
        $cel = static function ($v): string {
            $s = str_replace(["\r\n", "\r"], "\n", (string) $v);
            if (preg_match('/^[=+\-@\t]/', $s) && !preg_match('/^-?\d+([.,]\d+)?$/', $s)) {
                $s = "'" . $s;
            }
            return preg_match('/[";\n]|^\s|\s$/', $s) ? '"' . str_replace('"', '""', $s) . '"' : $s;
        };
        $linhas = [['ID', 'Nome Fantasia', 'Razão Social', 'Tipo de cliente', 'Pessoa', 'Condomínio', 'Ativo', 'Produtos (descrição)',
            'Qtd. contratos', 'Contratos (nº · plano · status · acesso · ativação)', 'Produtos por contrato (nº: descrição [serviço/produto] × qtde)']];
        foreach ($todos as $c) {
            $prods = [];
            $porK = [];
            foreach ($c['contratos'] as $k) {
                foreach ($k['produtos'] as $pp) {
                    $prods[] = $pp['descricao'] ?: $pp['servico'];
                    $porK[] = $k['id'] . ': ' . ($pp['descricao'] ?: '—') . ($pp['servico'] !== '' ? ' [' . $pp['servico'] . ']' : '')
                        . ($pp['qtde'] !== null ? ' × ' . str_replace('.', ',', (string) $pp['qtde']) : '');
                }
            }
            $prods = array_values(array_unique(array_filter($prods)));
            $linhas[] = [$c['id'], $c['fantasia'], $c['razao'], $c['id_tipo'] ? ($nomeTipo[$c['id_tipo']] ?? '#' . $c['id_tipo']) : '',
                ['F' => 'Física', 'J' => 'Jurídica'][$c['tipo_pessoa']] ?? $c['tipo_pessoa'],
                $c['id_condominio'] ? ($nomeCond[$c['id_condominio']] ?? '#' . $c['id_condominio']) : '',
                ['S' => 'Sim', 'N' => 'Não'][$c['ativo']] ?? $c['ativo'], implode(' / ', $prods), count($c['contratos']),
                implode(' | ', array_map(fn($k) => implode(' · ', array_filter([$k['id'], $k['plano'], self::STATUS_CONTRATO[$k['status']] ?? $k['status'],
                    self::STATUS_ACESSO[$k['status_acesso']] ?? $k['status_acesso'],
                    $k['data_ativacao'] ? implode('/', array_reverse(explode('-', $k['data_ativacao']))) : ''], 'strlen')), $c['contratos'])),
                implode(' | ', $porK)];
        }
        $csv = "\xEF\xBB\xBF" . implode("\r\n", array_map(fn($l) => implode(';', array_map($cel, $l)), $linhas)) . "\r\n";
        // 0.13.2: o que o usuário precisa saber sobre o arquivo (vai no cabeçalho X-Pixc-Aviso e aparece na tela)
        if ($total > count($todos)) {
            array_unshift($avisos, 'CSV com ' . count($todos) . ' de ' . $total . ' clientes (limite de ' . self::LIMITE_CSV . '); refine os filtros para exportar o resto.');
        }
        return ['ok' => true, 'csv' => $csv, 'total' => $total, 'exportados' => count($todos), 'avisos' => array_values(array_unique($avisos))];
    }

    // ------------------------------------------------------------------ diagnóstico (Configuração)

    /** Nomes dos campos (sem valores) de 1 registro de cada tabela usada — para conferir se a base usa os mesmos nomes. */
    public function diagnostico(string $codigo): array
    {
        $ac = $this->acesso($codigo);
        if (is_string($ac)) {
            return ['ok' => false, 'erro' => $ac];
        }
        $out = ['ok' => true, 'base' => $codigo, 'tabelas' => []];
        foreach (array_merge(['cliente', 'cliente_contrato', 'cliente_condominio'], self::TAB_TIPOS, [self::TAB_PRODUTOS, self::TAB_SERVICOS]) as $tab) {
            $r = $this->listar($ac, $tab, ['qtype' => "$tab.id", 'oper' => '>', 'query' => '0', 'page' => '1', 'rp' => '1', 'sortname' => "$tab.id", 'sortorder' => 'desc']);
            $reg = $r['registros'][0] ?? null;
            $out['tabelas'][$tab] = ($e = self::erro($r)) ? ['erro' => $e] : ['total' => (int) ($r['total'] ?? 0), 'campos' => is_array($reg) ? array_keys($reg) : []];
        }
        return $out;
    }
}
