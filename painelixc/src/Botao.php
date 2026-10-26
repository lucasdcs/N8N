<?php

namespace GlpiPlugin\Painelixc;

use DBmysql;

/**
 * Botões da tela Auditoria (0.10.0) — cadastro editável em Configurar > Geral > Painel IXC.
 *
 * Cada botão tem: # (id, fixo; casa o botão com a resposta padrão de cada base), chave (código interno gravado no
 * log/reauditoria: as 6 originais mantêm aprovar/readequar/…; novos = "b<id>"), Ação (nome completo), Nome no botão,
 * Tipo (aprova = finaliza a Auditoria; reprova = reabre a Ativação e finaliza a Auditoria; aprova_os (0.14.0) = finaliza
 * a Auditoria e abre uma O.S. nova, sem atendimento, para o cliente, com o técnico e o setor da Ativação), O que faz (texto livre),
 * Ícone (Tabler, escolhido numa grade) e ordem.
 * Respostas padrão por base em glpi_plugin_painelixc_botao_respostas (base, botão, id da resposta no IXC); no aprova_os
 * a mesma linha guarda também a resposta da O.S. nova (chamado_resposta_id) e o assunto dela (chamado_assunto_id).
 * Apagar um botão remove o botão e as respostas dele; o histórico antigo passa a mostrar só "#n".
 */
final class Botao
{
    public const TABELA = 'glpi_plugin_painelixc_botoes';
    public const TABELA_RESP = 'glpi_plugin_painelixc_botao_respostas';

    /** Os 6 botões de antes da 0.10.0 (semente da migração; resp_* = colunas antigas de glpi_plugin_painelixc_bases). */
    public const PADRAO = [
        'aprovar'    => ['id' => 1, 'nome' => 'Dentro do padrão',                 'tipo' => 'aprova',  'icone' => 'ti-circle-check',     'campo' => 'resp_aprovar'],
        'readequar'  => ['id' => 2, 'nome' => 'Readequar cabos / ONU / roteador', 'tipo' => 'reprova', 'icone' => 'ti-tool',             'campo' => 'resp_readequar'],
        'imagens'    => ['id' => 3, 'nome' => 'Anexar imagens da instalação',     'tipo' => 'reprova', 'icone' => 'ti-photo',            'campo' => 'resp_imagens'],
        'sinal'      => ['id' => 4, 'nome' => 'Sinal não apto',                   'tipo' => 'reprova', 'icone' => 'ti-antenna-bars-off', 'campo' => 'resp_sinal'],
        'velocidade' => ['id' => 5, 'nome' => 'Teste de velocidade inadequado',   'tipo' => 'reprova', 'icone' => 'ti-gauge',            'campo' => 'resp_velocidade'],
        'roteador'   => ['id' => 6, 'nome' => 'Segundo roteador',                 'tipo' => 'reprova', 'icone' => 'ti-router',           'campo' => 'resp_roteador'],
    ];

    public const TIPOS = ['aprova' => 'Aprova', 'reprova' => 'Reprova', 'aprova_os' => 'Aprova/Abrir Chamado'];

    /** Tipo gravado → tipo válido (desconhecido = reprova, como antes). */
    public static function tipo(string $t): string
    {
        return isset(self::TIPOS[$t]) ? $t : 'reprova';
    }

