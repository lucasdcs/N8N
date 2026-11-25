<?php

namespace GlpiPlugin\Painelbot;

use PDO;

/**
 * Leitura do schema `ixc` (Postgres do n8n) que alimenta os workflows whatsapp-ixc
 * (01 notificações, 02 lembretes de visita, 03 bot de escalas/comandos, 04 sync da planilha ESCALAS).
 * Origem: painelixc 0.15.0 (P15-1, descartada), movida para o plugin próprio.
 *
 * Conexão: Configurar > Geral > Painel do Bot (host/porta/banco/usuário/senha cifrada).
 * O usuário do Postgres do GLPI (painel_glpi) não lê `ixc.empresas.auth` (tokens do IXC): a consulta nunca pede essa coluna.
 */
final class Bot
{
    /** Ordem dos dias em `ixc.escala_base` (seg..dom), isodow 1..7. */
    public const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];

    /** Parâmetros mostrados na visão geral (os demais aparecem em "Parâmetros"). */
    public const PARAM_PRINCIPAIS = ['envio', 'envio_lembretes', 'lembrete_privado', 'waha_session', 'grupo_automacao',
        'escala_ler_porto_belo', 'escala_trocar_nomes', 'planta_ativo', 'realerta_horarios', 'semtec_min', 'escalar_min'];

    private ?PDO $pdo = null;

    /** @param array<string,mixed>|null $cfg só para teste; padrão = Configuração do plugin */
    public function __construct(private ?array $cfg = null)
    {
    }

    /** Dados da conexão sem a senha (para a tela). @return array{host:string,porta:int,banco:string,usuario:string,tem_senha:bool,pronta:bool} */
    public function conexao(): array
    {
        $c = $this->cfg ?? Config::todos();
        $r = [
            'host'      => (string) ($c['pg_host'] ?? ''),
            'porta'     => (int) ($c['pg_porta'] ?? 0),
            'banco'     => (string) ($c['pg_banco'] ?? ''),
            'usuario'   => (string) ($c['pg_usuario'] ?? ''),
            'tem_senha' => (string) ($c['pg_senha'] ?? '') !== '',
        ];
        $r['pronta'] = $r['host'] !== '' && $r['porta'] > 0 && $r['banco'] !== '' && $r['usuario'] !== '' && $r['tem_senha'];
        return $r;
    }

    /** Abre (uma vez) a conexão. Lança \RuntimeException com mensagem para a tela. */
    public function pdo(): PDO
    {
        if ($this->pdo !== null) {
            return $this->pdo;
        }
        if (!extension_loaded('pdo_pgsql')) {
            throw new \RuntimeException('O PHP do servidor não tem a extensão pdo_pgsql. Instale com: apt install php-pgsql && systemctl restart apache2');
        }
        $cx = $this->conexao();
        if (!$cx['pronta']) {
            throw new \RuntimeException('Conexão com o banco do bot não configurada (Configurar > Geral > Painel do Bot).');
        }
        $c = $this->cfg ?? Config::todos();
        $senha = (string) ($c['pg_senha'] ?? '');
        if ($this->cfg === null) {
            $senha = (string) (new \GLPIKey())->decrypt($senha);
        }
        $dsn = sprintf('pgsql:host=%s;port=%d;dbname=%s;connect_timeout=5', $cx['host'], $cx['porta'], $cx['banco']);
        try {
            $this->pdo = new PDO($dsn, $cx['usuario'], $senha, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
        } catch (\PDOException $e) {
            throw new \RuntimeException('Não conectou no banco do bot (' . $cx['host'] . ':' . $cx['porta'] . '/' . $cx['banco'] . '): ' . self::limparErro($e->getMessage()));
        }
        $this->pdo->exec("SET TIME ZONE 'America/Sao_Paulo'");
        return $this->pdo;
    }

    /** Mensagem do driver sem a senha e curta. */
    public static function limparErro(string $m): string
    {
        $m = preg_replace('/password=\S+/i', 'password=***', $m) ?? $m;
        return mb_substr(trim(preg_replace('/^SQLSTATE\[[^\]]+\]\s*\[\d+\]\s*/', '', $m) ?? $m), 0, 300);
    }

    /** @return list<array<string,mixed>> */
    private function q(string $sql, array $p = []): array
    {
        try {
            $st = $this->pdo()->prepare($sql);
            $st->execute($p);
            return $st->fetchAll();
        } catch (\PDOException $e) {
            if ($e->getCode() === '42501') {   // insufficient_privilege: banco recriado ou usuário sem as permissões
                throw new \RuntimeException('O usuário ' . $this->conexao()['usuario'] . ' não tem permissão de leitura no schema ixc. Rode de novo o painelbot/sql/02-usuario-painel.sql no Postgres do bot.');
            }
            if ($e->getCode() === '42P01') {   // undefined_table
                throw new \RuntimeException('Tabela do bot não encontrada (' . self::limparErro($e->getMessage()) . '). Confira se o banco configurado é o do whatsapp-ixc.');
            }
            throw $e;
        }
    }

    /** Conexão funciona? Para a aba de Configuração. @return array{ok:bool,msg:string} */
    public function testar(): array
    {
        try {
            $r = $this->q("SELECT (SELECT count(*) FROM ixc.locais) AS locais,
                                  to_regclass('ixc.mensagens') IS NOT NULL AS mensagens,
                                  to_regclass('ixc.perguntas') IS NOT NULL AS perguntas")[0];
            $tab = ($r['mensagens'] && $r['perguntas']) ? 'tabelas de mensagens e perguntas instaladas'
                : 'faltam as tabelas de mensagens/perguntas (rode o painelbot/sql/01-mensagens-perguntas.sql)';
            return ['ok' => true, 'msg' => 'Conectado: ' . (int) $r['locais'] . ' shoppings no bot · ' . $tab . '.'];
        } catch (\Throwable $e) {
            return ['ok' => false, 'msg' => $e instanceof \RuntimeException ? $e->getMessage() : self::limparErro($e->getMessage())];
        }
    }

    /**
     * Dados das seções que o perfil vê (Direito::secoes()), numa chamada. Seção não liberada não vem no JSON.
     * @param list<string> $secoes @return array<string,mixed>
     */
    public function dados(array $secoes): array
    {
        $tem = fn(string ...$s) => array_intersect($s, $secoes) !== [];
        $hoje = $this->q("SELECT current_date AS d, extract(isodow FROM current_date)::int AS dow, to_char(now(), 'HH24:MI') AS hora")[0];
        $out = [
            'ok'         => true,
            'secoes'     => array_values($secoes),
            'hoje'       => (string) $hoje['d'],
            'dia_hoje'   => self::DIAS[((int) $hoje['dow']) - 1],
            'dia_amanha' => self::DIAS[((int) $hoje['dow']) % 7],
            'hora'       => (string) $hoje['hora'],
        ];
        if ($tem('geral', 'eventos')) {
            // os cartões da visão geral usam só os parâmetros principais (modo de envio, tempos, sessão); a lista completa é da seção Parâmetros
            $out['parametros'] = array_values(array_filter($this->parametros(), fn($p) => $p['principal']));
            $out['empresas']   = $this->empresas();
            $out['eventos']    = $this->resumoEventos();
            $out['ultimos']    = $this->ultimosEventos(40);
            $out['escala_sync'] = $this->q('SELECT max(sincronizado) AS em, count(*) FILTER (WHERE data = current_date) AS hoje, count(*) FILTER (WHERE data = current_date + 1) AS amanha FROM ixc.escala_dia')[0];
            $out['contagens']  = $this->q('SELECT (SELECT count(*) FROM ixc.locais) AS shoppings, (SELECT count(*) FROM ixc.tecnicos) AS tecnicos,
                                                  (SELECT count(*) FROM ixc.contatos_setor WHERE ativo) AS contatos')[0];
        }
        if ($tem('shoppings')) {
            $out['shoppings'] = $this->shoppings();
            $out['apelidos'] = $this->apelidos();
        }
        if ($tem('tecnicos', 'contatos')) {
            $out['tecnicos'] = $this->tecnicos();
            $out['contatos'] = $this->contatos();
        }
        if ($tem('shoppings', 'tecnicos', 'contatos')) {
            $out['apoio'] = $this->apoio();   // 0.3.0: listas dos formulários (bases, grupos, pessoas)
        }
        if ($tem('parametros')) {
            $out['parametros'] = $this->parametros();   // lista completa (substitui a dos cartões)
            $out['feriados']   = $this->q("SELECT data::text AS data, coalesce(empresa, '') AS empresa, coalesce(id_condominio, '') AS id_condominio, descricao FROM ixc.feriados WHERE data >= current_date ORDER BY data LIMIT 20");
        }
        if ($tem('mensagens', 'variaveis')) {
            $out['mensagens'] = $this->mensagens();
            $out['variaveis'] = $this->variaveis();   // 0.4.1
            $out['variaveis_bot'] = $this->variaveisBot();   // 0.4.2
            $out['shoppings_lista'] = $this->listaShoppings();   // 0.4.2 (variável por shopping)
            $out['perguntas'] = Direito::ler(Direito::PERGUNTAS) ? $this->perguntas() : null;
        }
        if ($tem('operacao')) {   // 0.5.0: o status do n8n/WAHA vem à parte (acao.php operacao_status), aqui só o banco
            $out['parametros'] = $this->parametros();   // lista completa (modo, número de teste, sessão)
            $out['empresas'] ??= $this->empresas();
        }
        if ($tem('operacao', 'parametros')) {
            $out['parametros_tipos'] = Parametros::paraTela();
            $out['auditoria'] = $this->auditoria(40);
            $out['hora_num'] = (int) $this->q("SELECT extract(hour FROM now())::int AS h")[0]['h'];
        }
        return $out;
    }

    /** 0.5.0: últimas alterações feitas pelo painel (vazio se o sql/01 da 0.5.0 ainda não rodou). @return list<array<string,mixed>>|null */
    public function auditoria(int $limite): ?array
    {
        if (!$this->q("SELECT to_regclass('ixc.painel_auditoria') IS NOT NULL AS t")[0]['t']) {
            return null;
        }
        return $this->q("SELECT id, to_char(ts, 'DD/MM/YYYY HH24:MI') AS em, quem, acao, alvo, coalesce(antes, '') AS antes, coalesce(depois, '') AS depois
                           FROM ixc.painel_auditoria ORDER BY id DESC LIMIT " . max(1, min(200, $limite)));
    }

    /** As tabelas novas (sql/01) existem? @return array{mensagens:bool,perguntas:bool} */
    public function tabelasNovas(): array
    {
        $r = $this->q("SELECT to_regclass('ixc.mensagens') IS NOT NULL AS m, to_regclass('ixc.perguntas') IS NOT NULL AS p")[0];
        return ['mensagens' => (bool) $r['m'], 'perguntas' => (bool) $r['p']];
    }

    /**
     * 0.4.0: colunas da mensagem para a tela. to_jsonb aceita banco sem as colunas novas (ativo, criada_painel, frases…):
     * o painel 0.4.0 abre mesmo antes do sql/01 desta versão (só não grava).
     */
    public const SQL_MENSAGEM = "SELECT chave, grupo, ordem, titulo, wf, coalesce(exemplo, '') AS exemplo, texto_padrao, texto,
                                        coalesce(array_to_json(variaveis)::text, '[]') AS variaveis,
                                        to_char(atualizado, 'DD/MM/YYYY HH24:MI') AS atualizado, coalesce(atualizado_por, '') AS atualizado_por,
                                        coalesce((to_jsonb(m)->>'ativo')::boolean, true) AS ativo,
                                        coalesce((to_jsonb(m)->>'criada_painel')::boolean, false) AS nova,
                                        coalesce(to_jsonb(m)->'frases', '[]'::jsonb)::text AS frases,
                                        coalesce(to_jsonb(m)->>'grupos', 'todos') AS grupos,
                                        coalesce(to_jsonb(m)->>'criado_por', '') AS criado_por,
                                        coalesce(to_char((to_jsonb(m)->>'criado_em')::timestamptz, 'DD/MM/YYYY'), '') AS criado_em
                                   FROM ixc.mensagens m";

    /** @param array<string,mixed> $r @return array<string,mixed> */
    public static function linhaMensagem(array $r): array
    {
        $r['variaveis'] = json_decode((string) $r['variaveis'], true) ?: [];
        $r['frases'] = json_decode((string) $r['frases'], true) ?: [];
        $r['ordem'] = (int) $r['ordem'];
        $r['ativo'] = (bool) $r['ativo'];
        $r['nova'] = (bool) $r['nova'];
        // "personalizada" = texto do bot alterado no painel (as novas não têm padrão do bot)
        $r['personalizada'] = !$r['nova'] && $r['texto'] !== null && $r['texto'] !== $r['texto_padrao'];
        return $r;
    }

    /**
     * Catálogo de mensagens do bot (ixc.mensagens). texto = null quando segue o padrão.
     * 0.4.0: + ativo, mensagens novas (nova=true, chave resp.N, texto em texto_padrao, frases que acionam).
     * @return array{instalado:bool, itens:list<array<string,mixed>>, colunas040:bool}
     */
    public function mensagens(): array
    {
        if (!$this->tabelasNovas()['mensagens']) {
            return ['instalado' => false, 'itens' => [], 'colunas040' => false];
        }
        // 0.4.1: as variáveis (var.<nome>) moram na mesma tabela, mas têm aba própria
        $rows = array_map([self::class, 'linhaMensagem'], $this->q(self::SQL_MENSAGEM . " WHERE chave NOT LIKE 'var.%' AND chave NOT LIKE 'vsys.%' ORDER BY ordem, chave"));
        $c = $this->q("SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = 'ixc' AND table_name = 'mensagens' AND column_name = 'criada_painel'");
        return ['instalado' => true, 'itens' => $rows, 'colunas040' => ((int) ($c[0]['n'] ?? 0)) > 0];
    }

    /**
     * 0.4.2: variáveis que o bot preenche na hora nas mensagens do catálogo: descrição e exemplo padrão.
     * O painel pode trocar a descrição/exemplo e desativar (linha vsys.<nome> em ixc.mensagens; desativada = vazia em
     * todas as mensagens do bot, whatsapp-ixc 0.6.3).
     */
    public const VARS_BOT = [
        'alteracao'  => ['A alteração pedida no comando ixc', 'número do Técnico A → (41) 99999-0001'],
        'assunto'    => ['Assunto da O.S. no IXC', 'Ativação'],
        'ate'        => ['Fim da janela da visita (" (até 11:00)")', ' (até 11:00)'],
        'busca'      => ['O que a pessoa procurou e o bot não achou', 'xpto'],
        'cliente'    => ['Nome do cliente da O.S.', 'Cliente Exemplo Ltda'],
        'data'       => ['Data do dia (dd/mm)', '24/11'],
        'dia'        => ['Dia da semana abreviado', 'Seg'],
        'empresa'    => ['Base (IXC) do shopping', 'BASE'],
        'erro'       => ['Erro da leitura da planilha', 'a planilha não devolveu CSV (acesso mudou?)'],
        'fim'        => ['Hora de fim do atendimento/plantão', '18:00'],
        'grupo'      => ['Grupo de destino (simulação)', '1203630000000000@g.us'],
        'hora'       => ['Hora (da visita ou do agora)', '10:24'],
        'horario'    => ['Horário do dia (início–fim)', '10:00–22:00'],
        'inicio'     => ['Hora de início do atendimento/plantão', '10:00'],
        'janela'     => ['Quando é a visita ("em 1 hora")', 'em 1 hora'],
        'local'      => ['Referência do local da visita', 'Piso L2'],
        'loja'       => ['Loja do cliente', 'Loja 101'],
        'marcados'   => ['Quem é marcado com @ (sem isso ninguém é marcado)', '@5541999990001'],
        'minutos'    => ['Minutos até a visita', '10 minutos'],
        'na_empresa' => ['" na BASE" (busca de técnico)', ' na BASE'],
        'nome'       => ['Nome do contato do setor', 'Técnico A'],
        'onde'       => ['Shopping e loja da visita', 'Shopping Exemplo, Loja 101'],
        'plantao'    => ['Quem está de plantão (folga do atribuído)', 'Técnico B'],
        'protocolo'  => ['Protocolo da O.S.', '202611240001'],
        'quando'     => ['Quando o setor volta ("amanhã")', 'amanhã'],
        'regime'     => ['Regime do shopping (" · 12x36")', ' · 12x36'],
        'resumo'     => ['Resumo da mensagem da O.S.', 'Cliente sem sinal desde ontem.'],
        'rotulo'     => ['"Hoje" ou "Amanhã"', 'Hoje'],
        'semana'     => ['Horário da semana do shopping', 'Seg–Sáb 10:00–22:00 · Dom 14:00–20:00'],
        'setores'    => ['Setores citados (ir para o Recados)', 'Financeiro'],
        'shopping'   => ['Nome do shopping (também o {shopping} das mensagens novas)', 'Shopping Exemplo'],
        'status'     => ['Situação agora (" · 🟢 em atendimento…")', ' · 🟢 em atendimento (até 22:00)'],
        'tecnico'    => ['Técnico do dia / atribuído', 'Técnico A'],
        'telefone'   => ['Telefone (vira @ no WhatsApp)', '@5541999990001'],
        'tempo'      => ['Há quanto tempo o chamado está sem técnico', '2h'],
        'visita'     => ['Onde é a visita ("na *Loja*")', 'na *Loja Exemplo*'],
    ];

    /** 0.4.2: variáveis do bot com o que foi alterado no painel e em quais mensagens aparecem. @return list<array<string,mixed>> */
    public function variaveisBot(): array
    {
        if (!$this->tabelasNovas()['mensagens']) {
            return [];
        }
        $usos = [];
        foreach ($this->q("SELECT chave, titulo, coalesce(array_to_json(variaveis)::text, '[]') AS v FROM ixc.mensagens WHERE chave NOT LIKE 'var.%' AND chave NOT LIKE 'resp.%' AND chave NOT LIKE 'vsys.%' ORDER BY ordem, chave") as $m) {
            foreach (json_decode((string) $m['v'], true) ?: [] as $v) {
                $usos[$v][] = ['chave' => (string) $m['chave'], 'titulo' => (string) $m['titulo']];
            }
        }
        $alt = [];
        foreach ($this->q(self::SQL_MENSAGEM . " WHERE chave LIKE 'vsys.%'") as $r) {
            $alt[substr((string) $r['chave'], 5)] = self::linhaMensagem($r);
        }
        $out = [];
        foreach (self::VARS_BOT as $nome => [$desc, $ex]) {
            $a = $alt[$nome] ?? null;
            $out[] = ['nome' => $nome, 'descricao' => $a ? (string) $a['titulo'] : $desc, 'exemplo' => $a ? (string) $a['texto_padrao'] : $ex,
                'descricao_padrao' => $desc, 'exemplo_padrao' => $ex, 'ativo' => $a ? $a['ativo'] : true, 'alterada' => $a !== null,
                'atualizado' => $a['atualizado'] ?? '', 'atualizado_por' => $a['atualizado_por'] ?? '', 'mensagens' => $usos[$nome] ?? []];
        }
        return $out;
    }

    /** 0.4.2: shoppings para a variável por shopping (chave EMPRESA:ID). @return list<array{chave:string,nome:string,empresa:string}> */
    public function listaShoppings(): array
    {
        return array_map(fn($r) => ['chave' => $r['empresa'] . ':' . $r['id_condominio'], 'nome' => (string) $r['nome'], 'empresa' => (string) $r['empresa']],
            $this->q('SELECT empresa, id_condominio, nome FROM ixc.locais ORDER BY empresa, nome'));
    }

    /**
     * 0.4.1: variáveis das mensagens novas ({nome} = valor fixo), guardadas em ixc.mensagens com chave var.<nome>:
     * titulo = descrição, texto_padrao = valor. usos = mensagens novas cujo texto usa a variável.
     * @return list<array<string,mixed>>
     */
    public function variaveis(): array
    {
        if (!$this->tabelasNovas()['mensagens']) {
            return [];
        }
        $vs = $this->q(self::SQL_MENSAGEM . " WHERE chave LIKE 'var.%' ORDER BY chave");
        $resp = $this->q("SELECT chave, titulo, texto_padrao FROM ixc.mensagens WHERE chave LIKE 'resp.%' ORDER BY chave");
        $out = [];
        foreach ($vs as $r) {
            $r = self::linhaMensagem($r);
            $nome = substr((string) $r['chave'], 4);
            $usos = [];
            foreach ($resp as $m) {
                if (str_contains((string) $m['texto_padrao'], '{' . $nome . '}')) {
                    $usos[] = ['chave' => (string) $m['chave'], 'titulo' => (string) $m['titulo']];
                }
            }
            // 0.4.2: tipo "shopping" = texto com o JSON {"EMPRESA:ID": valor}; texto_padrao = valor padrão
            $valores = $r['texto'] !== null ? (json_decode((string) $r['texto'], true) ?: []) : null;
            $out[] = ['nome' => $nome, 'tipo' => $valores === null ? 'fixo' : 'shopping', 'valores' => $valores ?? (object) [],
                'valor' => (string) $r['texto_padrao'], 'descricao' => (string) $r['titulo'], 'ativo' => $r['ativo'],
                'criado_por' => $r['criado_por'], 'criado_em' => $r['criado_em'], 'atualizado' => $r['atualizado'], 'atualizado_por' => $r['atualizado_por'], 'usos' => $usos];
        }
        return $out;
    }

    /**
     * Perguntas que acionam as respostas de setor (ixc.perguntas).
     * @return array{instalado:bool, itens:list<array<string,mixed>>}
     */
    public function perguntas(): array
    {
        if (!$this->tabelasNovas()['perguntas']) {
            return ['instalado' => false, 'itens' => []];
        }
        // 0.3.0: "excluida" (padrão apagada no painel) fica fora da lista; to_jsonb aceita banco sem a coluna ainda
        $rows = $this->q("SELECT id, alvo, frase, grupos, ativo, padrao, coalesce(criado_por, '') AS criado_por,
                                 to_char(criado_em, 'DD/MM/YYYY') AS criado_em
                            FROM ixc.perguntas p WHERE NOT coalesce((to_jsonb(p)->>'excluida')::boolean, false)
                           ORDER BY alvo, padrao DESC, id");
        $exc = [];
        foreach ($this->q("SELECT alvo, count(*) AS n FROM ixc.perguntas p WHERE coalesce((to_jsonb(p)->>'excluida')::boolean, false) GROUP BY alvo") as $x) {
            $exc[(string) $x['alvo']] = (int) $x['n'];
        }
        foreach ($rows as &$r) {
            $r['id'] = (int) $r['id'];
            $r['ativo'] = (bool) $r['ativo'];
            $r['padrao'] = (bool) $r['padrao'];
        }
        unset($r);
        return ['instalado' => true, 'itens' => $rows, 'excluidas' => $exc];
    }

    /** @return list<array{chave:string,valor:string,descricao:string,principal:bool}> */
    public function parametros(): array
    {
        $out = [];
        foreach ($this->q('SELECT chave, valor, coalesce(descricao, \'\') AS descricao FROM ixc.parametros ORDER BY chave') as $r) {
            $out[] = [
                'chave'     => (string) $r['chave'],
                'valor'     => (string) $r['valor'],
                'descricao' => (string) $r['descricao'],
                'principal' => in_array($r['chave'], self::PARAM_PRINCIPAIS, true),
            ];
        }
        return $out;
    }

    /** 0.5.0: valor de um parâmetro (null = não existe). */
    public function parametro(string $chave): ?string
    {
        $r = $this->q('SELECT valor FROM ixc.parametros WHERE chave = ?', [$chave]);
        return $r ? (string) $r[0]['valor'] : null;
    }

    /** IXCs lidos pelo bot (sem o token). @return list<array<string,mixed>> */
    public function empresas(): array
    {
        // 0.5.0: + endereço, dono do número, listas de assuntos (formulário da aba Operação) e minutos desde o último evento lido
        return $this->q("SELECT id, nome, ativo, last_evento_id, to_char(atualizado, 'DD/MM HH24:MI') AS atualizado, semtec_sem_local,
                                coalesce(array_length(ignorar_assuntos, 1), 0) AS n_ignorar, coalesce(array_length(assuntos_financeiros, 1), 0) AS n_financeiro,
                                coalesce(base_url, '') AS base_url, coalesce(dono_id, '') AS dono_id,
                                array_to_string(coalesce(ignorar_assuntos, '{}'), ',') AS ignorar_assuntos,
                                array_to_string(coalesce(assuntos_financeiros, '{}'), ',') AS assuntos_financeiros,
                                CASE WHEN atualizado IS NULL THEN NULL ELSE floor(extract(epoch FROM now() - atualizado) / 60)::int END AS minutos_evento
                           FROM ixc.empresas ORDER BY id");
    }

    /** Envios e ignorados das últimas 24 h por tipo. @return list<array<string,mixed>> */
    public function resumoEventos(): array
    {
        return $this->q("SELECT tipo, count(*) FILTER (WHERE status = 'ok') AS ok, count(*) FILTER (WHERE status = 'falha') AS falha,
                                count(*) FILTER (WHERE status = 'ignorado') AS ignorado, count(*) FILTER (WHERE motivo = 'SIMULADO') AS simulado,
                                to_char(max(ts), 'DD/MM HH24:MI') AS ultimo
                           FROM ixc.eventos WHERE ts > now() - interval '24 hours' GROUP BY tipo ORDER BY tipo");
    }

    /** @return list<array<string,mixed>> */
    public function ultimosEventos(int $n): array
    {
        return $this->q("SELECT to_char(ts, 'DD/MM HH24:MI') AS em, empresa, tipo, status, coalesce(motivo, '') AS motivo,
                                coalesce(protocolo, '') AS protocolo, left(regexp_replace(coalesce(texto, ''), '\s+', ' ', 'g'), 160) AS texto
                           FROM ixc.eventos ORDER BY ts DESC LIMIT " . max(1, min(200, $n)));
    }

    /**
     * Um item por shopping (ixc.locais) com a escala base, o técnico padrão e a escala do dia (planilha) de hoje e amanhã.
     * @return list<array<string,mixed>>
     */
    public function shoppings(): array
    {
        $rows = $this->q("SELECT l.empresa, l.id_condominio, l.nome, l.grupo, coalesce(l.tec_padrao, '') AS tec_padrao,
                                 coalesce(b.tipo, 'fixo') AS tipo, coalesce(b.tecnicos, '') AS equipe, coalesce(b.obs, '') AS obs,
                                 b.seg, b.ter, b.qua, b.qui, b.sex, b.sab, b.dom,
                                 coalesce(t.nome, '') AS tec_nome, coalesce(t.fone, '') AS tec_fone,
                                 array_to_string(l.marcar_sem_tec, ',') AS marcar_sem_tec,
                                 array_to_string(l.marcar_escalar, ',') AS marcar_escalar, (b.empresa IS NOT NULL) AS tem_escala,
                                 (SELECT string_agg(d.tecnico, ' / ' ORDER BY d.tecnico) FROM ixc.escala_dia d
                                   WHERE d.empresa = l.empresa AND d.id_condominio = l.id_condominio AND d.data = current_date) AS dia_hoje,
                                 (SELECT string_agg(d.tecnico, ' / ' ORDER BY d.tecnico) FROM ixc.escala_dia d
                                   WHERE d.empresa = l.empresa AND d.id_condominio = l.id_condominio AND d.data = current_date + 1) AS dia_amanha
                            FROM ixc.locais l
                            LEFT JOIN ixc.escala_base b ON b.empresa = l.empresa AND b.id_condominio = l.id_condominio
                            LEFT JOIN ixc.tecnicos t ON t.empresa = l.empresa AND t.id_func = l.tec_padrao
                           ORDER BY l.empresa, l.nome");
        $out = [];
        foreach ($rows as $r) {
            $horarios = [];
            foreach (self::DIAS as $d) {
                $horarios[$d] = $r[$d] === null ? '' : (string) $r[$d];
            }
            $out[] = [
                'empresa'       => (string) $r['empresa'],
                'id_condominio' => (string) $r['id_condominio'],
                'nome'          => (string) $r['nome'],
                'tipo'          => (string) $r['tipo'],
                'equipe'        => (string) $r['equipe'],
                'obs'           => (string) $r['obs'],
                'tec_padrao'    => (string) $r['tec_padrao'],
                'tec_nome'      => (string) $r['tec_nome'],
                'tec_fone'      => (string) $r['tec_fone'],
                'horarios'      => $horarios,
                'marcar_sem_tec' => (string) $r['marcar_sem_tec'],
                'marcar_escalar' => (string) $r['marcar_escalar'],
                'grupo'         => (string) $r['grupo'],
                'tem_escala'    => (bool) $r['tem_escala'],
                'dia_hoje'      => (string) ($r['dia_hoje'] ?? ''),
                'dia_amanha'    => (string) ($r['dia_amanha'] ?? ''),
                'quem'          => self::quem((string) $r['tipo'], (string) ($r['dia_hoje'] ?? ''), (string) $r['tec_nome'], (string) $r['equipe']),
            ];
        }
        return $out;
    }

    /**
     * Quem o bot responde hoje — mesma ordem do nó "Escala: Montar Resposta" (WF 03):
     * 12x36/escala: escala do dia da planilha, senão a equipe base; fixo: técnico padrão do IXC, senão a equipe base.
     * @return array{texto:string,fonte:string}
     */
    public static function quem(string $tipo, string $diaHoje, string $tecNome, string $equipe): array
    {
        if ($tipo === '12x36' || $tipo === 'escala') {
            if ($diaHoje !== '') {
                return ['texto' => $diaHoje, 'fonte' => 'planilha (escala do dia)'];
            }
            return ['texto' => $equipe !== '' ? str_replace(';', ' /', $equipe) : '—', 'fonte' => 'escala base (planilha sem o dia)'];
        }
        if ($tecNome !== '') {
            return ['texto' => $tecNome, 'fonte' => 'técnico padrão'];
        }
        return ['texto' => $equipe !== '' ? str_replace(';', ' /', $equipe) : '—', 'fonte' => $equipe !== '' ? 'escala base' : 'sem técnico'];
    }

    /** Técnicos de campo (ixc.tecnicos) com os shoppings em que são o técnico padrão. @return list<array<string,mixed>> */
    public function tecnicos(): array
    {
        return $this->q("SELECT t.empresa, t.id_func, t.nome, coalesce(t.fone, '') AS fone, coalesce(t.grupo, '') AS grupo,
                                coalesce(to_jsonb(t)->>'nome_planilha', '') AS nome_planilha,
                                coalesce((SELECT string_agg(l.nome, ', ' ORDER BY l.nome) FROM ixc.locais l
                                          WHERE l.empresa = t.empresa AND l.tec_padrao = t.id_func), '') AS shoppings,
                                coalesce((SELECT string_agg(l.nome, ', ' ORDER BY l.nome) FROM ixc.locais l
                                          WHERE t.fone <> '' AND (t.fone = ANY (l.marcar_sem_tec) OR t.fone = ANY (l.marcar_escalar))), '') AS marcado_em
                           FROM ixc.tecnicos t ORDER BY t.empresa, t.nome");
    }

    /** Contatos que o bot informa por setor ("algum N2?", "alguém do financeiro?"). @return list<array<string,mixed>> */
    public function contatos(): array
    {
        $rows = $this->q("SELECT id, setor, ordem, nome, coalesce(fone, '') AS fone, seg, ter, qua, qui, sex, sab, dom,
                                 coalesce(obs, '') AS obs, ativo, coalesce(escala, '') AS escala
                            FROM ixc.contatos_setor ORDER BY setor, ativo DESC, ordem");
        foreach ($rows as &$r) {
            $h = [];
            foreach (self::DIAS as $d) {
                $h[$d] = $r[$d] === null ? '' : (string) $r[$d];
                unset($r[$d]);
            }
            $r['horarios'] = $h;
            $r['ativo'] = (bool) $r['ativo'];
            $r['id'] = (int) $r['id'];
        }
        unset($r);
        return $rows;
    }

    /** 0.3.0 — apelidos de shopping (ixc.apelidos). @return array{instalado:bool, itens:list<array<string,mixed>>} */
    public function apelidos(): array
    {
        if ($this->q("SELECT to_regclass('ixc.apelidos') IS NULL AS f")[0]['f']) {
            return ['instalado' => false, 'itens' => []];
        }
        $rows = $this->q("SELECT id, apelido, array_to_json(alvos)::text AS alvos, generico, padrao FROM ixc.apelidos ORDER BY apelido");
        foreach ($rows as &$r) {
            $r['id'] = (int) $r['id'];
            $r['alvos'] = json_decode((string) $r['alvos'], true) ?: [];
            $r['generico'] = (bool) $r['generico'];
            $r['padrao'] = (bool) $r['padrao'];
        }
        unset($r);
        return ['instalado' => true, 'itens' => $rows];
    }

    /**
     * 0.3.0 — listas dos formulários: bases, grupos de WhatsApp já usados (com quem usa) e pessoas que podem ser marcadas.
     * @return array<string,mixed>
     */
    public function apoio(): array
    {
        $grupos = [];
        foreach ($this->q("SELECT grupo, string_agg(nome, ', ' ORDER BY nome) AS quem FROM (
                                SELECT grupo, nome FROM ixc.locais UNION ALL SELECT grupo, 'técnico ' || nome FROM ixc.tecnicos WHERE coalesce(grupo, '') <> ''
                             ) g GROUP BY grupo ORDER BY grupo") as $g) {
            $grupos[] = ['jid' => (string) $g['grupo'], 'quem' => mb_substr((string) $g['quem'], 0, 140)];
        }
        $p = [];
        foreach ($this->q("SELECT chave, valor FROM ixc.parametros WHERE chave IN ('supervisor_fone', 'supervisor_nome', 'coordenador_fone', 'coordenador_nome', 'grupo_automacao', 'setores_grupo')") as $x) {
            $p[(string) $x['chave']] = (string) $x['valor'];
        }
        $pessoas = [];
        foreach (['supervisor', 'coordenador'] as $c) {
            if (($p[$c . '_fone'] ?? '') !== '') {
                $pessoas[] = ['fone' => $p[$c . '_fone'], 'nome' => ($p[$c . '_nome'] ?? ucfirst($c)) . ' (' . $c . ')', 'empresa' => ''];
            }
        }
        foreach ($this->q("SELECT empresa, nome, fone FROM ixc.tecnicos WHERE coalesce(fone, '') <> '' ORDER BY empresa, nome") as $t) {
            $pessoas[] = ['fone' => (string) $t['fone'], 'nome' => (string) $t['nome'], 'empresa' => (string) $t['empresa']];
        }
        return [
            'empresas' => $this->q('SELECT id, nome FROM ixc.empresas ORDER BY id'),
            'grupos'   => $grupos,
            'pessoas'  => $pessoas,
            'setores'  => ['n2', 'financeiro', 'comercial', 'compras', 'rh'],
        ];
    }
}
