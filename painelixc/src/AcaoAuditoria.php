<?php

namespace GlpiPlugin\Painelixc;

use DBmysql;
use Toolbox;

/**
 * Ações dos botões da tela Auditoria (0.6.0), executadas direto na API do IXC da base:
 *   aprovar   → finaliza a O.S. de Auditoria com a resposta padrão "aprovada";
 *   readequar → reabre a O.S. de Ativação (status EN, mesmo técnico) com a resposta "readequação" e
 *               finaliza a Auditoria (reprovada; o processo do IXC abre outra quando a correção fechar);
 *   imagens   → idem, com a resposta "anexar imagens".
 * Rotas validadas na Resolutto em 02/10 (O.S. de teste 134/137):
 *   su_oss_chamado_reabrir {id_chamado, status, mensagem, id_resposta}
 *   su_oss_chamado_fechar  {id_chamado, status:F, id_tecnico, data_inicio, data_final, mensagem, id_resposta}
 *   aprova_os (0.14.0, "Aprova/Abrir Chamado") → finaliza a Auditoria como o "aprova" e abre uma O.S. nova, SEM atendimento,
 *               para o mesmo cliente, com o técnico e o setor da Ativação, no assunto e com a resposta configurados na base:
 *   su_oss_chamado (inclusão) — os dados de endereço/login/contrato são copiados da própria Ativação.
 *               Tudo que pode faltar é conferido ANTES de finalizar; se só a O.S. nova falhar, a Auditoria fica finalizada
 *               e a mensagem diz para abrir a O.S. pelo IXC (não tenta de novo, para não duplicar).
 * Se reabrir falhar, a Auditoria NÃO é finalizada. Tudo fica registrado em glpi_plugin_painelixc_auditoria_acoes.
 *
 * 0.16.0 (P16-1) — Retorno de Garantia: na base com o assunto RG configurado (bases.retorno_assunto_id), reprovar NÃO
 * reabre mais a Ativação. Na 1ª reprovação abre uma O.S. de Retorno de Garantia (sem atendimento, cópia da Ativação,
 * mesmo técnico e setor); nas reprovações seguintes da mesma Auditoria reabre esse mesmo RG. A Reauditoria vigia o RG.
 * O RG é gravado na reauditoria ANTES de finalizar a Auditoria: se finalizar falhar, o 2º clique não abre outro RG.
 * Base sem o assunto = fluxo antigo (reabre a Ativação).
 */
final class AcaoAuditoria
{
    /** Botões cadastrados (0.10.0: vêm da tabela glpi_plugin_painelixc_botoes; ver Botao). @return array<string,array<string,mixed>> */
    public static function acoes(?DBmysql $db = null): array
    {
        return Botao::todos($db);
    }

    /** Definição dos botões para a tela. @return list<array<string,mixed>> */
    public static function definicoes(?DBmysql $db = null): array
    {
        $out = [];
        foreach (Botao::todos($db) as $k => $d) {
            $out[] = ['acao' => $k, 'n' => $d['n'], 'nome' => $d['nome'], 'rotulo' => $d['rotulo'], 'reabre' => $d['reabre'], 'abre_os' => $d['abre_os'],
                'tipo' => $d['tipo'], 'icone' => $d['icone'], 'efeito' => $d['descricao'], 'descricao' => $d['descricao']];
        }
        return $out;
    }

    /** @var callable(string,string,array,bool):array  (url_base, rota, corpo, listar) → resposta decodificada */
    private $http;

    public function __construct(private DBmysql $db, ?callable $http = null, private ?string $agora = null)
    {
        $this->http = $http ?? [self::class, 'httpIxc'];
    }

    /** Código gravado no log/reauditoria (coluna de 20): 'readequar' (uma ação) ou 'multi:2+5' (vários motivos). */
    public static function codigo(array $acoes): string
    {
        $def = Botao::todos();
        return count($acoes) === 1 ? $acoes[0] : 'multi:' . implode('+', array_map(fn($k) => $def[$k]['n'] ?? 0, $acoes));
    }

    /** Nome legível de um código gravado ('multi:2+5' → "Readequar… + Teste de velocidade…"). */
    public static function descrever(string $codigo): string
    {
        $def = Botao::todos();
        if (isset($def[$codigo])) {
            return $def[$codigo]['nome'];
        }
        if (str_starts_with($codigo, 'multi:')) {
            $porN = array_column($def, 'nome', 'n');
            return implode(' + ', array_map(fn($n) => $porN[(int) $n] ?? ('#' . $n), explode('+', substr($codigo, 6))));
        }
        return $codigo;
    }