    /** Ícones da grade de escolha (Tabler, vêm com o GLPI 11) → palavras para a busca. */
    public const ICONES = [
        'ti-circle-check' => 'ok aprovado visto certo', 'ti-check' => 'ok certo visto', 'ti-checks' => 'ok certo duplo',
        'ti-thumb-up' => 'aprovado positivo', 'ti-thumb-down' => 'reprovado negativo', 'ti-circle-x' => 'erro reprovado x',
        'ti-x' => 'fechar erro', 'ti-ban' => 'proibido bloqueado', 'ti-alert-triangle' => 'alerta atencao',
        'ti-alert-circle' => 'alerta aviso', 'ti-info-circle' => 'informacao', 'ti-help-circle' => 'ajuda duvida',
        'ti-tool' => 'ferramenta readequar ajuste', 'ti-tools' => 'ferramentas manutencao', 'ti-hammer' => 'martelo obra',
        'ti-screwdriver' => 'chave fenda', 'ti-settings' => 'configuracao engrenagem', 'ti-adjustments' => 'ajustes',
        'ti-photo' => 'foto imagem', 'ti-photo-off' => 'sem foto imagem', 'ti-camera' => 'camera foto', 'ti-camera-off' => 'sem camera',
        'ti-antenna-bars-5' => 'sinal bom', 'ti-antenna-bars-off' => 'sem sinal', 'ti-antenna' => 'antena sinal',
        'ti-wifi' => 'wifi rede sem fio', 'ti-wifi-off' => 'sem wifi', 'ti-router' => 'roteador', 'ti-router-off' => 'sem roteador',
        'ti-gauge' => 'velocidade velocimetro', 'ti-dashboard' => 'painel velocidade', 'ti-chart-line' => 'grafico medicao',
        'ti-plug' => 'tomada energia cabo', 'ti-plug-connected' => 'conectado cabo', 'ti-plug-off' => 'desconectado cabo',
        'ti-network' => 'rede', 'ti-server' => 'servidor', 'ti-device-desktop' => 'computador', 'ti-device-mobile' => 'celular',
        'ti-device-tv' => 'tv', 'ti-cpu' => 'equipamento', 'ti-box' => 'caixa equipamento', 'ti-package' => 'pacote equipamento',
        'ti-bolt' => 'energia eletrica raio', 'ti-power' => 'liga desliga', 'ti-bulb' => 'ideia lampada', 'ti-ruler-measure' => 'medida regua',
        'ti-map-pin' => 'local endereco', 'ti-home' => 'casa', 'ti-building' => 'predio condominio', 'ti-building-store' => 'loja',
        'ti-tag' => 'etiqueta', 'ti-barcode' => 'codigo barras etiqueta', 'ti-qrcode' => 'qr code', 'ti-signature' => 'assinatura',
        'ti-file-text' => 'documento', 'ti-file-alert' => 'documento alerta', 'ti-clipboard-check' => 'checklist ok',
        'ti-clipboard-x' => 'checklist erro', 'ti-list-check' => 'lista verificacao', 'ti-pencil' => 'editar lapis',
        'ti-message' => 'mensagem', 'ti-message-report' => 'mensagem relato', 'ti-phone' => 'telefone', 'ti-user' => 'cliente pessoa',
        'ti-users' => 'pessoas equipe', 'ti-clock' => 'hora relogio prazo', 'ti-calendar' => 'data agenda', 'ti-arrow-back-up' => 'voltar retornar',
        'ti-refresh' => 'refazer atualizar', 'ti-repeat' => 'repetir', 'ti-lock' => 'cadeado bloqueio', 'ti-shield-check' => 'seguranca ok',
        'ti-eye' => 'ver olho', 'ti-search' => 'buscar lupa', 'ti-flag' => 'bandeira marcar', 'ti-star' => 'estrela',
        'ti-link' => 'link conexao', 'ti-link-off' => 'sem conexao', 'ti-world' => 'internet mundo', 'ti-cloud' => 'nuvem',
        'ti-temperature' => 'temperatura', 'ti-droplet' => 'agua umidade', 'ti-trash' => 'lixo remover', 'ti-arrows-exchange' => 'trocar',
    ];

    /** @var array<string,array<string,mixed>>|null */
    private static ?array $cache = null;

    public static function limparCache(): void
    {
        self::$cache = null;
    }

    private static function db(?DBmysql $db): DBmysql
    {
        global $DB;
        return $db ?? $DB;
    }

    public static function descricaoPadrao(string $tipo): string
    {
        return match ($tipo) {
            'aprova'    => 'Finaliza a Auditoria (aprovada)',
            'aprova_os' => 'Finaliza a Auditoria (aprovada) e abre uma O.S. nova para o técnico da Ativação',
            default     => 'Reabre a Ativação e finaliza a Auditoria (reprovada)',
        };
    }

