<?php

namespace GlpiPlugin\Painelixc;

use DBConnection;
use Migration;
use ProfileRight;
use Session;

/**
 * Instalação idempotente: tabelas, direitos e configuração inicial.
 * Só schema aqui; higiene de dados não entra.
 */
final class Install
{
    public const BASES_PADRAO = [
        ['codigo' => 'resolutto', 'nome' => 'Resolutto', 'cor' => '#2563eb', 'ordem' => 1],
        ['codigo' => '4btelecom', 'nome' => '4BTELECOM', 'cor' => '#059669', 'ordem' => 2],
        ['codigo' => 'ponto',     'nome' => 'PONTO',     'cor' => '#d97706', 'ordem' => 3],
        ['codigo' => 'cacta',     'nome' => 'CACTA',     'cor' => '#db2777', 'ordem' => 4],
        ['codigo' => 'buzz',      'nome' => 'BUZZ',      'cor' => '#7c3aed', 'ordem' => 5],
    ];

    public static function install(): bool
    {
        /** @var \DBmysql $DB */
        global $DB;

        $migration = new Migration(PLUGIN_PAINELIXC_VERSION);
        $charset   = DBConnection::getDefaultCharset();
        $collation = DBConnection::getDefaultCollation();
        $sign      = DBConnection::getDefaultPrimaryKeySignOption();

        if (!$DB->tableExists('glpi_plugin_painelixc_bases')) {
            $DB->doQuery("CREATE TABLE `glpi_plugin_painelixc_bases` (
                `id` int {$sign} NOT NULL AUTO_INCREMENT,
                `codigo` varchar(30) NOT NULL,
                `nome` varchar(80) NOT NULL,
                `cor` varchar(9) NOT NULL DEFAULT '#64748b',
                `ixc_url` varchar(255) DEFAULT NULL,
                `ordem` int NOT NULL DEFAULT 0,
                `is_active` tinyint NOT NULL DEFAULT 1,
                `ultima_sync` timestamp NULL DEFAULT NULL,
                `ultima_tentativa` timestamp NULL DEFAULT NULL,
                `ultimo_erro` text DEFAULT NULL,
                `ultimo_total_ixc` int DEFAULT NULL,
                `ultimo_recebido` int DEFAULT NULL,
                PRIMARY KEY (`id`),
                UNIQUE KEY `codigo` (`codigo`)
            ) ENGINE=InnoDB DEFAULT CHARSET={$charset} COLLATE={$collation} ROW_FORMAT=DYNAMIC");
        }

        if (!$DB->tableExists('glpi_plugin_painelixc_synclogs')) {
            $DB->doQuery("CREATE TABLE `glpi_plugin_painelixc_synclogs` (
                `id` bigint {$sign} NOT NULL AUTO_INCREMENT,
                `plugin_painelixc_bases_id` int {$sign} NOT NULL,
                `tipo` varchar(12) NOT NULL DEFAULT 'abertas',
                `quando` timestamp NULL DEFAULT NULL,
                `ok` tinyint NOT NULL DEFAULT 0,
                `total_ixc` int DEFAULT NULL,
                `recebidas` int NOT NULL DEFAULT 0,
                `novas` int NOT NULL DEFAULT 0,
                `atualizadas` int NOT NULL DEFAULT 0,
                `sairam` int NOT NULL DEFAULT 0,
                `erro` text DEFAULT NULL,
                `duracao_ms` int DEFAULT NULL,
                PRIMARY KEY (`id`),
                KEY `base_quando` (`plugin_painelixc_bases_id`, `quando`)
            ) ENGINE=InnoDB DEFAULT CHARSET={$charset} COLLATE={$collation} ROW_FORMAT=DYNAMIC");
        }

        if (!$DB->tableExists('glpi_plugin_painelixc_chamados')) {
            $DB->doQuery("CREATE TABLE `glpi_plugin_painelixc_chamados` (
                `id` bigint {$sign} NOT NULL AUTO_INCREMENT,
                `plugin_painelixc_bases_id` int {$sign} NOT NULL,
                `tipo` varchar(12) NOT NULL DEFAULT 'os',
                `ixc_id` int {$sign} NOT NULL,
                `protocolo` varchar(40) DEFAULT NULL,
                `status` varchar(5) NOT NULL,
                `prioridade` varchar(5) DEFAULT NULL,
                `id_assunto` int DEFAULT NULL,
                `assunto` varchar(150) DEFAULT NULL,
                `id_setor` int DEFAULT NULL,
                `setor` varchar(150) DEFAULT NULL,
                `id_tecnico` int DEFAULT NULL,
                `tecnico` varchar(150) DEFAULT NULL,
                `id_cliente` int DEFAULT NULL,
                `cliente` varchar(200) DEFAULT NULL,
                `id_condominio` int DEFAULT NULL,
                `condominio` varchar(150) DEFAULT NULL,
                `id_diagnostico` int DEFAULT NULL,
                `diagnostico` varchar(150) DEFAULT NULL,
                `id_ticket` int DEFAULT NULL,
                `mensagem` text DEFAULT NULL,
                `mensagem_resposta` text DEFAULT NULL,
                `data_abertura` timestamp NULL DEFAULT NULL,
                `data_agenda` timestamp NULL DEFAULT NULL,
                `data_inicio` timestamp NULL DEFAULT NULL,
                `data_final` timestamp NULL DEFAULT NULL,
                `data_fechamento` timestamp NULL DEFAULT NULL,
                `ultima_atualizacao` timestamp NULL DEFAULT NULL,
                `is_active` tinyint NOT NULL DEFAULT 1,
                `sync_id` bigint {$sign} DEFAULT NULL,
                `primeiro_visto` timestamp NULL DEFAULT NULL,
                `ultimo_visto` timestamp NULL DEFAULT NULL,
                `saiu_em` timestamp NULL DEFAULT NULL,
                PRIMARY KEY (`id`),
                UNIQUE KEY `base_tipo_ixc` (`plugin_painelixc_bases_id`, `tipo`, `ixc_id`),
                KEY `ativo_base` (`is_active`, `plugin_painelixc_bases_id`),
                KEY `status_fechamento` (`status`, `data_fechamento`),
                KEY `saiu_em` (`saiu_em`)
            ) ENGINE=InnoDB DEFAULT CHARSET={$charset} COLLATE={$collation} ROW_FORMAT=DYNAMIC");
        }

        if (!$DB->tableExists('glpi_plugin_painelixc_filtros')) {
            $DB->doQuery("CREATE TABLE `glpi_plugin_painelixc_filtros` (
                `id` int {$sign} NOT NULL AUTO_INCREMENT,
                `users_id` int {$sign} NOT NULL DEFAULT 0,
                `tela` varchar(12) NOT NULL DEFAULT 'painel',
                `nome` varchar(80) NOT NULL,
                `filtro` text DEFAULT NULL,
                `is_publico` tinyint NOT NULL DEFAULT 0,
                `is_padrao` tinyint NOT NULL DEFAULT 0,
                `date_creation` timestamp NULL DEFAULT NULL,
                `date_mod` timestamp NULL DEFAULT NULL,
                PRIMARY KEY (`id`),
                KEY `tela_user` (`tela`, `users_id`),
                KEY `tela_publico` (`tela`, `is_publico`)
            ) ENGINE=InnoDB DEFAULT CHARSET={$charset} COLLATE={$collation} ROW_FORMAT=DYNAMIC");
        }

        // dicionários do IXC (assuntos, técnicos, setores, diagnósticos, condomínios) — lista completa, mesmo sem O.S.
        if (!$DB->tableExists('glpi_plugin_painelixc_dicionarios')) {
            $DB->doQuery("CREATE TABLE `glpi_plugin_painelixc_dicionarios` (
                `id` int {$sign} NOT NULL AUTO_INCREMENT,
                `plugin_painelixc_bases_id` int {$sign} NOT NULL,
                `tipo` varchar(20) NOT NULL,
                `ixc_id` int NOT NULL,
                `nome` varchar(200) NOT NULL,
                `ultimo_visto` timestamp NULL DEFAULT NULL,
                PRIMARY KEY (`id`),
                UNIQUE KEY `base_tipo_ixc` (`plugin_painelixc_bases_id`, `tipo`, `ixc_id`),
                KEY `tipo` (`tipo`)
            ) ENGINE=InnoDB DEFAULT CHARSET={$charset} COLLATE={$collation} ROW_FORMAT=DYNAMIC");
        }

        // 0.5.0 — Auditoria de Ativação: auditorias abertas + O.S. de Ativação de origem (mensagens/anexos em `detalhe`, JSON)
        if (!$DB->tableExists('glpi_plugin_painelixc_auditorias')) {
            $DB->doQuery("CREATE TABLE `glpi_plugin_painelixc_auditorias` (
                `id` bigint {$sign} NOT NULL AUTO_INCREMENT,
                `plugin_painelixc_bases_id` int {$sign} NOT NULL,
                `ixc_id` int {$sign} NOT NULL,
                `protocolo` varchar(40) DEFAULT NULL,
                `status` varchar(5) NOT NULL DEFAULT '?',
                `id_assunto` int DEFAULT NULL,
                `id_ticket` int DEFAULT NULL,
                `id_cliente` int DEFAULT NULL,
                `id_tecnico` int DEFAULT NULL,
                `id_setor` int DEFAULT NULL,
                `data_abertura` timestamp NULL DEFAULT NULL,
                `mensagem` text DEFAULT NULL,
                `origem_ixc_id` int DEFAULT NULL,
                `origem_protocolo` varchar(40) DEFAULT NULL,
                `origem_status` varchar(5) DEFAULT NULL,
                `origem_id_assunto` int DEFAULT NULL,
                `origem_id_tecnico` int DEFAULT NULL,
                `origem_data_abertura` timestamp NULL DEFAULT NULL,
                `origem_data_fechamento` timestamp NULL DEFAULT NULL,
                `origem_mensagem` text DEFAULT NULL,
                `origem_mensagem_resposta` text DEFAULT NULL,
                `detalhe` mediumtext DEFAULT NULL,
                `qtd_msgs` int NOT NULL DEFAULT 0,
                `qtd_arquivos` int NOT NULL DEFAULT 0,
                `is_active` tinyint NOT NULL DEFAULT 1,
                `sync_id` bigint {$sign} DEFAULT NULL,
                `primeiro_visto` timestamp NULL DEFAULT NULL,
                `ultimo_visto` timestamp NULL DEFAULT NULL,
                `saiu_em` timestamp NULL DEFAULT NULL,
                PRIMARY KEY (`id`),
                UNIQUE KEY `base_ixc` (`plugin_painelixc_bases_id`, `ixc_id`),
                KEY `ativo_base` (`is_active`, `plugin_painelixc_bases_id`),
                KEY `saiu_em` (`saiu_em`)
            ) ENGINE=InnoDB DEFAULT CHARSET={$charset} COLLATE={$collation} ROW_FORMAT=DYNAMIC");
        }

        // 0.6.0 — ações de auditoria: credencial da API (cifrada) e respostas padrão por base + log das ações
        foreach ([
            'api_token'      => 'text DEFAULT NULL',
            'resp_aprovar'   => 'int DEFAULT NULL',
            'resp_readequar' => 'int DEFAULT NULL',
            'resp_imagens'   => 'int DEFAULT NULL',
            'resp_sinal'      => 'int DEFAULT NULL',   // 0.8.0
            'resp_velocidade' => 'int DEFAULT NULL',   // 0.8.0
            'resp_roteador'   => 'int DEFAULT NULL',   // 0.8.0
        ] as $campo => $def) {
            if (!$DB->fieldExists('glpi_plugin_painelixc_bases', $campo)) {
                $DB->doQuery("ALTER TABLE `glpi_plugin_painelixc_bases` ADD `$campo` $def");
            }
        }
        if (!$DB->tableExists('glpi_plugin_painelixc_auditoria_acoes')) {
            $DB->doQuery("CREATE TABLE `glpi_plugin_painelixc_auditoria_acoes` (
                `id` int {$sign} NOT NULL AUTO_INCREMENT,
                `plugin_painelixc_bases_id` int {$sign} NOT NULL,
                `auditoria_ixc_id` int {$sign} NOT NULL,
                `ativacao_ixc_id` int {$sign} DEFAULT NULL,
                `acao` varchar(20) NOT NULL,
                `users_id` int {$sign} NOT NULL DEFAULT 0,
                `usuario` varchar(255) DEFAULT NULL,
                `quando` timestamp NULL DEFAULT NULL,
                `ok` tinyint NOT NULL DEFAULT 0,
                `etapa` varchar(30) DEFAULT NULL,
                `detalhe` text DEFAULT NULL,
                PRIMARY KEY (`id`),
                KEY `base_auditoria` (`plugin_painelixc_bases_id`, `auditoria_ixc_id`),
                KEY `quando` (`quando`)
            ) ENGINE=InnoDB DEFAULT CHARSET={$charset} COLLATE={$collation} ROW_FORMAT=DYNAMIC");
        }

        // 0.7.0 — reauditoria: Ativações reabertas pelo painel aguardando nova finalização
        if (!$DB->tableExists('glpi_plugin_painelixc_reauditorias')) {
            $DB->doQuery("CREATE TABLE `glpi_plugin_painelixc_reauditorias` (
                `id` int {$sign} NOT NULL AUTO_INCREMENT,
                `plugin_painelixc_bases_id` int {$sign} NOT NULL,
                `ativacao_ixc_id` int {$sign} NOT NULL,
                `auditoria_ixc_id` int {$sign} NOT NULL,
                `rodada` int NOT NULL DEFAULT 2,
                `acao` varchar(20) DEFAULT NULL,
                `users_id` int {$sign} NOT NULL DEFAULT 0,
                `usuario` varchar(255) DEFAULT NULL,
                `reaberta_em` timestamp NULL DEFAULT NULL,
                `estado` varchar(12) NOT NULL DEFAULT 'aguardando',
                `tentativas` int NOT NULL DEFAULT 0,
                `nova_auditoria_ixc_id` int {$sign} DEFAULT NULL,
                `criada_em` timestamp NULL DEFAULT NULL,
                `atualizado_em` timestamp NULL DEFAULT NULL,
                `detalhe` text DEFAULT NULL,
                PRIMARY KEY (`id`),
                KEY `base_estado` (`plugin_painelixc_bases_id`, `estado`),
                KEY `nova` (`plugin_painelixc_bases_id`, `nova_auditoria_ixc_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET={$charset} COLLATE={$collation} ROW_FORMAT=DYNAMIC");
        }

        // 0.9.0 — distribuição de auditorias entre os auditores (cota igual de recebidas)
        if (!$DB->tableExists('glpi_plugin_painelixc_distribuicoes')) {
            $DB->doQuery("CREATE TABLE `glpi_plugin_painelixc_distribuicoes` (
                `id` int {$sign} NOT NULL AUTO_INCREMENT,
                `plugin_painelixc_bases_id` int {$sign} NOT NULL,
                `auditoria_ixc_id` int {$sign} NOT NULL,
                `de_tecnico` int {$sign} DEFAULT NULL,
                `para_tecnico` int {$sign} DEFAULT NULL,
                `modo` varchar(10) NOT NULL DEFAULT 'real',
                `ok` tinyint NOT NULL DEFAULT 0,
                `quando` timestamp NULL DEFAULT NULL,
                `detalhe` text DEFAULT NULL,
                PRIMARY KEY (`id`),
                KEY `base_os` (`plugin_painelixc_bases_id`, `auditoria_ixc_id`, `modo`),
                KEY `quando` (`quando`)
            ) ENGINE=InnoDB DEFAULT CHARSET={$charset} COLLATE={$collation} ROW_FORMAT=DYNAMIC");
        }

        // 0.10.0 — botões da Auditoria editáveis (cadastro + respostas padrão por base)
        if (!$DB->tableExists('glpi_plugin_painelixc_botoes')) {
            $DB->doQuery("CREATE TABLE `glpi_plugin_painelixc_botoes` (
                `id` int {$sign} NOT NULL AUTO_INCREMENT,
                `chave` varchar(20) NOT NULL,
                `nome` varchar(80) NOT NULL,
                `rotulo` varchar(40) DEFAULT NULL,
                `descricao` varchar(200) DEFAULT NULL,
                `tipo` varchar(10) NOT NULL DEFAULT 'reprova',
                `icone` varchar(50) DEFAULT NULL,
                `ordem` int NOT NULL DEFAULT 0,
                PRIMARY KEY (`id`),
                UNIQUE KEY `chave` (`chave`)
            ) ENGINE=InnoDB DEFAULT CHARSET={$charset} COLLATE={$collation} ROW_FORMAT=DYNAMIC");
        }
        if (!$DB->tableExists('glpi_plugin_painelixc_botao_respostas')) {
            $DB->doQuery("CREATE TABLE `glpi_plugin_painelixc_botao_respostas` (
                `id` int {$sign} NOT NULL AUTO_INCREMENT,
                `plugin_painelixc_bases_id` int {$sign} NOT NULL,
                `plugin_painelixc_botoes_id` int {$sign} NOT NULL,
                `resposta_id` int NOT NULL,
                PRIMARY KEY (`id`),
                UNIQUE KEY `base_botao` (`plugin_painelixc_bases_id`, `plugin_painelixc_botoes_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET={$charset} COLLATE={$collation} ROW_FORMAT=DYNAMIC");
        }

        // 0.14.0 — botão "Aprova/Abrir Chamado": por base, a resposta padrão da O.S. nova e o assunto dela
        foreach ([
            'chamado_resposta_id' => "int NOT NULL DEFAULT 0 AFTER `resposta_id`",
            'chamado_assunto_id'  => "int NOT NULL DEFAULT 0 AFTER `chamado_resposta_id`",
        ] as $campo => $def) {
            if (!$DB->fieldExists('glpi_plugin_painelixc_botao_respostas', $campo)) {
                $DB->doQuery("ALTER TABLE `glpi_plugin_painelixc_botao_respostas` ADD `$campo` $def");
            }
        }

        // 0.11.0 — Atendimentos do IXC (su_ticket), abertos e finalizados, com a lista de O.S. (JSON em os_lista)
        if (!$DB->tableExists('glpi_plugin_painelixc_atendimentos')) {
            $DB->doQuery("CREATE TABLE `glpi_plugin_painelixc_atendimentos` (
                `id` bigint {$sign} NOT NULL AUTO_INCREMENT,
                `plugin_painelixc_bases_id` int {$sign} NOT NULL,
                `ixc_id` int {$sign} NOT NULL,
                `protocolo` varchar(40) DEFAULT NULL,
                `status` varchar(5) NOT NULL DEFAULT '?',
                `id_assunto` int DEFAULT NULL,
                `titulo` varchar(255) DEFAULT NULL,
                `id_setor` int DEFAULT NULL,
                `id_responsavel` int DEFAULT NULL,
                `id_cliente` int DEFAULT NULL,
                `cliente` varchar(200) DEFAULT NULL,
                `id_condominio` int DEFAULT NULL,
                `data_abertura` timestamp NULL DEFAULT NULL,
                `ultima_atualizacao` timestamp NULL DEFAULT NULL,
                `os_lista` mediumtext DEFAULT NULL,
                `qtd_os` int NOT NULL DEFAULT 0,
                `is_active` tinyint NOT NULL DEFAULT 1,
                `sync_id` bigint {$sign} DEFAULT NULL,
                `primeiro_visto` timestamp NULL DEFAULT NULL,
                `ultimo_visto` timestamp NULL DEFAULT NULL,
                `saiu_em` timestamp NULL DEFAULT NULL,
                PRIMARY KEY (`id`),
                UNIQUE KEY `base_ixc` (`plugin_painelixc_bases_id`, `ixc_id`),
                KEY `ativo_base` (`is_active`, `plugin_painelixc_bases_id`),
                KEY `status_atualizacao` (`status`, `ultima_atualizacao`)
            ) ENGINE=InnoDB DEFAULT CHARSET={$charset} COLLATE={$collation} ROW_FORMAT=DYNAMIC");
        }
        // 0.11.1 — condomínio do cliente do atendimento (filtro da tela)
        if (!$DB->fieldExists('glpi_plugin_painelixc_atendimentos', 'id_condominio')) {
            $DB->doQuery("ALTER TABLE `glpi_plugin_painelixc_atendimentos` ADD `id_condominio` int DEFAULT NULL AFTER `cliente`");
        }

        foreach (self::BASES_PADRAO as $b) {
            $existe = $DB->request(['FROM' => 'glpi_plugin_painelixc_bases', 'WHERE' => ['codigo' => $b['codigo']]])->count();
            if ($existe === 0) {
                $DB->insert('glpi_plugin_painelixc_bases', $b);
            }
        }
        Botao::semear($DB);   // depois das bases (copia as respostas das colunas antigas resp_*)

        // 0.12.0 — tema escolhido por usuário (Claro / Escuro / Automático)
        if (!$DB->tableExists('glpi_plugin_painelixc_preferencias')) {
            $DB->doQuery("CREATE TABLE `glpi_plugin_painelixc_preferencias` (
                `users_id` int {$sign} NOT NULL,
                `tema` varchar(10) NOT NULL DEFAULT 'claro',
                `date_mod` timestamp NULL DEFAULT NULL,
                PRIMARY KEY (`users_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET={$charset} COLLATE={$collation} ROW_FORMAT=DYNAMIC");
        }

        // Direito próprio: nasce desmarcado; o perfil atual (quem instala) recebe leitura + configuração.
        // Desde a 0.12.0 ele vale só para a Configuração (UPDATE); as telas usam os direitos por categoria abaixo.
        $migration->addRight(PLUGIN_PAINELIXC_RIGHT, READ | UPDATE, ['config' => UPDATE]);
        $migration->executeMigration();
        self::migrarDireitos($DB);

        Config::garantirPadroes();

        return true;
    }

    public static function uninstall(): bool
    {
        /** @var \DBmysql $DB */
        global $DB;

        foreach (['glpi_plugin_painelixc_preferencias', 'glpi_plugin_painelixc_atendimentos', 'glpi_plugin_painelixc_botao_respostas', 'glpi_plugin_painelixc_botoes', 'glpi_plugin_painelixc_distribuicoes', 'glpi_plugin_painelixc_reauditorias', 'glpi_plugin_painelixc_auditoria_acoes', 'glpi_plugin_painelixc_auditorias', 'glpi_plugin_painelixc_dicionarios', 'glpi_plugin_painelixc_filtros', 'glpi_plugin_painelixc_chamados', 'glpi_plugin_painelixc_synclogs', 'glpi_plugin_painelixc_bases'] as $t) {
            if ($DB->tableExists($t)) {
                $DB->doQuery("DROP TABLE `$t`");
            }
        }
        $nomes = array_merge([PLUGIN_PAINELIXC_RIGHT], array_keys(Direito::CATEGORIAS));
        ProfileRight::deleteProfileRights($nomes);
        Config::apagarTudo();
        foreach ($nomes as $n) {
            if (isset($_SESSION['glpiactiveprofile'][$n])) {
                unset($_SESSION['glpiactiveprofile'][$n]);
            }
        }
        return true;
    }

    /**
     * 0.12.0 — cria os direitos por categoria. Na primeira vez (direito ainda inexistente) copia o acesso de cada perfil
     * da 0.11: quem via o painel continua vendo tudo; "Atualizar" das O.S. só para quem estava na lista do botão Atualizar;
     * Aprovar/Reprovar só para os perfis da lista "Ações de auditoria" (grupos não existem na matriz de perfil).
     * Nas reinstalações seguintes nada é alterado (perfil novo nasce desmarcado).
     */
    public static function migrarDireitos(\DBmysql $DB): void
    {
        $antigos = [];
        foreach ($DB->request(['SELECT' => ['profiles_id', 'rights'], 'FROM' => 'glpi_profilerights', 'WHERE' => ['name' => PLUGIN_PAINELIXC_RIGHT]]) as $r) {
            $antigos[(int) $r['profiles_id']] = (int) $r['rights'];
        }
        $atualizar = Config::perfisAtualizar();
        $agir      = Config::ids('acoes_perfis');

        $perfis = [];
        foreach ($DB->request(['SELECT' => ['id'], 'FROM' => 'glpi_profiles']) as $p) {
            $perfis[] = (int) $p['id'];
        }
        $ativo = (int) ($_SESSION['glpiactiveprofile']['id'] ?? 0);

        foreach (array_keys(Direito::CATEGORIAS) as $nome) {
            $existentes = [];
            foreach ($DB->request(['SELECT' => ['profiles_id'], 'FROM' => 'glpi_profilerights', 'WHERE' => ['name' => $nome]]) as $r) {
                $existentes[(int) $r['profiles_id']] = true;
            }
            $primeiraVez = $existentes === [];
            foreach ($perfis as $pid) {
                if (isset($existentes[$pid])) {
                    continue;   // já existe: nunca rebaixa nem sobrescreve o que o administrador marcou
                }
                $valor = 0;
                if ($primeiraVez) {
                    $valor = Direito::migrarPerfil($antigos[$pid] ?? 0, $atualizar === [] || in_array($pid, $atualizar, true), in_array($pid, $agir, true))[$nome];
                }
                $DB->insert('glpi_profilerights', ['profiles_id' => $pid, 'name' => $nome, 'rights' => $valor]);
                if ($pid === $ativo) {
                    $_SESSION['glpiactiveprofile'][$nome] = $valor;   // quem instalou já enxerga o menu sem novo login
                }
            }
        }
    }
}
