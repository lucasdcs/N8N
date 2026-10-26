<?php

namespace GlpiPlugin\Painelixc;

use CommonDBTM;
use CommonGLPI;
use Config as GlpiConfig;
use Glpi\Application\View\TemplateRenderer;
use Session;

/**
 * Configuração do plugin (guardada em glpi_configs, contexto plugin:painelixc).
 * Aba em Configurar > Geral.
 */
final class Config extends CommonDBTM
{
    public const CONTEXTO = 'plugin:painelixc';
    public static $rightname = PLUGIN_PAINELIXC_RIGHT;

    public const PADROES = [
        'ingest_token'        => '',
        'atraso_horas'        => 48,
        'sync_intervalo_min'  => 5,
        'historico_dias'      => 90,
        'atualizar_perfis'    => '',   // até 0.11: perfis do botão Atualizar (0.12.0: só lido na migração para os direitos)
        'synclog_dias'        => 30,   // histórico de sincronizações (glpi_plugin_painelixc_synclogs) guardado por N dias
        'acoes_perfis'        => '',   // 0.6.0–0.11: perfis das ações de auditoria (0.12.0: só lido na migração)
        'acoes_grupos'        => '',   // 0.6.0–0.11: grupos das ações de auditoria (0.12.0: sem efeito — use o direito no perfil)
        'rotulos_acoes'       => '',   // 0.8.0: JSON {acao: nome no botão}; vazio = nomes padrão
        'dist_ativo'          => 0,    // 0.9.0: distribuir auditorias novas entre os auditores
        'dist_simular'        => 1,    // 0.9.0: 1 = só mostra para quem iria (não mexe no IXC)
        'dist_padrao'         => 36,   // 0.9.0: técnico que o processo do IXC coloca em toda auditoria nova (Lucas)
        'dist_auditores'      => '',   // 0.9.0: ids (colaborador IXC) dos auditores, iguais nas 5 bases
        'dist_desde'          => '',   // 0.9.0: só distribui/conta auditorias abertas a partir daqui (Y-m-d H:i:s)
        'sla_uteis_bases'     => 'buzz',   // 0.13.5: bases cujo parâmetro geral "SLA apenas em dias úteis" está marcado (P dos assuntos)
    ];

    /** @return array<string,mixed> */
    public static function todos(): array
    {
        $cfg = GlpiConfig::getConfigurationValues(self::CONTEXTO);
        return $cfg + self::PADROES;
    }

    public static function get(string $chave): mixed
    {
        return self::todos()[$chave] ?? (self::PADROES[$chave] ?? null);
    }

    public static function garantirPadroes(): void
    {
        $atual = GlpiConfig::getConfigurationValues(self::CONTEXTO);
        $novos = [];
        foreach (self::PADROES as $k => $v) {
            if (!array_key_exists($k, $atual)) {
                $novos[$k] = $v;
            }
        }
        if (empty($atual['ingest_token'])) {
            $novos['ingest_token'] = self::novoToken();
        }
        if ($novos) {
            GlpiConfig::setConfigurationValues(self::CONTEXTO, $novos);
        }
    }

    public static function novoToken(): string
    {
        return bin2hex(random_bytes(24));
    }

    public static function apagarTudo(): void
    {
        GlpiConfig::deleteConfigurationValues(self::CONTEXTO, array_keys(self::PADROES));
    }

    /** Perfis (ids) que veem o botão Atualizar; lista vazia = todos. @return list<int> */
    public static function perfisAtualizar(): array
    {
        $out = [];
        foreach (explode(',', (string) self::get('atualizar_perfis')) as $x) {
            if ((int) $x > 0) {
                $out[] = (int) $x;
            }
        }
        return $out;
    }

    /** @return list<int> ids de uma chave CSV da configuração */
    public static function ids(string $chave): array
    {
        $out = [];
        foreach (explode(',', (string) self::get($chave)) as $x) {
            if ((int) $x > 0) {
                $out[] = (int) $x;
            }
        }
        return array_values(array_unique($out));
    }

    /**
     * O usuário logado pode executar ações de auditoria (aprovar / reabrir Ativação)?
     * 0.12.0: direito "Auditoria → Atualizar" do perfil (substitui as listas de perfis/grupos da Configuração).
     */
    public static function podeAgir(): bool
    {
        return Direito::pode(Direito::AUDITORIA, READ) && Direito::pode(Direito::AUDITORIA, UPDATE);
    }

    /** O perfil ativo vê o botão "Atualizar agora" das O.S.? 0.12.0: direito "Ordem de Serviço → Atualizar". */
    public static function podeAtualizar(): bool
    {
        return Direito::pode(Direito::OS, UPDATE);
    }