    /**
     * Botões em ordem, por chave. n = #id.
     * @return array<string,array{id:int,n:int,chave:string,nome:string,rotulo:string,descricao:string,tipo:string,reabre:bool,abre_os:bool,icone:string,ordem:int}>
     */
    public static function todos(?DBmysql $db = null): array
    {
        if (self::$cache !== null) {
            return self::$cache;
        }
        $db = self::db($db);
        $out = [];
        if ($db->tableExists(self::TABELA)) {
            $r = $db->doQuery('SELECT * FROM `' . self::TABELA . '` ORDER BY `ordem`, `id`');
            while ($r && ($l = $r->fetch_assoc())) {
                $tipo = self::tipo((string) $l['tipo']);
                $out[(string) $l['chave']] = ['id' => (int) $l['id'], 'n' => (int) $l['id'], 'chave' => (string) $l['chave'],
                    'nome' => (string) $l['nome'], 'rotulo' => trim((string) $l['rotulo']) !== '' ? (string) $l['rotulo'] : (string) $l['nome'],
                    'descricao' => trim((string) $l['descricao']) !== '' ? (string) $l['descricao'] : self::descricaoPadrao($tipo),
                    'tipo' => $tipo, 'reabre' => $tipo === 'reprova', 'abre_os' => $tipo === 'aprova_os', 'icone' => self::icone((string) $l['icone']), 'ordem' => (int) $l['ordem']];
            }
        }
        return self::$cache = $out;
    }

    public static function icone(string $i): string
    {
        return preg_match('/^ti-[a-z0-9-]{1,40}$/', $i) ? $i : 'ti-point';
    }

    /** Número (#) que o próximo botão novo vai receber: continua a sequência e nunca reaproveita o de um apagado. */
    public static function proximoNumero(?DBmysql $db = null): int
    {
        $db = self::db($db);
        $max = (int) ($db->doQuery('SELECT COALESCE(MAX(`id`), 0) m FROM `' . self::TABELA . '`')->fetch_assoc()['m'] ?? 0);
        $r = $db->doQuery("SHOW TABLE STATUS LIKE '" . self::TABELA . "'");
        $auto = (int) (($r ? $r->fetch_assoc() : [])['Auto_increment'] ?? 0);
        return max($max + 1, $auto, 1);
    }

    /** Respostas padrão: [baseId][chave] => id da resposta no IXC. @return array<int,array<string,int>> */
    public static function respostas(?DBmysql $db = null): array
    {
        $db = self::db($db);
        $porId = [];
        foreach (self::todos($db) as $k => $b) {
            $porId[$b['id']] = $k;
        }
        $out = [];
        $r = $db->doQuery('SELECT * FROM `' . self::TABELA_RESP . '`');
        while ($r && ($l = $r->fetch_assoc())) {
            $k = $porId[(int) $l['plugin_painelixc_botoes_id']] ?? null;
            if ($k !== null && (int) $l['resposta_id'] > 0) {
                $out[(int) $l['plugin_painelixc_bases_id']][$k] = (int) $l['resposta_id'];
            }
        }
        return $out;
    }

    /**
     * O.S. nova do "Aprova/Abrir Chamado" (0.14.0): [baseId][chave] => ['resposta' => id, 'assunto' => id] (0 = não configurado).
     * @return array<int,array<string,array{resposta:int,assunto:int}>>
     */
    public static function chamados(?DBmysql $db = null): array
    {
        $db = self::db($db);
        if (!$db->fieldExists(self::TABELA_RESP, 'chamado_assunto_id')) {
            return [];   // plugin atualizado sem plugin:install
        }
        $porId = [];
        foreach (self::todos($db) as $k => $b) {
            $porId[$b['id']] = $k;
        }
        $out = [];
        $r = $db->doQuery('SELECT * FROM `' . self::TABELA_RESP . '`');
        while ($r && ($l = $r->fetch_assoc())) {
            $k = $porId[(int) $l['plugin_painelixc_botoes_id']] ?? null;
            if ($k !== null) {
                $out[(int) $l['plugin_painelixc_bases_id']][$k] = ['resposta' => max(0, (int) $l['chamado_resposta_id']),
                    'assunto' => max(0, (int) $l['chamado_assunto_id'])];
            }
        }
        return $out;
    }

