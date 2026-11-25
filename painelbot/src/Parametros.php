<?php

namespace GlpiPlugin\Painelbot;

/**
 * 0.5.0 — o que cada parâmetro do bot (ixc.parametros) aceita, para editar na tela sem quebrar o workflow.
 * Regras puras (o harness testa sem banco). Parâmetro fora do catálogo: texto livre (até 2000 caracteres).
 *
 * tipo: modo | modo_lemb | simnao | int | hora | horarios | dias | fone | fone_ou_vazio | jid | jids | texto | url | sessao | regex | trocas
 */
final class Parametros
{
    public const MODOS = ['NENHUM', 'SIMULAR', 'REAL'];

    /** chave => [tipo, rótulo curto, min, max] (min/max só para int) */
    public const CATALOGO = [
        'envio'                 => ['modo', 'Modo de envio dos avisos de chamado (WF 01) e, se vazio abaixo, dos lembretes'],
        'envio_lembretes'       => ['modo_lemb', 'Modo de envio dos lembretes de visita (WF 02); vazio = igual ao dos avisos'],
        'envio_teste_para'      => ['fone', 'Número que recebe tudo no modo SIMULAR'],
        'aviso_privado'         => ['simnao', 'Avisos de chamado no particular do técnico'],
        'lembrete_privado'      => ['simnao', 'Lembretes de visita no particular do técnico'],
        'planta_ativo'          => ['simnao', 'Manda a planta da loja no lembrete'],
        'feriados_ativo'        => ['simnao', 'Feriados param o reaviso'],
        'escala_ler_porto_belo' => ['simnao', 'Porto Belo/Tijucas vem da planilha ESCALAS'],
        'semtec_min'            => ['int', 'Minutos sem técnico até o 1º aviso', 1, 1440],
        'realerta_min'          => ['int', 'Intervalo do reaviso (min)', 5, 1440],
        'escalar_min'           => ['int', 'Minutos sem técnico até marcar a coordenação', 10, 2880],
        'falha_max_tentativas'  => ['int', 'Reenvios de mensagem que falhou', 0, 50],
        'aviso_max_idade_min'   => ['int', 'Evento mais velho que N min não avisa (0 = só a regra do dia)', 0, 1440],
        'aviso_max_rodada'      => ['int', 'Máximo de avisos por rodada de 3 min', 1, 200],
        'reenvio_max_rodada'    => ['int', 'Máximo de reenvios por rodada', 0, 200],
        'realerta_ini'          => ['hora', 'Reaviso só a partir desta hora (0–23)'],
        'realerta_fim'          => ['hora', 'Reaviso só até esta hora (0–23)'],
        'realerta_horarios'     => ['horarios', 'Reaviso só nestes horários (HH:MM separados por vírgula; vazio = a cada intervalo)'],
        'realerta_pular_dias'   => ['dias', 'Dias sem reaviso (0 = domingo … 6 = sábado, separados por vírgula)'],
        'supervisor_fone'       => ['fone', 'WhatsApp do supervisor'],
        'coordenador_fone'      => ['fone', 'WhatsApp da coordenação'],
        'infra_fone'            => ['fone_ou_vazio', 'Particular de quem recebe o pedido de infra (vazio = não sai)'],
        'supervisor_nome'       => ['texto', 'Nome do supervisor'],
        'coordenador_nome'      => ['texto', 'Nome da coordenação'],
        'dono_nome'             => ['texto', 'Nome do dono do número do bot'],
        'grupo_dono'            => ['jid', 'Grupo do dono do número'],
        'grupo_sem_local'       => ['jid', 'Grupo dos chamados sem shopping'],
        'grupo_automacao'       => ['jid', 'Grupo de automação (comandos ixc e avisos do sistema)'],
        'setores_grupo'         => ['jids', 'Grupos onde "algum N2?" e setores respondem'],
        'escala_grupos'         => ['jids', 'Grupos onde "quem está no …?" responde'],
        'waha_url'              => ['url', 'Endereço do WAHA visto pelo n8n'],
        'waha_session'          => ['sessao', 'Sessão do WAHA (número do bot)'],
        'planta_assuntos'       => ['regex', 'Assuntos de O.S. que levam planta (expressão regular)'],
        'escala_trocar_nomes'   => ['trocas', 'Trocas na planilha ESCALAS: Quem Saiu=Quem Cobre;Outro=Substituto@AAAA-MM-DD'],
    ];

    /**
     * 0.5.1: parâmetros internos (chave do "Rodar agora" e travas de rodada do whatsapp-ixc 0.6.5):
     * não aparecem na tela e não se editam pelo painel.
     */
    public static function interno(string $chave): bool
    {
        return $chave === 'painel_rodar_chave' || str_starts_with($chave, 'rodada_');
    }

    public static function tipo(string $chave): string
    {
        return self::CATALOGO[$chave][0] ?? 'livre';
    }

    /** Para a tela: tipo, rótulo e limites de cada chave conhecida. @return array<string, array{tipo:string, rotulo:string, min?:int, max?:int}> */
    public static function paraTela(): array
    {
        $out = [];
        foreach (self::CATALOGO as $k => $c) {
            $out[$k] = ['tipo' => $c[0], 'rotulo' => $c[1]] + (isset($c[2]) ? ['min' => $c[2], 'max' => $c[3]] : []);
        }
        return $out;
    }