    /** URL que o n8n deve chamar (absoluta, a partir da URL configurada no GLPI). */
    public static function urlIngest(): string
    {
        /** @var array $CFG_GLPI */
        global $CFG_GLPI;
        return rtrim((string) $CFG_GLPI['url_base'], '/') . '/plugins/painelixc/front/ingest.php';
    }

    // ---------------------------------------------------------------- aba em Configurar > Geral

    public static function getTypeName($nb = 0)
    {
        return 'Painel IXC';
    }

    public function getTabNameForItem(CommonGLPI $item, $withtemplate = 0)
    {
        if ($item instanceof GlpiConfig && Session::haveRight(PLUGIN_PAINELIXC_RIGHT, UPDATE)) {
            return self::createTabEntry(self::getTypeName(), 0, $item::getType(), Menu::getIcon());
        }
        return '';
    }

    public static function displayTabContentForItem(CommonGLPI $item, $tabnum = 1, $withtemplate = 0)
    {
        if ($item instanceof GlpiConfig) {
            self::mostrarFormulario();
        }
        return true;
    }

    public static function mostrarFormulario(): void
    {
        /** @var \DBmysql $DB */
        global $DB;

        $bases = iterator_to_array($DB->request([
            'FROM'  => 'glpi_plugin_painelixc_bases',
            'ORDER' => 'ordem',
        ]), false);

        // o token da API nunca vai para a tela: só a indicação de que existe
        foreach ($bases as &$b) {
            $b['tem_token'] = !empty($b['api_token']);
            unset($b['api_token']);
        }
        unset($b);

        TemplateRenderer::getInstance()->display('@painelixc/config.html.twig', [
            'cfg'        => self::todos(),
            'url_perfis' => '/front/profile.php',
            'pode_criar_botao'  => Direito::pode(Direito::AUDITORIA, CREATE),
            'pode_apagar_botao' => Direito::pode(Direito::AUDITORIA, DELETE),
            'acoes_def'  => AcaoAuditoria::definicoes(),
            'respostas'  => Botao::respostas(),
            'chamados'   => Botao::chamados(),           // 0.14.0: [baseId][chave] => {resposta, assunto} da O.S. nova
            'assuntos_base' => self::assuntosPorBase($bases),
            'tipos'      => Botao::TIPOS,
            'icones'     => Botao::grade(),
            'proximo_botao' => Botao::proximoNumero(),
            'tecnicos'   => Distribuicao::tecnicosConhecidos(),
            'dist_auditores' => Distribuicao::auditores(),
            'url_ingest' => self::urlIngest(),
            'bases'      => $bases,
            'pode_editar' => Session::haveRight(PLUGIN_PAINELIXC_RIGHT, UPDATE),
            'action'     => '/plugins/painelixc/front/config.form.php',
        ]);
    }

    /**
     * Assuntos coletados de cada base (dicionário do coletor), para a lista de sugestões da engrenagem do botão.
     * @param list<array<string,mixed>> $bases @return array<int,list<array{id:int,nome:string}>>
     */
    private static function assuntosPorBase(array $bases): array
    {
        /** @var \DBmysql $DB */
        global $DB;
        $out = [];
        foreach ($bases as $b) {
            $out[(int) $b['id']] = [];
        }
        $it = $DB->request([
            'SELECT' => ['plugin_painelixc_bases_id', 'ixc_id', 'nome'],
            'FROM'   => 'glpi_plugin_painelixc_dicionarios',
            'WHERE'  => ['tipo' => 'assuntos'],
            'ORDER'  => ['nome'],
        ]);
        foreach ($it as $r) {
            $out[(int) $r['plugin_painelixc_bases_id']][] = ['id' => (int) $r['ixc_id'], 'nome' => (string) $r['nome']];
        }
        return $out;
    }