    /** Migração 0.10.0: cria os 6 botões de antes (com os nomes curtos já configurados) e copia as respostas das colunas resp_*. */
    public static function semear(DBmysql $db): void
    {
        $n = (int) ($db->doQuery('SELECT COUNT(*) n FROM `' . self::TABELA . '`')->fetch_assoc()['n'] ?? 0);
        if ($n > 0) {
            return;
        }
        $rot = json_decode((string) Config::get('rotulos_acoes'), true);
        foreach (self::PADRAO as $k => $d) {
            $db->insert(self::TABELA, ['id' => $d['id'], 'chave' => $k, 'nome' => $d['nome'],
                'rotulo' => is_array($rot) ? mb_substr(trim((string) ($rot[$k] ?? '')), 0, 40) : '',
                'descricao' => self::descricaoPadrao($d['tipo']), 'tipo' => $d['tipo'], 'icone' => $d['icone'], 'ordem' => $d['id']]);
            if ($db->fieldExists('glpi_plugin_painelixc_bases', $d['campo'])) {
                $r = $db->doQuery('SELECT `id`, `' . $d['campo'] . '` v FROM `glpi_plugin_painelixc_bases` WHERE `' . $d['campo'] . '` > 0');
                while ($r && ($l = $r->fetch_assoc())) {
                    $db->insert(self::TABELA_RESP, ['plugin_painelixc_bases_id' => (int) $l['id'], 'plugin_painelixc_botoes_id' => $d['id'], 'resposta_id' => (int) $l['v']]);
                }
            }
        }
        self::limparCache();
    }

    /**
     * Grava o cadastro de botões vindo do formulário: botao[<id>|novo<k>][nome|rotulo|tipo|descricao|icone|ordem|apagar].
     * @return array{novos: array<string,int>, avisos: list<string>} novos = "novo<k>" → id criado
     */
    public static function salvar(array $post, ?DBmysql $db = null, bool $podeCriar = true, bool $podeApagar = true): array
    {
        $db = self::db($db);
        $res = ['novos' => [], 'avisos' => []];
        $txt = static fn($v, int $max) => mb_substr(trim(strip_tags((string) $v)), 0, $max);
        $existentes = [];
        foreach (self::todos($db) as $b) {
            $existentes[$b['id']] = $b;
        }
        $ordem = 0;
        $proximo = self::proximoNumero($db);   // novos recebem #proximo, #proximo+1… na ordem em que aparecem (igual à tela)
        foreach ((array) ($post['botao'] ?? []) as $chave => $b) {
            if (!is_array($b)) {
                continue;
            }
            $ordem++;
            $chave = (string) $chave;
            $nome = $txt($b['nome'] ?? '', 80);
            $tipo = self::tipo((string) ($b['tipo'] ?? ''));
            $dados = ['nome' => $nome, 'rotulo' => $txt($b['rotulo'] ?? '', 40), 'descricao' => $txt($b['descricao'] ?? '', 200),
                'tipo' => $tipo, 'icone' => self::icone((string) ($b['icone'] ?? '')), 'ordem' => (int) ($b['ordem'] ?? $ordem) ?: $ordem];
            if (ctype_digit($chave) && isset($existentes[(int) $chave])) {
                $id = (int) $chave;
                if (!empty($b['apagar']) && !$podeApagar) {
                    $res['avisos'][] = 'Botão #' . $id . ' não foi apagado: seu perfil não tem "Auditoria → Deletar".';
                } elseif (!empty($b['apagar'])) {
                    $db->doQuery('DELETE FROM `' . self::TABELA_RESP . "` WHERE `plugin_painelixc_botoes_id` = $id");
                    $db->doQuery('DELETE FROM `' . self::TABELA . "` WHERE `id` = $id");
                    $res['avisos'][] = 'Botão #' . $id . ' (' . $existentes[$id]['nome'] . ') apagado.';
                    continue;
                }
                if ($nome === '') {
                    $res['avisos'][] = 'Botão #' . $id . ': a Ação não pode ficar vazia (mantido o nome anterior).';
                    $dados['nome'] = $existentes[$id]['nome'];
                }
                $db->update(self::TABELA, $dados, ['id' => $id]);
            } elseif (str_starts_with($chave, 'novo') && empty($b['apagar'])) {
                if (!$podeCriar) {
                    $res['avisos'][] = 'Botão novo "' . $nome . '" não foi criado: seu perfil não tem "Auditoria → Criar".';
                    continue;
                }
                if ($nome === '') {
                    $res['avisos'][] = 'Botão novo sem nome na Ação: não foi criado.';
                    continue;
                }
                $id = $proximo++;
                $db->insert(self::TABELA, $dados + ['id' => $id, 'chave' => 'b' . $id]);
                $res['novos'][$chave] = $id;
                $res['avisos'][] = 'Botão #' . $id . ' (' . $nome . ') criado.';
            }
        }
        self::limparCache();
        return $res;
    }