    /** Modo que libera mensagem de verdade nos grupos/particulares: pede confirmação. */
    public static function ligaReal(string $chave, string $novo, string $atual): bool
    {
        return in_array(self::tipo($chave), ['modo', 'modo_lemb'], true) && $novo === 'REAL' && strtoupper(trim($atual)) !== 'REAL';
    }

    private static function digitos(string $v): string
    {
        return preg_replace('/\D/', '', $v) ?? '';
    }

    /** Telefone como o bot grava: 55 + DDD + número (aceita "(41) 99999-0000"). */
    public static function fone(string $v): ?string
    {
        $d = self::digitos($v);
        if (strlen($d) === 10 || strlen($d) === 11) {
            $d = '55' . $d;
        }
        return preg_match('/^55\d{10,11}$/', $d) ? $d : null;
    }

    /**
     * Valor limpo para gravar, ou ErroDeUso com o motivo em português.
     */
    public static function validar(string $chave, string $valor): string
    {
        $c = self::CATALOGO[$chave] ?? ['livre', $chave];
        $v = trim(str_replace(["\r\n", "\r"], "\n", $valor));
        $erro = static fn(string $m) => throw new ErroDeUso($c[1] . ': ' . $m);
        switch ($c[0]) {
            case 'modo':
                $v = strtoupper($v);
                return in_array($v, self::MODOS, true) ? $v : $erro('use NENHUM, SIMULAR ou REAL.');
            case 'modo_lemb':
                $v = strtoupper($v);
                return $v === '' || in_array($v, self::MODOS, true) ? $v : $erro('use NENHUM, SIMULAR, REAL ou deixe vazio.');
            case 'simnao':
                $v = strtolower($v);
                return in_array($v, ['sim', 'nao'], true) ? $v : $erro('use sim ou nao.');
            case 'int':
                if (!preg_match('/^\d{1,5}$/', $v) || (int) $v < $c[2] || (int) $v > $c[3]) {
                    $erro('número inteiro de ' . $c[2] . ' a ' . $c[3] . '.');
                }
                return (string) (int) $v;
            case 'hora':
                return preg_match('/^\d{1,2}$/', $v) && (int) $v <= 23 ? (string) (int) $v : $erro('hora cheia de 0 a 23.');
            case 'horarios':
                if ($v === '') {
                    return '';
                }
                $l = array_map('trim', explode(',', $v));
                foreach ($l as &$h) {
                    if (!preg_match('/^([01]?\d|2[0-3]):([0-5]\d)$/', $h, $m)) {
                        $erro('"' . $h . '" não é um horário HH:MM.');
                    }
                    $h = str_pad($m[1], 2, '0', STR_PAD_LEFT) . ':' . $m[2];
                }
                unset($h);
                $l = array_values(array_unique($l));
                sort($l);
                return implode(',', $l);
            case 'dias':
                if ($v === '') {
                    return '';
                }
                $l = array_map('trim', explode(',', $v));
                foreach ($l as $d) {
                    if (!preg_match('/^[0-6]$/', $d)) {
                        $erro('"' . $d . '" não é um dia de 0 (domingo) a 6 (sábado).');
                    }
                }
                $l = array_values(array_unique($l));
                sort($l);
                return implode(',', $l);
            case 'fone_ou_vazio':
                if ($v === '') {
                    return '';
                }
                // no break
            case 'fone':
                return self::fone($v) ?? $erro('DDD + número, ex.: (dd) 9nnnn-nnnn.');
            case 'jid':
                return preg_match('/^[0-9-]{5,40}@g\.us$/', $v) ? $v : $erro('id de grupo do WhatsApp (…@g.us).');
            case 'jids':
                $l = array_values(array_filter(array_map('trim', preg_split('/[,;\s]+/', $v) ?: [])));
                if ($l === []) {
                    $erro('informe pelo menos um grupo (…@g.us).');
                }
                foreach ($l as $g) {
                    if (!preg_match('/^[0-9-]{5,40}@g\.us$/', $g)) {
                        $erro('"' . $g . '" não é um id de grupo (…@g.us).');
                    }
                }
                return implode(',', array_values(array_unique($l)));
            case 'url':
                return preg_match('#^https?://[A-Za-z0-9._\-\[\]:]{1,120}(/[^\s]*)?$#', $v) && mb_strlen($v) <= 200 ? rtrim($v, '/') : $erro('endereço http(s)://…');
            case 'sessao':
                return preg_match('/^[A-Za-z0-9_-]{1,80}$/', $v) ? $v : $erro('só letras, números, _ e -.');
            case 'regex':
                if ($v === '' || mb_strlen($v) > 300 || @preg_match('/' . str_replace('/', '\/', $v) . '/iu', '') === false) {
                    $erro('expressão regular inválida.');
                }
                return $v;
            case 'trocas':
                if ($v === '') {
                    return '';
                }
                foreach (array_filter(array_map('trim', explode(';', $v))) as $t) {
                    if (!preg_match('/^[^=;@]{2,60}=[^=;@]{2,60}(@\d{4}-\d{2}-\d{2})?$/u', $t)) {
                        $erro('"' . $t . '" fora do formato Quem Saiu=Quem Cobre ou Quem Saiu=Quem Cobre@AAAA-MM-DD.');
                    }
                }
                return implode(';', array_filter(array_map('trim', explode(';', $v))));
            case 'texto':
                return $v !== '' && mb_strlen($v) <= 80 && !str_contains($v, "\n") ? $v : $erro('de 1 a 80 caracteres, uma linha.');
            default:
                return mb_strlen($v) <= 2000 ? $v : $erro('no máximo 2000 caracteres.');
        }
    }
}