    /** Grava o POST do formulário (já validado pelo CSRF do core). @param array<string,mixed> $post */
    public static function salvar(array $post): void
    {
        /** @var \DBmysql $DB */
        global $DB;

        Session::checkRight(PLUGIN_PAINELIXC_RIGHT, UPDATE);

        $valores = [
            'atraso_horas'       => max(1, min(720, (int) ($post['atraso_horas'] ?? 48))),
            'sync_intervalo_min' => max(1, min(120, (int) ($post['sync_intervalo_min'] ?? 5))),
            'historico_dias'     => max(7, min(3650, (int) ($post['historico_dias'] ?? 90))),
            'synclog_dias'       => max(1, min(3650, (int) ($post['synclog_dias'] ?? 30))),
        ];

        // SLA (0.13.5): bases com "SLA apenas em dias úteis" nos Parâmetros gerais do IXC
        $codigos = array_column(iterator_to_array($DB->request(['SELECT' => ['codigo'], 'FROM' => 'glpi_plugin_painelixc_bases'])), 'codigo');
        $valores['sla_uteis_bases'] = implode(',', array_values(array_intersect($codigos, array_map('strval', (array) ($post['sla_uteis'] ?? [])))));

        // distribuição de auditorias (0.9.0)
        $valores['dist_auditores'] = implode(',', array_values(array_unique(array_filter(array_map('intval', (array) ($post['dist_auditores'] ?? []))))));
        $valores['dist_padrao'] = max(0, (int) ($post['dist_padrao'] ?? 0));
        $valores['dist_ativo'] = !empty($post['dist_ativo']) ? 1 : 0;
        $valores['dist_simular'] = !empty($post['dist_simular']) ? 1 : 0;
        $desde = trim((string) ($post['dist_desde'] ?? ''));
        $ts = $desde !== '' ? strtotime(str_replace('T', ' ', $desde)) : false;
        if ($ts !== false) {
            $valores['dist_desde'] = date('Y-m-d H:i:s', $ts);
        } elseif ($valores['dist_ativo'] && (string) self::get('dist_desde') === '') {
            $valores['dist_desde'] = date('Y-m-d H:i:s');   // ligou sem data: conta a partir de agora
        }
        if (!empty($post['gerar_token'])) {
            $valores['ingest_token'] = self::novoToken();
            Session::addMessageAfterRedirect('Token novo gerado. Atualize o PAINEL_TOKEN nos coletores do n8n.', false, WARNING);
        }
        GlpiConfig::setConfigurationValues(self::CONTEXTO, $valores);

        // botões da Auditoria (0.10.0): adicionar, editar, apagar; os novos ganham coluna de resposta já vinculada
        $bt = isset($post['botao'])
            ? Botao::salvar($post, null, Direito::pode(Direito::AUDITORIA, CREATE), Direito::pode(Direito::AUDITORIA, DELETE))
            : ['novos' => [], 'avisos' => []];
        foreach ($bt['avisos'] as $m) {
            Session::addMessageAfterRedirect($m, false, INFO);
        }

        foreach ((array) ($post['base'] ?? []) as $id => $b) {
            $id = (int) $id;
            if ($id <= 0 || !is_array($b)) {
                continue;
            }
            $cor = (string) ($b['cor'] ?? '');
            $url = trim((string) ($b['ixc_url'] ?? ''));
            $dados = [
                'nome'      => mb_substr(trim((string) ($b['nome'] ?? '')), 0, 80) ?: 'Base ' . $id,
                'cor'       => preg_match('/^#[0-9a-fA-F]{6}$/', $cor) ? $cor : '#64748b',
                'ixc_url'   => $url !== '' && preg_match('#^https?://#i', $url) ? mb_substr(rtrim($url, '/'), 0, 255) : null,
                'is_active' => !empty($b['is_active']) ? 1 : 0,
            ];
            // assunto da O.S. nova (0.14.0) vem da engrenagem de cada botão: botao[<id>|novo<k>][assunto][<baseId>]
            $assunto = [];
            foreach ((array) ($post['botao'] ?? []) as $chave => $bot) {
                if (is_array($bot) && is_array($bot['assunto'] ?? null) && array_key_exists($id, $bot['assunto'])) {
                    $assunto[(string) $chave] = (int) $bot['assunto'][$id];
                }
            }
            if (is_array($b['resp'] ?? null) || is_array($b['resp_os'] ?? null) || $assunto) {
                Botao::salvarRespostas($id, (array) ($b['resp'] ?? []), $bt['novos'], null, (array) ($b['resp_os'] ?? []), $assunto);
            }
            // token da API do IXC (id:hash): campo vazio mantém o atual; "apagar" remove; guardado cifrado (GLPIKey)
            $tok = trim((string) ($b['api_token'] ?? ''));
            if (!empty($b['apagar_token'])) {
                $dados['api_token'] = null;
            } elseif ($tok !== '') {
                if (!preg_match('/^\d+:\S{10,}$/', $tok)) {
                    Session::addMessageAfterRedirect('Token da base ' . $dados['nome'] . ' ignorado: use o formato id:hash.', false, ERROR);
                } else {
                    $dados['api_token'] = (new \GLPIKey())->encrypt($tok);
                }
            }
            $DB->update('glpi_plugin_painelixc_bases', $dados, ['id' => $id]);
        }
        Session::addMessageAfterRedirect('Configuração do Painel IXC salva.', false, INFO);
    }
}
