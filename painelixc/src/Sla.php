<?php

namespace GlpiPlugin\Painelixc;

use DBmysql;

/**
 * 0.13.5 (P13-8) — SLA das O.S. e dos atendimentos, como o IXC calcula.
 *
 * O IXC não devolve o percentual pela API: ele é calculado na tela a partir do cadastro do ASSUNTO
 * (Sistema > Suporte > Cadastros > Assuntos > aba SLA, tabela su_oss_assunto):
 *   considerar_sla              AB = conta a partir da abertura da O.S. · AG = a partir do agendamento
 *   meta_horas_abertura         horas para finalizar a O.S. — vale para AB e AG (na tela do IXC é um campo só:
 *                               "Meta horas abertura ou agendamento/fechamento"); meta_horas_agendamento NÃO é o SLA
 *   metas_horas_abertura_ticket horas para solucionar o atendimento (sempre a partir da abertura)
 *   sla_apenas_dias_uteis       S / N / P (= padrão dos Parâmetros gerais)
 * Validado em 21/10: BUZZ (atend. 220 / O.S. 368, assunto 92, 72 h, P) -131 % / -132 % só bate contando 24 h por DIA ÚTIL
 * (sem sábado, domingo e feriado nacional); 4BTELECOM (atend. 7, P) -13792 % só bate em TEMPO CORRIDO — o "P" segue o
 * parâmetro geral de cada base (ver padraoUteis); PONTO (atend. 6, assunto 38 com "S", 24 h) -6809 % só bate em tempo corrido:
 * o "dias úteis" do assunto vale só para a O.S., o atendimento segue o parâmetro geral da base.
 * Regra da documentação: 100 % até o prazo; depois 200 − decorrido/prazo × 100.
 * O cálculo em si fica no navegador (public/js/pixc-sla.js), para correr em tempo real; esta classe só entrega o cadastro
 * dos assuntos de cada base (cache de 30 min, só os campos acima — nada de valores ou textos do assunto).
 */
final class Sla
{
    public const TABELA = 'su_oss_assunto';
    private const TTL   = 1800;
    private const TTL_FALHA = 600;   // base que recusou: tenta de novo só depois de 10 min (a tela consulta de 1 em 1 min)
    /**
     * "P" = usa o padrão dos Parâmetros gerais da BASE (Configurações > Parâmetros > Parâmetros gerais > aba Suporte >
     * "SLA apenas em dias úteis"), que a API não expõe. Fica na Configuração do painel (sla_uteis_bases = códigos das
     * bases marcadas). Conferido em 21/10: BUZZ = dias úteis (atend. 220: -131 %); 4BTELECOM = tempo corrido (atend. 7: -13792 %).
     */
    public static function padraoUteis(string $codigo): bool
    {
        $lista = array_filter(array_map('trim', explode(',', (string) Config::get('sla_uteis_bases'))));
        return in_array($codigo, $lista, true);
    }

    /** @var callable(string,string,array,bool,string):array */
    private $http;

    public function __construct(private DBmysql $db, ?callable $http = null)
    {
        $this->http = $http ?? [AcaoAuditoria::class, 'httpIxc'];
    }

    /**
     * @return array{regra: array<string,mixed>, bases: array<string, array<int, array<string,mixed>>>, avisos: list<string>}
     *   bases[codigo][id_assunto] = ['ini' => 'AB'|'AG', 'h_os' => float, 'h_atd' => float, 'uteis_os' => bool, 'uteis_atd' => bool]
     */
    public function configs(): array
    {
        $out = ['bases' => [], 'avisos' => []];
        foreach ($this->db->request(['FROM' => 'glpi_plugin_painelixc_bases', 'WHERE' => ['is_active' => 1], 'ORDER' => 'ordem']) as $b) {
            $cod = (string) $b['codigo'];
            if (empty($b['api_token']) || !preg_match('#^https?://#i', (string) ($b['ixc_url'] ?? ''))) {
                continue;   // sem token: sem SLA (a tela mostra "—")
            }
            $cfg = $this->cache('painelixc_sla3_' . $cod, function () use ($cod): array {
                $ac = Cliente::acessoBase($this->db, $cod);
                if (is_string($ac)) {
                    return ['erro' => $ac];
                }
                $t = self::TABELA;
                $r = ($this->http)($ac['url'], $t, ['qtype' => "$t.id", 'oper' => '>', 'query' => '0', 'page' => '1', 'rp' => '2000',
                    'sortname' => "$t.id", 'sortorder' => 'asc'], true, $ac['token']);
                if (($r['type'] ?? '') === 'error') {
                    return ['erro' => 'SLA dos assuntos (' . $t . ') indisponível: ' . AcaoAuditoria::erroIxc($r)];
                }
                $m = [];
                foreach (Ingest::registros($r) as $x) {
                    $id = (int) Ingest::int($x['id'] ?? null);
                    if ($id > 0) {
                        $m[$id] = self::assunto($x);
                    }
                }
                return ['assuntos' => $m];
            });
            if (isset($cfg['erro'])) {
                $out['avisos'][] = $cod . ': ' . $cfg['erro'];
                continue;
            }
            $cfg = $cfg['assuntos'] ?? null;
            if (is_array($cfg)) {
                $padrao = self::padraoUteis($cod);   // resolvido fora do cache: mudar a Configuração vale na hora
                foreach ($cfg as &$a) {
                    // O.S.: o "dias úteis" do assunto (S/N) manda; P = padrão da base.
                    // Atendimento: sempre o padrão da base — o campo do assunto não vale para o atendimento
                    // (PONTO atend. 6, assunto 38 com S: o IXC mostra -6809 % = tempo corrido; a PONTO não é "dias úteis").
                    $a['uteis_os'] = $a['u'] === 'S' || ($a['u'] === 'P' && $padrao);
                    $a['uteis_atd'] = $padrao;
                    unset($a['u']);
                }
                unset($a);
                $out['bases'][$cod] = $cfg;
            }
        }
        return $out;
    }

    /** Só o que o cálculo usa. @param array<string,mixed> $x @return array<string,mixed> */
    public static function assunto(array $x): array
    {
        $h = static fn($v) => is_numeric($v) ? round((float) $v, 2) : 0.0;
        $u = strtoupper(trim((string) ($x['sla_apenas_dias_uteis'] ?? 'P')));
        return [
            'ini'   => strtoupper(trim((string) ($x['considerar_sla'] ?? 'AB'))) === 'AG' ? 'AG' : 'AB',
            'h_os'  => $h($x['meta_horas_abertura'] ?? 0),
            'h_atd' => $h($x['metas_horas_abertura_ticket'] ?? 0),
            'u'     => in_array($u, ['S', 'N'], true) ? $u : 'P',   // S = só dias úteis · N = corrido · P = padrão da base
        ];
    }

    /** Cache do GLPI (PSR-16) quando existir. Falha (['erro' => …]) fica guardada por menos tempo. */
    private function cache(string $chave, callable $gerar): array
    {
        /** @var \Psr\SimpleCache\CacheInterface|null $GLPI_CACHE */
        global $GLPI_CACHE;
        try {
            if ($GLPI_CACHE && is_array($v = $GLPI_CACHE->get($chave))) {
                return $v;
            }
        } catch (\Throwable $e) {
            // sem cache
        }
        $v = $gerar();
        if (is_array($v)) {
            try {
                $GLPI_CACHE?->set($chave, $v, isset($v['erro']) ? self::TTL_FALHA : self::TTL);
            } catch (\Throwable $e) {
                // sem cache
            }
        }
        return $v;
    }
}
