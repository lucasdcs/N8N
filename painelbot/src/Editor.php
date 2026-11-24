<?php

namespace GlpiPlugin\Painelbot;

use PDO;

/**
 * 0.2.0 — edição no Postgres do bot: mensagens (salvar, restaurar padrão, histórico) e perguntas
 * (criar, editar, ligar/desligar, excluir, reativar padrões). Os direitos são conferidos em front/acao.php;
 * aqui ficam as regras de dados. Toda gravação registra quem fez (nome do usuário do GLPI).
 *
 * As regras de texto (normalizar, validar variáveis e frases) são estáticas e puras para o harness testar.
 */
final class Editor
{
    public const ALVOS = ['n2' => 'Suporte N2', 'financeiro' => 'Financeiro', 'comercial' => 'Comercial', 'compras' => 'Compras', 'rh' => 'RH'];
    public const GRUPOS = ['todos', 'recados'];
    public const MAX_TEXTO = 3000;
    public const MAX_FRASE = 80;

    public function __construct(private Bot $bot, private string $quem)
    {
    }

    private function pdo(): PDO
    {
        return $this->bot->pdo();
    }

    // ---------------------------------------------------------------- regras puras

    /** Igual ao que o bot compara: minúsculo, sem acento, só letras/números, espaços simples. */
    public static function norm(string $s): string
    {
        $s = mb_strtolower($s, 'UTF-8');
        if (class_exists(\Normalizer::class)) {
            $s = preg_replace('/\p{Mn}/u', '', (string) \Normalizer::normalize($s, \Normalizer::FORM_D)) ?? $s;
        } else {
            $s = strtr($s, ['á' => 'a', 'à' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
                'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i', 'ó' => 'o', 'ò' => 'o', 'ô' => 'o', 'õ' => 'o', 'ö' => 'o',
                'ú' => 'u', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ç' => 'c', 'ñ' => 'n']);
        }
        $s = preg_replace('/[^a-z0-9 ]/', ' ', $s) ?? $s;
        return trim(preg_replace('/\s+/', ' ', $s) ?? $s);
    }

    /** Variáveis {x} usadas no texto. @return list<string> */
    public static function variaveisDoTexto(string $t): array
    {
        preg_match_all('/\{([a-z_]+)\}/', $t, $m);
        return array_values(array_unique($m[1]));
    }

    /**
     * Valida o texto de uma mensagem. Devolve [texto limpo, null] ou [null, erro].
     * @param list<string> $permitidas @return array{0:?string,1:?string}
     */
    public static function validarTexto(string $texto, array $permitidas): array
    {
        $t = str_replace(["\r\n", "\r"], "\n", $texto);
        $t = rtrim($t);
        if (trim($t) === '') {
            return [null, 'O texto não pode ficar vazio (use "Restaurar padrão" para voltar ao texto do bot).'];
        }
        if (mb_strlen($t) > self::MAX_TEXTO) {
            return [null, 'Texto grande demais (máximo ' . self::MAX_TEXTO . ' caracteres).'];
        }
        $estranhas = array_values(array_diff(self::variaveisDoTexto($t), $permitidas));
        if ($estranhas) {
            return [null, 'Variável que esta mensagem não conhece: {' . implode('}, {', $estranhas) . '}. '
                . ($permitidas ? 'Use só: {' . implode('}, {', $permitidas) . '}.' : 'Este trecho não aceita variáveis.')];
        }
        return [$t, null];
    }

    /** Valida a frase de uma pergunta. @return array{0:?string,1:?string,2:?string} [frase, frase_norm, erro] */
    public static function validarFrase(string $frase): array
    {
        $f = trim(preg_replace('/\s+/u', ' ', $frase) ?? $frase);
        $n = self::norm($f);
        if ($n === '') {
            return [null, null, 'Escreva a pergunta.'];
        }
        if (mb_strlen($f) > self::MAX_FRASE) {
            return [null, null, 'Pergunta grande demais (máximo ' . self::MAX_FRASE . ' caracteres): use só o trecho que identifica o pedido.'];
        }
        if (count(explode(' ', $n)) < 2) {
            return [null, null, 'Use pelo menos 2 palavras (ex.: "tem N2"), para o bot não responder conversa comum.'];
        }
        return [$f, $n, null];
    }

    // ---------------------------------------------------------------- mensagens

    /** @return array<string,mixed> linha da mensagem (como Bot::mensagens) */
    private function mensagem(string $chave): array
    {
        $st = $this->pdo()->prepare("SELECT chave, grupo, ordem, titulo, wf, coalesce(exemplo, '') AS exemplo, texto_padrao, texto,
                                            coalesce(array_to_json(variaveis)::text, '[]') AS variaveis,
                                            to_char(atualizado, 'DD/MM/YYYY HH24:MI') AS atualizado, coalesce(atualizado_por, '') AS atualizado_por
                                       FROM ixc.mensagens WHERE chave = ?");
        $st->execute([$chave]);
        $r = $st->fetch();
        if (!$r) {
            throw new ErroDeUso('Mensagem não encontrada: ' . $chave);
        }
        $r['variaveis'] = json_decode((string) $r['variaveis'], true) ?: [];
        $r['ordem'] = (int) $r['ordem'];
        $r['personalizada'] = $r['texto'] !== null && $r['texto'] !== $r['texto_padrao'];
        return $r;
    }

    /** Grava o texto (igual ao padrão = volta a seguir o padrão). @return array<string,mixed> */
    public function salvarMensagem(string $chave, string $texto): array
    {
        $m = $this->mensagem($chave);
        [$t, $erro] = self::validarTexto($texto, $m['variaveis']);
        if ($erro !== null) {
            throw new ErroDeUso($erro);
        }
        $novo = $t === $m['texto_padrao'] ? null : $t;
        return $this->gravarTexto($m, $novo);
    }

    /** Volta ao texto embutido no bot. @return array<string,mixed> */
    public function restaurarMensagem(string $chave): array
    {
        return $this->gravarTexto($this->mensagem($chave), null);
    }

    /** @param array<string,mixed> $m @return array<string,mixed> */
    private function gravarTexto(array $m, ?string $novo): array
    {
        $antes = $m['texto'] ?? $m['texto_padrao'];
        $depois = $novo ?? $m['texto_padrao'];
        if ($novo === $m['texto']) {
            return $m;   // nada mudou: não suja o histórico
        }
        $pdo = $this->pdo();
        $pdo->beginTransaction();
        try {
            $pdo->prepare('UPDATE ixc.mensagens SET texto = ?, atualizado = now(), atualizado_por = ? WHERE chave = ?')
                ->execute([$novo, $this->quem, $m['chave']]);
            $pdo->prepare('INSERT INTO ixc.mensagens_hist (chave, antes, depois, quem) VALUES (?, ?, ?, ?)')
                ->execute([$m['chave'], $antes, $novo === null ? '(padrão do bot) ' . $depois : $depois, $this->quem]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return $this->mensagem($m['chave']);
    }

    /** Últimas alterações de uma mensagem. @return list<array<string,mixed>> */
    public function historico(string $chave): array
    {
        $st = $this->pdo()->prepare("SELECT to_char(quando, 'DD/MM/YYYY HH24:MI') AS quando, coalesce(quem, '') AS quem, antes, depois
                                       FROM ixc.mensagens_hist WHERE chave = ? ORDER BY quando DESC, id DESC LIMIT 20");
        $st->execute([$chave]);
        return $st->fetchAll();
    }

    // ---------------------------------------------------------------- perguntas

    /** @return array<string,mixed> */
    private function pergunta(int $id): array
    {
        $st = $this->pdo()->prepare("SELECT id, alvo, frase, grupos, ativo, padrao, coalesce(criado_por, '') AS criado_por,
                                            to_char(criado_em, 'DD/MM/YYYY') AS criado_em FROM ixc.perguntas WHERE id = ?");
        $st->execute([$id]);
        $r = $st->fetch();
        if (!$r) {
            throw new ErroDeUso('Pergunta não encontrada (pode ter sido excluída por outra pessoa). Recarregue a página.');
        }
        $r['id'] = (int) $r['id'];
        $r['ativo'] = (bool) $r['ativo'];
        $r['padrao'] = (bool) $r['padrao'];
        return $r;
    }

    /** Mesma frase já cadastrada (no mesmo setor ou em outro)? Lança com a explicação. */
    private function conferirRepetida(string $norm, string $alvo, int $ignorarId = 0): void
    {
        $st = $this->pdo()->prepare('SELECT alvo, frase FROM ixc.perguntas WHERE frase_norm = ? AND id <> ? LIMIT 1');
        $st->execute([$norm, $ignorarId]);
        $r = $st->fetch();
        if ($r) {
            throw new ErroDeUso($r['alvo'] === $alvo
                ? 'Essa pergunta já existe em ' . self::ALVOS[$alvo] . ' ("' . $r['frase'] . '").'
                : 'Essa frase já aciona ' . (self::ALVOS[$r['alvo']] ?? $r['alvo']) . ' ("' . $r['frase'] . '"). Uma frase só pode acionar um setor.');
        }
    }

    /** @return array<string,mixed> */
    public function criarPergunta(string $alvo, string $frase, string $grupos): array
    {
        if (!isset(self::ALVOS[$alvo])) {
            throw new ErroDeUso('Setor inválido.');
        }
        [$f, $n, $erro] = self::validarFrase($frase);
        if ($erro !== null) {
            throw new ErroDeUso($erro);
        }
        $this->conferirRepetida($n, $alvo);
        $st = $this->pdo()->prepare('INSERT INTO ixc.perguntas (alvo, frase, frase_norm, grupos, criado_por) VALUES (?, ?, ?, ?, ?) RETURNING id');
        $st->execute([$alvo, $f, $n, in_array($grupos, self::GRUPOS, true) ? $grupos : 'todos', $this->quem]);
        return $this->pergunta((int) $st->fetchColumn());
    }

    /** Só as criadas no painel mudam de texto; as padrão só ligam/desligam. @return array<string,mixed> */
    public function editarPergunta(int $id, string $frase, string $grupos): array
    {
        $p = $this->pergunta($id);
        if ($p['padrao']) {
            throw new ErroDeUso('Pergunta padrão do bot não se edita: desligue-a e crie uma nova.');
        }
        [$f, $n, $erro] = self::validarFrase($frase);
        if ($erro !== null) {
            throw new ErroDeUso($erro);
        }
        $this->conferirRepetida($n, $p['alvo'], $id);
        $this->pdo()->prepare('UPDATE ixc.perguntas SET frase = ?, frase_norm = ?, grupos = ?, atualizado = now(), atualizado_por = ? WHERE id = ?')
            ->execute([$f, $n, in_array($grupos, self::GRUPOS, true) ? $grupos : $p['grupos'], $this->quem, $id]);
        return $this->pergunta($id);
    }

    /** @return array<string,mixed> */
    public function ligarPergunta(int $id, bool $ativo): array
    {
        $this->pergunta($id);
        $this->pdo()->prepare('UPDATE ixc.perguntas SET ativo = ?, atualizado = now(), atualizado_por = ? WHERE id = ?')
            ->execute([$ativo ? 'true' : 'false', $this->quem, $id]);
        return $this->pergunta($id);
    }

    /**
     * Criada no painel: apaga. Padrão do bot (0.3.0): some da lista e fica desligada — com a regex do bot ainda
     * ativa (opção a), apagar de verdade faria ela voltar a responder; "Restaurar padrões" traz de volta.
     */
    public function excluirPergunta(int $id): void
    {
        $p = $this->pergunta($id);
        if ($p['padrao']) {
            $this->pdo()->prepare('UPDATE ixc.perguntas SET ativo = false, excluida = true, atualizado = now(), atualizado_por = ? WHERE id = ?')
                ->execute([$this->quem, $id]);
            return;
        }
        $this->pdo()->prepare('DELETE FROM ixc.perguntas WHERE id = ? AND NOT padrao')->execute([$id]);
    }

    /** Religa (e traz de volta as excluídas) as perguntas padrão de um setor. Devolve quantas voltaram. */
    public function restaurarPadroes(string $alvo): int
    {
        if (!isset(self::ALVOS[$alvo])) {
            throw new ErroDeUso('Setor inválido.');
        }
        $st = $this->pdo()->prepare('UPDATE ixc.perguntas SET ativo = true, excluida = false, atualizado = now(), atualizado_por = ? WHERE alvo = ? AND padrao AND (NOT ativo OR excluida)');
        $st->execute([$this->quem, $alvo]);
        return $st->rowCount();
    }

    // ---------------------------------------------------------------- 0.3.0: cadastros

    public const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
    public const TIPOS = ['fixo', '12x36', 'escala'];

    /** Telefone como o bot guarda: 55 + DDD + número. '' fica ''. Inválido = null. */
    public static function fone(string $s): ?string
    {
        $d = ltrim(preg_replace('/\D/', '', $s) ?? '', '0');
        if ($d === '') {
            return '';
        }
        if (strlen($d) === 10 || strlen($d) === 11) {
            $d = '55' . $d;
        }
        return preg_match('/^55\d{10,11}$/', $d) ? $d : null;
    }

    /** "10:00-22:00" (shopping: 1 intervalo) ou "08:00-12:00,13:00-18:00" (contato: vários). '' = não atende. */
    public static function horario(string $h, bool $varios): ?string
    {
        $h = str_replace([' ', '–', '—'], ['', '-', '-'], trim($h));
        if ($h === '') {
            return '';
        }
        $partes = explode(',', $h);
        if (!$varios && count($partes) > 1) {
            return null;
        }
        foreach ($partes as $p) {
            if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/', $p) || substr($p, 0, 5) >= substr($p, 6)) {
                return null;
            }
        }
        return implode(',', $partes);
    }

    private static function jid(string $g): ?string
    {
        $g = trim($g);
        return preg_match('/^[A-Za-z0-9_.-]{3,60}@g\.us$/', $g) ? $g : null;
    }

    /** @param mixed $l @return list<string> telefones válidos, sem repetir */
    private static function fones(mixed $l): array
    {
        $out = [];
        foreach ((array) $l as $f) {
            $n = self::fone((string) $f);
            if ($n === null) {
                throw new ErroDeUso('Telefone inválido na lista de marcação: ' . $f);
            }
            if ($n !== '' && !in_array($n, $out, true)) {
                $out[] = $n;
            }
        }
        return $out;
    }

    private function existe(string $sql, array $p): bool
    {
        $st = $this->pdo()->prepare($sql);
        $st->execute($p);
        return $st->fetchColumn() !== false;
    }

    private function emTransacao(callable $fn): mixed
    {
        $pdo = $this->pdo();
        $pdo->beginTransaction();
        try {
            $r = $fn($pdo);
            $pdo->commit();
            return $r;
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Cria ou altera um shopping (ixc.locais + ixc.escala_base + apelidos só dele).
     * @param array<string,mixed> $d @return array{empresa:string,id_condominio:string}
     */
    public function salvarShopping(array $d, bool $novo): array
    {
        $emp = trim((string) ($d['empresa'] ?? ''));
        $id = trim((string) ($d['id_condominio'] ?? ''));
        $nome = trim((string) ($d['nome'] ?? ''));
        if (!$this->existe('SELECT 1 FROM ixc.empresas WHERE id = ?', [$emp])) {
            throw new ErroDeUso('Escolha a base (IXC).');
        }
        if (!preg_match('/^\d{1,10}$/', $id)) {
            throw new ErroDeUso('ID do condomínio no IXC: só números.');
        }
        if ($nome === '' || mb_strlen($nome) > 80) {
            throw new ErroDeUso('Nome do shopping: obrigatório, até 80 caracteres.');
        }
        $grupo = self::jid((string) ($d['grupo'] ?? ''));
        if ($grupo === null) {
            throw new ErroDeUso('Grupo do WhatsApp inválido (formato 1203…@g.us).');
        }
        $tec = trim((string) ($d['tec_padrao'] ?? ''));
        if ($tec !== '' && !$this->existe('SELECT 1 FROM ixc.tecnicos WHERE empresa = ? AND id_func = ?', [$emp, $tec])) {
            throw new ErroDeUso('Técnico padrão não é da base ' . $emp . '.');
        }
        $tipo = (string) ($d['tipo'] ?? 'fixo');
        if (!in_array($tipo, self::TIPOS, true)) {
            throw new ErroDeUso('Tipo de escala inválido.');
        }
        $h = [];
        foreach (self::DIAS as $dia) {
            $x = self::horario((string) ($d['horarios'][$dia] ?? ''), false);
            if ($x === null) {
                throw new ErroDeUso('Horário de ' . $dia . ' inválido: use 10:00-22:00 (vazio = não atende).');
            }
            $h[$dia] = $x === '' ? null : $x;
        }
        $equipe = mb_substr(trim((string) ($d['equipe'] ?? '')), 0, 200);
        $obs = mb_substr(trim((string) ($d['obs'] ?? '')), 0, 200);
        $sem = self::fones($d['marcar_sem_tec'] ?? []);
        $esc = self::fones($d['marcar_escalar'] ?? []);
        $apel = [];
        foreach ((array) ($d['apelidos'] ?? []) as $a) {
            $a = trim(preg_replace('/\s+/u', ' ', (string) $a) ?? '');
            $n = self::norm($a);
            if ($n === '') {
                continue;
            }
            if (mb_strlen($n) < 3 || mb_strlen($a) > 60) {
                throw new ErroDeUso('Apelido "' . $a . '": de 3 a 60 caracteres.');
            }
            $apel[$n] = $a;
        }
        $chave = $emp . ':' . $id;
        $existe = $this->existe('SELECT 1 FROM ixc.locais WHERE empresa = ? AND id_condominio = ?', [$emp, $id]);
        if ($novo && $existe) {
            throw new ErroDeUso('Já existe o shopping ' . $chave . ' (edite o que está na lista).');
        }
        if (!$novo && !$existe) {
            throw new ErroDeUso('Shopping ' . $chave . ' não encontrado (pode ter sido excluído). Recarregue a página.');
        }
        $temApelidos = !$this->existe("SELECT 1 WHERE to_regclass('ixc.apelidos') IS NULL", []);
        $this->emTransacao(function (PDO $pdo) use ($novo, $emp, $id, $nome, $grupo, $tec, $sem, $esc, $tipo, $equipe, $obs, $h, $apel, $chave, $temApelidos) {
            $arr = fn(array $a) => '{' . implode(',', $a) . '}';
            if ($novo) {
                $pdo->prepare('INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES (?, ?, ?, ?, ?, ?::text[], ?::text[])')
                    ->execute([$emp, $id, $nome, $grupo, $tec === '' ? null : $tec, $arr($sem), $arr($esc)]);
            } else {
                $pdo->prepare('UPDATE ixc.locais SET nome = ?, grupo = ?, tec_padrao = ?, marcar_sem_tec = ?::text[], marcar_escalar = ?::text[] WHERE empresa = ? AND id_condominio = ?')
                    ->execute([$nome, $grupo, $tec === '' ? null : $tec, $arr($sem), $arr($esc), $emp, $id]);
            }
            $pdo->prepare('INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT (empresa, id_condominio) DO UPDATE SET tipo = EXCLUDED.tipo, tecnicos = EXCLUDED.tecnicos,
                             seg = EXCLUDED.seg, ter = EXCLUDED.ter, qua = EXCLUDED.qua, qui = EXCLUDED.qui, sex = EXCLUDED.sex,
                             sab = EXCLUDED.sab, dom = EXCLUDED.dom, obs = EXCLUDED.obs')
                ->execute([$emp, $id, $tipo, $equipe === '' ? null : $equipe, $h['seg'], $h['ter'], $h['qua'], $h['qui'], $h['sex'], $h['sab'], $h['dom'], $obs === '' ? null : $obs]);
            if (!$temApelidos) {
                return null;
            }
            // apelidos SÓ deste shopping: os que saíram da lista são apagados, os novos entram (os de cidade/rede não mudam aqui)
            $st = $pdo->prepare('SELECT apelido_norm, alvos FROM ixc.apelidos WHERE apelido_norm = ANY (?::text[])');
            $st->execute(['{' . implode(',', array_map(fn($x) => '"' . str_replace('"', '', $x) . '"', array_keys($apel))) . '}']);
            foreach ($st->fetchAll() as $r) {
                if ($r['alvos'] !== '{' . $chave . '}') {
                    throw new ErroDeUso('O apelido "' . $apel[$r['apelido_norm']] . '" já é de outro shopping (' . trim((string) $r['alvos'], '{}') . ').');
                }
            }
            $pdo->prepare('DELETE FROM ixc.apelidos WHERE alvos = ?::text[] AND NOT (apelido_norm = ANY (?::text[]))')
                ->execute(['{' . $chave . '}', '{' . implode(',', array_map(fn($x) => '"' . $x . '"', array_keys($apel))) . '}']);
            $ins = $pdo->prepare('INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, criado_por) VALUES (?, ?, ?::text[], ?) ON CONFLICT (apelido_norm) DO NOTHING');
            foreach ($apel as $n => $a) {
                $ins->execute([$a, $n, '{' . $chave . '}', $this->quem]);
            }
            return null;
        });
        return ['empresa' => $emp, 'id_condominio' => $id];
    }

    /** Apaga o shopping (escala base, apelidos só dele; tira ele dos apelidos de cidade/rede). */
    public function excluirShopping(string $emp, string $id): void
    {
        $chave = $emp . ':' . $id;
        if (!$this->existe('SELECT 1 FROM ixc.locais WHERE empresa = ? AND id_condominio = ?', [$emp, $id])) {
            throw new ErroDeUso('Shopping não encontrado (pode já ter sido excluído). Recarregue a página.');
        }
        $st = $this->pdo()->prepare("SELECT string_agg(nome, ', ') FROM ixc.contatos_setor WHERE escala = ?");
        $st->execute([$chave]);
        $usa = (string) $st->fetchColumn();
        if ($usa !== '') {
            throw new ErroDeUso('Os contatos de setor ' . $usa . ' seguem a escala 12x36 deste shopping: mude-os antes de excluir.');
        }
        $temApelidos = !$this->existe("SELECT 1 WHERE to_regclass('ixc.apelidos') IS NULL", []);
        $this->emTransacao(function (PDO $pdo) use ($emp, $id, $chave, $temApelidos) {
            if ($temApelidos) {
                $pdo->prepare('DELETE FROM ixc.apelidos WHERE alvos = ?::text[]')->execute(['{' . $chave . '}']);
                $pdo->prepare('UPDATE ixc.apelidos SET alvos = array_remove(alvos, ?) WHERE ? = ANY (alvos)')->execute([$chave, $chave]);
                $pdo->exec("DELETE FROM ixc.apelidos WHERE cardinality(alvos) = 0");
            }
            $pdo->prepare('DELETE FROM ixc.escala_base WHERE empresa = ? AND id_condominio = ?')->execute([$emp, $id]);
            $pdo->prepare('DELETE FROM ixc.locais WHERE empresa = ? AND id_condominio = ?')->execute([$emp, $id]);
            return null;
        });
    }

    /** @param array<string,mixed> $d @return array{empresa:string,id_func:string} */
    public function salvarTecnico(array $d, bool $novo): array
    {
        $emp = trim((string) ($d['empresa'] ?? ''));
        $id = trim((string) ($d['id_func'] ?? ''));
        $nome = trim(preg_replace('/\s+/u', ' ', (string) ($d['nome'] ?? '')) ?? '');
        if (!$this->existe('SELECT 1 FROM ixc.empresas WHERE id = ?', [$emp])) {
            throw new ErroDeUso('Escolha a base (IXC).');
        }
        if (!preg_match('/^\d{1,10}$/', $id)) {
            throw new ErroDeUso('ID do colaborador no IXC: só números.');
        }
        if ($nome === '' || mb_strlen($nome) > 80) {
            throw new ErroDeUso('Nome: obrigatório, até 80 caracteres.');
        }
        $fone = self::fone((string) ($d['fone'] ?? ''));
        if ($fone === null) {
            throw new ErroDeUso('WhatsApp inválido: use DDD + número (ex.: 41 99999-0000).');
        }
        $g = trim((string) ($d['grupo'] ?? ''));
        $grupo = $g === '' ? null : self::jid($g);
        if ($g !== '' && $grupo === null) {
            throw new ErroDeUso('Grupo do WhatsApp inválido (formato 1203…@g.us).');
        }
        $st = $this->pdo()->prepare('SELECT coalesce(fone, \'\') FROM ixc.tecnicos WHERE empresa = ? AND id_func = ?');
        $st->execute([$emp, $id]);
        $antigo = $st->fetchColumn();
        if ($novo && $antigo !== false) {
            throw new ErroDeUso('Já existe o técnico ' . $emp . ' id ' . $id . ' (edite o que está na lista).');
        }
        if (!$novo && $antigo === false) {
            throw new ErroDeUso('Técnico não encontrado (pode ter sido excluído). Recarregue a página.');
        }
        $this->emTransacao(function (PDO $pdo) use ($novo, $emp, $id, $nome, $fone, $grupo, $antigo) {
            if ($novo) {
                $pdo->prepare('INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES (?, ?, ?, ?, ?)')
                    ->execute([$emp, $id, $nome, $fone === '' ? null : $fone, $grupo]);
                return null;
            }
            $pdo->prepare('UPDATE ixc.tecnicos SET nome = ?, fone = ?, grupo = ? WHERE empresa = ? AND id_func = ?')
                ->execute([$nome, $fone === '' ? null : $fone, $grupo, $emp, $id]);
            // trocou o número: as listas de marcação dos shoppings acompanham (igual ao "ixc numero")
            if ($antigo !== '' && $antigo !== $fone) {
                $pdo->prepare($fone === ''
                    ? 'UPDATE ixc.locais SET marcar_sem_tec = array_remove(marcar_sem_tec, ?), marcar_escalar = array_remove(marcar_escalar, ?) WHERE ? = ANY (marcar_sem_tec) OR ? = ANY (marcar_escalar)'
                    : 'UPDATE ixc.locais SET marcar_sem_tec = array_replace(marcar_sem_tec, ?, ?), marcar_escalar = array_replace(marcar_escalar, ?, ?) WHERE ? = ANY (marcar_sem_tec) OR ? = ANY (marcar_escalar)')
                    ->execute($fone === '' ? [$antigo, $antigo, $antigo, $antigo] : [$antigo, $fone, $antigo, $fone, $antigo, $antigo]);
            }
            return null;
        });
        return ['empresa' => $emp, 'id_func' => $id];
    }

    /** Recusa se for técnico padrão de algum shopping; tira das listas de marcação. @return string aviso */
    public function excluirTecnico(string $emp, string $id): string
    {
        $st = $this->pdo()->prepare('SELECT coalesce(fone, \'\') FROM ixc.tecnicos WHERE empresa = ? AND id_func = ?');
        $st->execute([$emp, $id]);
        $fone = $st->fetchColumn();
        if ($fone === false) {
            throw new ErroDeUso('Técnico não encontrado (pode já ter sido excluído). Recarregue a página.');
        }
        $st = $this->pdo()->prepare('SELECT string_agg(nome, \', \') FROM ixc.locais WHERE empresa = ? AND tec_padrao = ?');
        $st->execute([$emp, $id]);
        $padrao = (string) $st->fetchColumn();
        if ($padrao !== '') {
            throw new ErroDeUso('É o técnico padrão de: ' . $padrao . '. Troque o técnico desses shoppings antes de excluir.');
        }
        return (string) $this->emTransacao(function (PDO $pdo) use ($emp, $id, $fone) {
            $aviso = '';
            if ($fone !== '' && !$this->existe('SELECT 1 FROM ixc.tecnicos WHERE fone = ? AND NOT (empresa = ? AND id_func = ?)', [$fone, $emp, $id])) {
                $st = $pdo->prepare('UPDATE ixc.locais SET marcar_sem_tec = array_remove(marcar_sem_tec, ?), marcar_escalar = array_remove(marcar_escalar, ?)
                                      WHERE ? = ANY (marcar_sem_tec) OR ? = ANY (marcar_escalar) RETURNING nome');
                $st->execute([$fone, $fone, $fone, $fone]);
                $nomes = array_column($st->fetchAll(), 'nome');
                $aviso = $nomes ? ' Também saiu da marcação de: ' . implode(', ', $nomes) . '.' : '';
            }
            $pdo->prepare('DELETE FROM ixc.tecnicos WHERE empresa = ? AND id_func = ?')->execute([$emp, $id]);
            return $aviso;
        });
    }

    /** @param array<string,mixed> $d @return int id */
    public function salvarContato(array $d): int
    {
        $id = (int) ($d['id'] ?? 0);
        $setor = (string) ($d['setor'] ?? '');
        if (!isset(self::ALVOS[$setor])) {
            throw new ErroDeUso('Escolha o setor.');
        }
        $nome = trim(preg_replace('/\s+/u', ' ', (string) ($d['nome'] ?? '')) ?? '');
        if ($nome === '' || mb_strlen($nome) > 80) {
            throw new ErroDeUso('Nome: obrigatório, até 80 caracteres.');
        }
        $fone = self::fone((string) ($d['fone'] ?? ''));
        if ($fone === null) {
            throw new ErroDeUso('WhatsApp inválido: use DDD + número (ex.: 41 99999-0000).');
        }
        $escala = trim((string) ($d['escala'] ?? ''));
        if ($escala !== '' && !$this->existe("SELECT 1 FROM ixc.escala_base WHERE empresa || ':' || id_condominio = ? AND tipo IN ('12x36', 'escala')", [$escala])) {
            throw new ErroDeUso('A escala escolhida não é de um shopping 12x36.');
        }
        $h = [];
        foreach (self::DIAS as $dia) {
            $x = self::horario((string) ($d['horarios'][$dia] ?? ''), true);
            if ($x === null) {
                throw new ErroDeUso('Horário de ' . $dia . ' inválido: use 08:00-18:00 ou 08:00-12:00,13:00-18:00 (vazio = não atende).');
            }
            $h[$dia] = $x === '' ? null : $x;
        }
        $v = [$setor, max(0, min(99, (int) ($d['ordem'] ?? 0))), $nome, $fone === '' ? null : $fone,
            $h['seg'], $h['ter'], $h['qua'], $h['qui'], $h['sex'], $h['sab'], $h['dom'],
            mb_substr(trim((string) ($d['obs'] ?? '')), 0, 200) ?: null, !empty($d['ativo']) ? 'true' : 'false', $escala === '' ? null : $escala];
        if ($id > 0) {
            if (!$this->existe('SELECT 1 FROM ixc.contatos_setor WHERE id = ?', [$id])) {
                throw new ErroDeUso('Contato não encontrado (pode ter sido excluído). Recarregue a página.');
            }
            $this->pdo()->prepare('UPDATE ixc.contatos_setor SET setor = ?, ordem = ?, nome = ?, fone = ?, seg = ?, ter = ?, qua = ?, qui = ?, sex = ?, sab = ?, dom = ?, obs = ?, ativo = ?, escala = ? WHERE id = ?')
                ->execute(array_merge($v, [$id]));
            return $id;
        }
        $st = $this->pdo()->prepare('INSERT INTO ixc.contatos_setor (setor, ordem, nome, fone, seg, ter, qua, qui, sex, sab, dom, obs, ativo, escala) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id');
        $st->execute($v);
        return (int) $st->fetchColumn();
    }

    public function excluirContato(int $id): void
    {
        $st = $this->pdo()->prepare('DELETE FROM ixc.contatos_setor WHERE id = ?');
        $st->execute([$id]);
        if ($st->rowCount() === 0) {
            throw new ErroDeUso('Contato não encontrado (pode já ter sido excluído). Recarregue a página.');
        }
    }
}