    /**
     * Uma ação ('aprovar', 'readequar'…) ou vários motivos de reprovação (0.8.2: ['velocidade', 'imagens']).
     * Vários motivos: reabre a Ativação UMA vez com o 1º motivo (id_resposta dele) e registra cada motivo seguinte
     * como mensagem separada na Ativação (su_oss_chamado_mensagem); a Auditoria é finalizada com todos os motivos.
     * @param string|list<string> $acoes
     * @return array{ok:bool, mensagem:string, etapa?:string, http?:int}
     */
    public function executar(int $auditoriaId, string|array $acoes, int $usersId, string $usuario): array
    {
        $acoes = array_values(array_unique(array_map('strval', is_array($acoes) ? $acoes : [$acoes])));
        $ACOES = Botao::todos($this->db);
        if (!$acoes || array_diff($acoes, array_keys($ACOES))) {
            return ['ok' => false, 'http' => 400, 'mensagem' => 'Ação desconhecida.'];
        }
        if (count($acoes) > 1) {
            foreach ($acoes as $k) {
                if (!$ACOES[$k]['reabre']) {
                    return ['ok' => false, 'http' => 400, 'mensagem' => '"' . $ACOES[$k]['nome'] . '" não pode ser combinada com motivos de reprovação.'];
                }
            }
            usort($acoes, fn($x, $y) => [$ACOES[$x]['ordem'], $ACOES[$x]['n']] <=> [$ACOES[$y]['ordem'], $ACOES[$y]['n']]);
        }
        $acao = self::codigo($acoes);
        $def = $ACOES[$acoes[0]];
        $a = $this->linha("SELECT * FROM `glpi_plugin_painelixc_auditorias` WHERE `id` = " . (int) $auditoriaId);
        if ($a === null || (int) $a['is_active'] !== 1) {
            return ['ok' => false, 'http' => 404, 'mensagem' => 'Auditoria não encontrada ou já encerrada. Atualize a tela.'];
        }
        $b = $this->linha('SELECT * FROM `glpi_plugin_painelixc_bases` WHERE `id` = ' . (int) $a['plugin_painelixc_bases_id']);
        $url = rtrim((string) ($b['ixc_url'] ?? ''), '/');
        $respBase = Botao::respostas($this->db)[(int) $a['plugin_painelixc_bases_id']] ?? [];
        $respIds = [];
        foreach ($acoes as $k) {
            $respIds[$k] = (int) ($respBase[$k] ?? 0);
        }
        $respId = $respIds[$acoes[0]];
        if ($b === null || !preg_match('#^https?://#i', $url) || empty($b['api_token']) || min($respIds) <= 0) {
            return ['ok' => false, 'http' => 422, 'mensagem' => 'Base ' . ($b['nome'] ?? '?') . ' sem URL, token da API ou resposta padrão desta ação. Configure em Configurar > Geral > Painel IXC.'];
        }
        $osAud = (int) $a['ixc_id'];
        $osAtiv = (int) ($a['origem_ixc_id'] ?? 0);
        $baseId = (int) $a['plugin_painelixc_bases_id'];
        // 0.16.0: modo da reprovação — ativacao (antigo) | rg_novo | rg_reabrir | rg_pendente (RG já aberto por um clique que não finalizou)
        $modo = 'ativacao';
        $retAnt = null;
        $assuntoRg = 0;
        if ($def['reabre']) {
            $retAnt = (new Reauditoria($this->db, null, $this->agora))->retornoDaAuditoria($baseId, $osAud);
            $assuntoRg = self::assuntoRetorno($this->db, $baseId);
            if ($retAnt !== null) {
                $modo = $retAnt['estado'] === 'aguardando' ? 'rg_pendente' : 'rg_reabrir';
                $osAtiv = $osAtiv ?: (int) $retAnt['ativacao_ixc_id'];
            } elseif ($assuntoRg > 0) {
                $modo = 'rg_novo';
            }
        }
        if ($def['reabre'] && in_array($modo, ['ativacao', 'rg_novo'], true) && $osAtiv <= 0) {
            return ['ok' => false, 'http' => 422, 'mensagem' => $modo === 'rg_novo'
                ? 'Esta auditoria não tem O.S. de Ativação: sem ela não há cliente, técnico e setor para o Retorno de Garantia.'
                : 'Esta auditoria não tem O.S. de Ativação finalizada para reabrir.'];
        }
        $os = ['resposta' => 0, 'assunto' => 0];
        if ($def['abre_os']) {
            $os = Botao::chamados($this->db)[(int) $a['plugin_painelixc_bases_id']][$acoes[0]] ?? $os;
            if ($os['resposta'] <= 0 || $os['assunto'] <= 0) {
                return ['ok' => false, 'http' => 422, 'mensagem' => 'Base ' . $b['nome'] . ' sem o assunto ou a resposta padrão da O.S. nova do botão #' . $def['n']
                    . '. Configure em Configurar > Geral > Painel IXC (engrenagem do botão e coluna "#' . $def['n'] . ' O.S.").'];
            }
            if ($osAtiv <= 0) {
                return ['ok' => false, 'http' => 422, 'mensagem' => 'Esta auditoria não tem O.S. de Ativação: sem ela não há técnico e setor para a O.S. nova.'];
            }
        }
        $tecnico = (int) ($a['id_tecnico'] ?? 0);
        if ($tecnico <= 0) {
            return ['ok' => false, 'http' => 422, 'mensagem' => 'A O.S. de Auditoria ' . $osAud . ' está sem técnico; o IXC exige o colaborador responsável para finalizar. Atribua um técnico no IXC.'];
        }

        // um clique por vez por auditoria (duplo clique / duas pessoas)
        $trava = 'pixc_acao_' . (int) $a['plugin_painelixc_bases_id'] . '_' . $osAud;
        $r = $this->db->doQuery('SELECT GET_LOCK(' . $this->db::quoteValue($trava) . ', 0) AS t');
        if ((int) (($r ? $r->fetch_assoc() : [])['t'] ?? 0) !== 1) {
            return ['ok' => false, 'http' => 409, 'mensagem' => 'Já há uma ação em andamento nesta auditoria.'];
        }
        try {
            $ja = $this->linha('SELECT `acao`, `usuario`, `quando` FROM `glpi_plugin_painelixc_auditoria_acoes`
                 WHERE `plugin_painelixc_bases_id` = ' . (int) $a['plugin_painelixc_bases_id'] . " AND `auditoria_ixc_id` = $osAud AND `ok` = 1
                   AND `quando` >= " . $this->db::quoteValue(date('Y-m-d H:i:s', strtotime(($this->agora ?? date('Y-m-d H:i:s')) . ' -30 minutes'))) . "
                   AND `quando` > COALESCE((SELECT MAX(r.criada_em) FROM `glpi_plugin_painelixc_reauditorias` r
                        WHERE r.plugin_painelixc_bases_id = " . (int) $a['plugin_painelixc_bases_id'] . " AND r.nova_auditoria_ixc_id = $osAud), '1970-01-01')
                 ORDER BY `id` DESC LIMIT 1");   // janela de 30 min: segura duplo clique; Auditoria reaberta no IXC depois pode ser tratada de novo
            if ($ja !== null) {
                return ['ok' => false, 'http' => 409, 'mensagem' => 'Esta auditoria já foi tratada (' . self::descrever((string) $ja['acao']) . ' por ' . $ja['usuario'] . ' em ' . $ja['quando'] . ').'];
            }
            $token = (new \GLPIKey())->decrypt((string) $b['api_token']);
            $chamar = fn(string $rota, array $corpo, bool $listar = false) => ($this->http)($url, $rota, $corpo, $listar, $token);
            $log = fn(bool $ok, string $etapa, string $det) => $this->registrar($a, $acao, $osAtiv ?: null, $usersId, $usuario, $ok, $etapa, $det);

            // 1) texto de cada resposta padrão
            $textos = [];
            foreach ($acoes as $k) {
                $rid = $respIds[$k];
                $rr = $chamar('su_oss_respostas', ['qtype' => 'su_oss_respostas.id', 'query' => (string) $rid, 'oper' => '=',
                    'page' => '1', 'rp' => '1', 'sortname' => 'su_oss_respostas.id', 'sortorder' => 'asc'], true);
                $textos[$k] = trim((string) ($rr['registros'][0]['resposta'] ?? ''));
                if ($textos[$k] === '') {
                    $msg = "Resposta padrão $rid (#" . $ACOES[$k]['n'] . ") não encontrada no IXC da base (" . self::erroIxc($rr) . ').';
                    $log(false, 'resposta', $msg);
                    return ['ok' => false, 'http' => 502, 'etapa' => 'resposta', 'mensagem' => $msg];
                }
            }
            $texto = $textos[$acoes[0]];

            // 1b) aprova_os: resposta da O.S. nova + a Ativação (cliente, técnico, setor, endereço) — antes de mexer em qualquer coisa
            $novaOs = null;
            if ($def['abre_os']) {
                $ro = $chamar('su_oss_respostas', ['qtype' => 'su_oss_respostas.id', 'query' => (string) $os['resposta'], 'oper' => '=',
                    'page' => '1', 'rp' => '1', 'sortname' => 'su_oss_respostas.id', 'sortorder' => 'asc'], true);
                $textoOs = trim((string) ($ro['registros'][0]['resposta'] ?? ''));
                if ($textoOs === '') {
                    $msg = 'Resposta padrão ' . $os['resposta'] . ' (O.S. nova do #' . $def['n'] . ') não encontrada no IXC da base (' . self::erroIxc($ro) . '). Nada foi feito.';
                    $log(false, 'resposta_os', $msg);
                    return ['ok' => false, 'http' => 502, 'etapa' => 'resposta_os', 'mensagem' => $msg];
                }
                $ra = $chamar('su_oss_chamado', ['qtype' => 'su_oss_chamado.id', 'query' => (string) $osAtiv, 'oper' => '=',
                    'page' => '1', 'rp' => '1', 'sortname' => 'su_oss_chamado.id', 'sortorder' => 'asc'], true);
                $ativ = $ra['registros'][0] ?? null;
                $novaOs = is_array($ativ) ? self::corpoNovaOs($ativ, $a, $os['assunto'], $textoOs, $osAud) : null;
                if ($novaOs === null) {
                    $msg = "Não consegui ler a Ativação O.S. $osAtiv no IXC, ou ela está sem cliente, técnico ou setor ("
                        . (is_array($ativ) ? 'campos vazios' : self::erroIxc($ra)) . '). Nada foi feito.';
                    $log(false, 'ativacao', $msg);
                    return ['ok' => false, 'http' => 502, 'etapa' => 'ativacao', 'mensagem' => $msg];
                }
            }
            $extras = array_slice($acoes, 1);
            $avisos = [];

            // 1c) rg_novo: lê a Ativação e monta o Retorno de Garantia — antes de mexer em qualquer coisa
            $corpoRg = null;
            if ($modo === 'rg_novo') {
                $ra = $chamar('su_oss_chamado', ['qtype' => 'su_oss_chamado.id', 'query' => (string) $osAtiv, 'oper' => '=',
                    'page' => '1', 'rp' => '1', 'sortname' => 'su_oss_chamado.id', 'sortorder' => 'asc'], true);
                $ativ = $ra['registros'][0] ?? null;
                $corpoRg = is_array($ativ) ? self::corpoNovaOs($ativ, $a, $assuntoRg, '', $osAud) : null;
                if ($corpoRg === null) {
                    $msg = "Não consegui ler a Ativação O.S. $osAtiv no IXC, ou ela está sem cliente, técnico ou setor ("
                        . (is_array($ativ) ? 'campos vazios' : self::erroIxc($ra)) . '). Nada foi feito.';
                    $log(false, 'ativacao', $msg);
                    return ['ok' => false, 'http' => 502, 'etapa' => 'ativacao', 'mensagem' => $msg];
                }
            }

            // vários motivos: evento "mensagem" do IXC para registrar os motivos seguintes; sem ele, vão juntos na reabertura
            $evento = $extras ? $this->eventoMensagem((int) $a['plugin_painelixc_bases_id'], $chamar) : 0;
            $textoReabrir = $texto;
            if ($extras && $evento <= 0) {
                $textoReabrir = implode("\n\n", array_map(fn($k) => $textos[$k], $acoes));
                $avisos[] = 'não achei o evento de mensagem do IXC; os ' . count($acoes) . ' motivos foram juntos na mensagem da reabertura';
            }

            // 2) reprovação: reabre a Ativação (antigo), abre o Retorno de Garantia ou reabre o RG desta Auditoria
            $alvo = $osAtiv;
            $nomeAlvo = 'a Ativação';
            if ($modo !== 'ativacao') {
                $nomeAlvo = 'o Retorno de Garantia';
                $alvo = $modo === 'rg_novo' ? 0 : (int) $retAnt['retorno_ixc_id'];
            }
            if ($def['reabre'] && $modo === 'rg_novo') {
                $corpoRg['mensagem'] = $textoReabrir . "\n\n(Retorno de Garantia aberto pelo Painel IXC: a Auditoria O.S. $osAud reprovou a Ativação O.S. $osAtiv.)";
                $r2 = $chamar('su_oss_chamado', $corpoRg);
                if (($r2['type'] ?? '') !== 'success') {
                    $msg = 'O IXC não abriu o Retorno de Garantia: ' . self::erroIxc($r2) . '. Nada foi feito; a Auditoria NÃO foi finalizada.';
                    $log(false, 'retorno', $msg);
                    return ['ok' => false, 'http' => 502, 'etapa' => 'retorno', 'mensagem' => $msg];
                }
                $alvo = (int) ($r2['id'] ?? 0) ?: $this->acharRetorno($chamar, (int) $corpoRg['id_cliente'], $assuntoRg);
                if ($alvo <= 0) {
                    $msg = 'O IXC aceitou o Retorno de Garantia mas não devolveu o número dele (cliente ' . $corpoRg['id_cliente'] . ', assunto '
                        . $assuntoRg . '). A Auditoria NÃO foi finalizada: confira o RG no IXC antes de clicar de novo, para não abrir outro.';
                    $log(false, 'retorno_sem_id', $msg);
                    return ['ok' => false, 'http' => 502, 'etapa' => 'retorno_sem_id', 'mensagem' => $msg];
                }
                // grava já: se finalizar a Auditoria falhar, o próximo clique encontra este RG (rg_pendente) e não abre outro
                (new Reauditoria($this->db, null, $this->agora))->marcar($baseId, $osAtiv, $osAud, $acao, $usersId, $usuario, $alvo);
            } elseif ($def['reabre'] && $modo !== 'rg_pendente') {
                $r2 = $chamar('su_oss_chamado_reabrir', ['id_chamado' => (string) $alvo, 'status' => 'EN',
                    'mensagem' => $textoReabrir, 'id_resposta' => (string) $respId]);
                if (($r2['type'] ?? '') !== 'success') {
                    $msg = "O IXC não reabriu $nomeAlvo O.S. $alvo: " . self::erroIxc($r2) . '. A Auditoria NÃO foi finalizada.';
                    $log(false, 'reabrir', $msg);
                    return ['ok' => false, 'http' => 502, 'etapa' => 'reabrir', 'mensagem' => $msg];
                }
            }
            // 2b) um registro por motivo seguinte (falha aqui não desfaz nada: o motivo vai na mensagem da Auditoria)
            if ($def['reabre'] && $modo !== 'rg_pendente' && $evento > 0) {
                foreach ($extras as $k) {
                    $rm = $chamar('su_oss_chamado_mensagem', ['id_chamado' => (string) $alvo, 'status' => 'EN',
                        'id_evento' => (string) $evento, 'mensagem' => $textos[$k], 'id_resposta' => (string) $respIds[$k]]);
                    if (($rm['type'] ?? '') !== 'success') {
                        $avisos[] = 'motivo #' . $ACOES[$k]['n'] . " não foi registrado como mensagem n$nomeAlvo (" . self::erroIxc($rm) . ')';
                    }
                }
            }
            if ($modo === 'rg_pendente') {
                $avisos[] = "o Retorno de Garantia O.S. $alvo já tinha sido aberto por um clique anterior que não finalizou a Auditoria; não foi aberto outro";
            }
            $feito = match ($modo) {
                'rg_novo' => "Retorno de Garantia O.S. $alvo aberto para o técnico (Ativação O.S. $osAtiv)",
                'rg_reabrir' => "Retorno de Garantia O.S. $alvo reaberto para o técnico",
                'rg_pendente' => "Retorno de Garantia O.S. $alvo já aberto para o técnico",
                default => "Ativação O.S. $osAtiv reaberta para o técnico",
            };

            // 3) finalizar a Auditoria
            $agora = $this->agora ?? date('Y-m-d H:i:s');
            if (!$def['reabre']) {
                $msgAud = $texto;
            } elseif (!$extras) {
                $msgAud = "Auditoria reprovada — $feito.\n\n" . $texto;
            } else {
                $msgAud = "Auditoria reprovada — $feito. Motivos (" . count($acoes) . "):";
                foreach (array_values($acoes) as $i => $k) {
                    $msgAud .= "\n\n" . ($i + 1) . '. ' . $textos[$k];
                }
            }
            $r3 = $chamar('su_oss_chamado_fechar', ['id_chamado' => (string) $osAud, 'status' => 'F', 'id_tecnico' => (string) $tecnico,
                'data_inicio' => $agora, 'data_final' => $agora, 'mensagem' => $msgAud, 'id_resposta' => (string) $respId]);
            if (($r3['type'] ?? '') !== 'success') {
                $msg = "O IXC não finalizou a Auditoria O.S. $osAud: " . self::erroIxc($r3)
                    . ($def['reabre'] ? " ($feito — JÁ FEITO; finalize a Auditoria pelo IXC" . ($modo === 'ativacao' ? '' : ' ou clique de novo: o RG não é aberto outra vez') . ').' : '.');
                $log(false, 'finalizar', $msg);
                return ['ok' => false, 'http' => 502, 'etapa' => 'finalizar', 'mensagem' => $msg];
            }

            $msg = $def['reabre']
                ? $feito . ($extras ? ' com ' . count($acoes) . ' motivos' : '') . " e Auditoria O.S. $osAud finalizada."
                : "Auditoria O.S. $osAud finalizada como dentro do padrão.";
            $etapaFim = 'concluida';

            // 4) aprova_os: abrir a O.S. nova (sem atendimento). Falha aqui NÃO desfaz a aprovação e não tenta de novo.
            if ($novaOs !== null) {
                $r4 = $chamar('su_oss_chamado', $novaOs);
                $novoId = (int) ($r4['id'] ?? 0);
                if (($r4['type'] ?? '') === 'success') {
                    $msg = "Auditoria O.S. $osAud finalizada (aprovada) e O.S. nova " . ($novoId > 0 ? $novoId . ' ' : '')
                        . 'aberta para o técnico ' . $novaOs['id_tecnico'] . ' (assunto ' . $novaOs['id_assunto'] . ', setor ' . $novaOs['setor'] . ').';
                } else {
                    $etapaFim = 'os_falhou';
                    $avisos[] = 'a Auditoria foi finalizada, mas o IXC NÃO abriu a O.S. nova (' . self::erroIxc($r4) . ') — abra pelo IXC: cliente '
                        . $novaOs['id_cliente'] . ', assunto ' . $novaOs['id_assunto'] . ', técnico ' . $novaOs['id_tecnico'] . ', setor ' . $novaOs['setor'];
                }
            }
            if ($avisos) {
                $msg .= ' Atenção: ' . implode('; ', $avisos) . '.';
            }
            $log(true, $etapaFim, $msg);
            if ($def['reabre']) {
                // vigia a Ativação (antigo) ou o RG: quando for finalizado de novo, o painel abre a reauditoria
                if ($modo === 'ativacao' || $modo === 'rg_reabrir') {
                    (new Reauditoria($this->db, null, $agora))->marcar($baseId, $osAtiv, $osAud, $acao, $usersId, $usuario, $modo === 'ativacao' ? null : $alvo);
                }
                $msg .= $modo === 'ativacao'
                    ? ' Quando o técnico finalizar a Ativação, a Auditoria nova do processo vira a reauditoria e vai para o mesmo auditor.'
                    : ' Quando o técnico finalizar o Retorno de Garantia, o painel reabre esta Auditoria como reauditoria, para o mesmo auditor.';
            }
            // some da lista na hora (o coletor confirmaria em até 10 min)
            $this->db->doQuery('UPDATE `glpi_plugin_painelixc_auditorias` SET `is_active` = 0, `status` = \'F\', `saiu_em` = '
                . $this->db::quoteValue($agora) . ' WHERE `id` = ' . (int) $a['id']);
            return ['ok' => true, 'etapa' => 'concluida', 'mensagem' => $msg];
        } finally {
            $this->db->doQuery('SELECT RELEASE_LOCK(' . $this->db::quoteValue($trava) . ')');
        }
    }

    /**
     * id_evento que o IXC usa para "registrou uma mensagem" na O.S. Primeiro procura nas mensagens já coletadas
     * desta base (detalhe das auditorias); senão pergunta ao IXC. 0 = não achou.
     */
    private function eventoMensagem(int $baseId, callable $chamar): int
    {
        $cont = [];
        $r = $this->db->doQuery("SELECT `detalhe` FROM `glpi_plugin_painelixc_auditorias` WHERE `plugin_painelixc_bases_id` = $baseId
            AND `detalhe` LIKE '%registrou uma mensagem%' ORDER BY `id` DESC LIMIT 50");
        while ($r && ($l = $r->fetch_assoc())) {
            foreach ((json_decode((string) $l['detalhe'], true)['msgs_os'] ?? []) as $m) {
                $ev = (int) ($m['evento'] ?? $m['id_evento'] ?? 0);
                if ($ev > 0 && stripos((string) ($m['historico'] ?? ''), 'registrou uma mensagem') !== false) {
                    $cont[$ev] = ($cont[$ev] ?? 0) + 1;
                }
            }
        }
        if ($cont) {
            arsort($cont);
            return (int) array_key_first($cont);
        }
        $rr = $chamar('su_oss_chamado_mensagem', ['qtype' => 'su_oss_chamado_mensagem.historico', 'query' => 'registrou uma mensagem',
            'oper' => 'L', 'page' => '1', 'rp' => '1', 'sortname' => 'su_oss_chamado_mensagem.id', 'sortorder' => 'desc'], true);
        return (int) ($rr['registros'][0]['id_evento'] ?? 0);
    }

    /** Campos da Ativação copiados para a O.S. nova (cliente, filial, login/contrato e endereço de atendimento). */
    public const CAMPOS_COPIA_OS = ['tipo', 'id_cliente', 'id_filial', 'id_login', 'id_contrato_kit', 'origem_endereco',
        'origem_endereco_estrutura', 'id_estrutura', 'id_cidade', 'bairro', 'endereco', 'complemento', 'referencia',
        'latitude', 'longitude', 'id_condominio', 'bloco', 'apartamento', 'prioridade', 'melhor_horario_agenda'];

    /**
     * Corpo da inclusão em su_oss_chamado: cópia da Ativação + assunto/resposta do botão, técnico e setor da Ativação,
     * status EN (encaminhada ao técnico) e SEM atendimento (id_ticket vazio). null = falta cliente, técnico ou setor.
     * @param array<string,mixed> $ativ registro su_oss_chamado da Ativação  @param array<string,mixed> $a auditoria
     * @return array<string,string>|null
     */
    public static function corpoNovaOs(array $ativ, array $a, int $assunto, string $texto, int $osAud): ?array
    {
        $c = [];
        foreach (self::CAMPOS_COPIA_OS as $k) {
            if (isset($ativ[$k]) && is_scalar($ativ[$k]) && (string) $ativ[$k] !== '') {
                $c[$k] = (string) $ativ[$k];
            }
        }
        $cliente = (int) ($ativ['id_cliente'] ?? 0) ?: (int) ($a['id_cliente'] ?? 0);
        $tecnico = (int) ($ativ['id_tecnico'] ?? 0) ?: (int) ($a['origem_id_tecnico'] ?? 0);
        $setor = (int) ($ativ['setor'] ?? 0);
        if ($cliente <= 0 || $tecnico <= 0 || $setor <= 0 || $assunto <= 0) {
            return null;
        }
        $c['tipo'] = ($c['tipo'] ?? '') !== '' ? $c['tipo'] : 'C';
        $c['prioridade'] = ($c['prioridade'] ?? '') !== '' ? $c['prioridade'] : 'N';
        return array_merge($c, [
            'id_cliente' => (string) $cliente, 'id_assunto' => (string) $assunto, 'setor' => (string) $setor,
            'id_tecnico' => (string) $tecnico, 'status' => 'EN', 'id_ticket' => '',
            'mensagem' => $texto . "\n\n(Aberta pelo Painel IXC ao aprovar a Auditoria O.S. $osAud.)",
        ]);
    }

    /** 0.16.0: assunto do Retorno de Garantia da base (0 = não configurado → reprovar reabre a Ativação, como antes). */
    public static function assuntoRetorno(DBmysql $db, int $baseId): int
    {
        if (!$db->fieldExists('glpi_plugin_painelixc_bases', 'retorno_assunto_id')) {
            return 0;   // plugin atualizado sem plugin:install
        }
        $r = $db->doQuery("SELECT `retorno_assunto_id` v FROM `glpi_plugin_painelixc_bases` WHERE `id` = $baseId");
        return max(0, (int) (($r ? $r->fetch_assoc() : [])['v'] ?? 0));
    }

    /** RG que o IXC criou sem devolver o id: o mais novo do cliente, no assunto RG, ainda aberto. 0 = não achou. */
    private function acharRetorno(callable $chamar, int $cliente, int $assunto): int
    {
        $r = $chamar('su_oss_chamado', ['qtype' => 'su_oss_chamado.id_cliente', 'query' => (string) $cliente, 'oper' => '=',
            'page' => '1', 'rp' => '20', 'sortname' => 'su_oss_chamado.id', 'sortorder' => 'desc'], true);
        foreach ((array) ($r['registros'] ?? []) as $o) {
            if ((int) ($o['id_assunto'] ?? 0) === $assunto && !in_array(strtoupper((string) ($o['status'] ?? '')), ['F', 'C'], true)) {
                return (int) ($o['id'] ?? 0);
            }
        }
        return 0;
    }

    /** @return array<string,mixed>|null */
    private function linha(string $sql): ?array
    {
        $r = $this->db->doQuery($sql);
        $l = $r ? $r->fetch_assoc() : null;
        return is_array($l) ? $l : null;
    }

    /** @param array<string,mixed> $a */
    private function registrar(array $a, string $acao, ?int $osAtiv, int $usersId, string $usuario, bool $ok, string $etapa, string $det): void
    {
        $this->db->insert('glpi_plugin_painelixc_auditoria_acoes', [
            'plugin_painelixc_bases_id' => (int) $a['plugin_painelixc_bases_id'], 'auditoria_ixc_id' => (int) $a['ixc_id'],
            'ativacao_ixc_id' => $osAtiv, 'acao' => $acao, 'users_id' => $usersId, 'usuario' => mb_substr($usuario, 0, 255),
            'quando' => $this->agora ?? date('Y-m-d H:i:s'), 'ok' => $ok ? 1 : 0, 'etapa' => $etapa, 'detalhe' => mb_substr($det, 0, 2000),
        ]);
        if (!$ok) {
            Toolbox::logInFile('php-errors', 'painelixc acao auditoria: ' . $det . "\n");
        }
    }

    /** @param mixed $r */
    public static function erroIxc($r): string
    {
        if (!is_array($r)) {
            return 'resposta vazia';
        }
        $m = $r['message'] ?? $r['erro'] ?? $r['bruto'] ?? json_encode($r, JSON_UNESCAPED_UNICODE);
        return mb_substr(trim(strip_tags(html_entity_decode((string) $m, ENT_QUOTES, 'UTF-8'))), 0, 300);
    }

    /** POST na API do IXC (Basic id:hash). @return array<string,mixed> */
    public static function httpIxc(string $url, string $rota, array $corpo, bool $listar, string $token): array
    {
        $h = ['Content-Type: application/json', 'Authorization: Basic ' . base64_encode($token)];
        if ($listar) {
            $h[] = 'ixcsoft: listar';
        }
        $c = curl_init($url . '/webservice/v1/' . $rota);
        curl_setopt_array($c, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($corpo, JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER => $h, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 40, CURLOPT_CONNECTTIMEOUT => 10]);
        $txt = curl_exec($c);
        $erro = curl_error($c);
        curl_close($c);
        if ($txt === false) {
            return ['type' => 'error', 'message' => 'falha de conexão com o IXC: ' . $erro];
        }
        $txt = preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', '', (string) $txt);
        $j = json_decode((string) $txt, true);
        return is_array($j) ? $j : ['type' => 'error', 'message' => 'resposta do IXC não é JSON: ' . mb_substr((string) $txt, 0, 200)];
    }

    /** Última ação por auditoria (para a tela). @return array<string,array<string,mixed>> chave "baseId:osAud" */
    public function ultimas(): array
    {
        $out = [];
        $r = $this->db->doQuery('SELECT x.* FROM `glpi_plugin_painelixc_auditoria_acoes` x
            JOIN (SELECT MAX(id) id FROM `glpi_plugin_painelixc_auditoria_acoes` GROUP BY plugin_painelixc_bases_id, auditoria_ixc_id) u ON u.id = x.id');
        while ($r && ($l = $r->fetch_assoc())) {
            $out[$l['plugin_painelixc_bases_id'] . ':' . $l['auditoria_ixc_id']] = [
                'acao' => $l['acao'], 'ok' => (int) $l['ok'], 'usuario' => $l['usuario'], 'quando' => $l['quando'],
                'etapa' => $l['etapa'], 'detalhe' => $l['detalhe'],
            ];
        }
        return $out;
    }
}