    /**
     * Respostas de uma base: resp[<id>|novo<k>] => id da resposta que finaliza a Auditoria (vazio/0 remove).
     * 0.14.0: respOs[...] => resposta da O.S. nova e assunto[...] => assunto da O.S. nova (só usados no aprova_os).
     * Chave ausente num dos três = mantém o valor gravado. A linha só existe se algum dos três for > 0.
     * @param array<string,int> $novos
     */
    public static function salvarRespostas(int $baseId, array $resp, array $novos, ?DBmysql $db = null, array $respOs = [], array $assunto = []): void
    {
        $db = self::db($db);
        $validos = array_column(self::todos($db), 'id');
        $temOs = $db->fieldExists(self::TABELA_RESP, 'chamado_assunto_id');
        $porId = [];
        foreach (['resposta_id' => $resp, 'chamado_resposta_id' => $respOs, 'chamado_assunto_id' => $assunto] as $campo => $lista) {
            if ($campo !== 'resposta_id' && !$temOs) {
                continue;
            }
            foreach ($lista as $chave => $v) {
                $chave = (string) $chave;
                $id = ctype_digit($chave) ? (int) $chave : ($novos[$chave] ?? 0);
                if ($id && in_array($id, $validos, true)) {
                    $porId[$id][$campo] = max(0, (int) $v);
                }
            }
        }
        foreach ($porId as $id => $novo) {
            $atual = ['resposta_id' => 0, 'chamado_resposta_id' => 0, 'chamado_assunto_id' => 0];
            $r = $db->doQuery('SELECT * FROM `' . self::TABELA_RESP . "` WHERE `plugin_painelixc_bases_id` = $baseId AND `plugin_painelixc_botoes_id` = $id");
            $l = $r ? $r->fetch_assoc() : null;
            if (is_array($l)) {
                foreach ($atual as $c => $_) {
                    $atual[$c] = (int) ($l[$c] ?? 0);
                }
            }
            $linha = array_merge($atual, $novo);
            if (!$temOs) {
                unset($linha['chamado_resposta_id'], $linha['chamado_assunto_id']);
            }
            $db->doQuery('DELETE FROM `' . self::TABELA_RESP . "` WHERE `plugin_painelixc_bases_id` = $baseId AND `plugin_painelixc_botoes_id` = $id");
            if (max($linha) > 0) {
                $db->insert(self::TABELA_RESP, ['plugin_painelixc_bases_id' => $baseId, 'plugin_painelixc_botoes_id' => $id] + $linha);
            }
        }
    }

    /** Ícones para a grade da configuração. @return list<array{icone:string,busca:string}> */
    public static function grade(): array
    {
        $o = [];
        foreach (self::ICONES as $i => $p) {
            $o[] = ['icone' => $i, 'busca' => $p . ' ' . substr($i, 3)];
        }
        return $o;
    }
}
