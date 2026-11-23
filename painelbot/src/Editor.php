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

    public function excluirPergunta(int $id): void
    {
        $p = $this->pergunta($id);
        if ($p['padrao']) {
            throw new ErroDeUso('Pergunta padrão do bot não se exclui: use o botão para desligar.');
        }
        $this->pdo()->prepare('DELETE FROM ixc.perguntas WHERE id = ? AND NOT padrao')->execute([$id]);
    }

    /** Religa as perguntas padrão desligadas de um setor. Devolve quantas voltaram. */
    public function restaurarPadroes(string $alvo): int
    {
        if (!isset(self::ALVOS[$alvo])) {
            throw new ErroDeUso('Setor inválido.');
        }
        $st = $this->pdo()->prepare('UPDATE ixc.perguntas SET ativo = true, atualizado = now(), atualizado_por = ? WHERE alvo = ? AND padrao AND NOT ativo');
        $st->execute([$this->quem, $alvo]);
        return $st->rowCount();
    }
}
