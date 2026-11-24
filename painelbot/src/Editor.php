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
        $st = $this->pdo()->prepare(Bot::SQL_MENSAGEM . ' WHERE chave = ?');
        $st->execute([$chave]);
        $r = $st->fetch();
        if (!$r) {
            throw new ErroDeUso('Mensagem não encontrada (pode ter sido excluída por outra pessoa). Recarregue a página.');
        }
        return Bot::linhaMensagem($r);
    }

    /** Grava o texto (igual ao padrão = volta a seguir o padrão). @return array<string,mixed> */
    public function salvarMensagem(string $chave, string $texto): array
    {
        $m = $this->mensagem($chave);
        if ($m['nova']) {
            throw new ErroDeUso('Mensagem criada no painel: use "Editar".');
        }
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
        $m = $this->mensagem($chave);
        if ($m['nova']) {
            throw new ErroDeUso('Mensagem criada no painel não tem texto padrão do bot.');
        }
        return $this->gravarTexto($m, null);
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

    // ---------------------------------------------------------------- 0.4.0: ligar/desligar e mensagens novas

    public const GRUPO_NOVAS = 'Mensagens novas (respostas no grupo)';
    public const MAX_FRASES = 10;
    public const MAX_TITULO = 80;

    private function hist(string $chave, ?string $antes, ?string $depois): void
    {
        $this->pdo()->prepare('INSERT INTO ixc.mensagens_hist (chave, antes, depois, quem) VALUES (?, ?, ?, ?)')
            ->execute([$chave, $antes, $depois, $this->quem]);
    }

    /**
     * Desativada: o bot deixa o trecho vazio; se a mensagem inteira ficar vazia, não envia (whatsapp-ixc 0.5.0).
     * Vale para qualquer mensagem (decisão de 24/11). @return array<string,mixed>
     */
    public function ligarMensagem(string $chave, bool $ativo): array
    {
        $m = $this->mensagem($chave);
        if ($m['ativo'] === $ativo) {
            return $m;
        }
        $txt = $m['texto'] ?? $m['texto_padrao'];
        $this->emTransacao(function (PDO $pdo) use ($chave, $ativo, $txt) {
            $pdo->prepare('UPDATE ixc.mensagens SET ativo = ?, atualizado = now(), atualizado_por = ? WHERE chave = ?')
                ->execute([$ativo ? 'true' : 'false', $this->quem, $chave]);
            $this->hist($chave, $ativo ? '(desativada)' : $txt, $ativo ? '(ativada) ' . $txt : '(desativada)');
        });
        return $this->mensagem($chave);
    }

    /**
     * Confere os campos de uma mensagem nova. Frases: uma por linha (ou lista), 1 a 10, as mesmas regras das perguntas;
     * a mesma frase não pode acionar outra mensagem nova nem uma pergunta de setor.
     * @param list<string>|string $frases
     * @return array{0:string,1:string,2:list<string>,3:list<string>,4:string}
     */
    public function validarNova(string $titulo, string $texto, array|string $frases, string $grupos, string $ignorar = ''): array
    {
        $tit = trim(preg_replace('/\s+/u', ' ', $titulo) ?? $titulo);
        if (mb_strlen($tit) < 3) {
            throw new ErroDeUso('Dê um nome para a mensagem (ex.: "Senha do wi-fi do Jockey").');
        }
        if (mb_strlen($tit) > self::MAX_TITULO) {
            throw new ErroDeUso('Nome grande demais (máximo ' . self::MAX_TITULO . ' caracteres).');
        }
        if (trim($texto) === '') {
            throw new ErroDeUso('Escreva o texto que o bot vai responder.');
        }
        $lista = is_array($frases) ? $frases : preg_split('/\R/u', $frases);
        $fs = [];
        $ns = [];
        foreach ($lista as $f) {
            if (trim((string) $f) === '') {
                continue;
            }
            [$ff, $n, $e] = self::validarFraseNova((string) $f);
            if ($e !== null) {
                throw new ErroDeUso('"' . trim((string) $f) . '": ' . $e);
            }
            if (in_array($n, $ns, true)) {
                continue;   // repetida na mesma mensagem
            }
            $fs[] = $ff;
            $ns[] = $n;
        }
        if (!$fs) {
            throw new ErroDeUso('Escreva pelo menos uma frase que aciona a resposta (o que a pessoa escreve no grupo).');
        }
        if (count($fs) > self::MAX_FRASES) {
            throw new ErroDeUso('No máximo ' . self::MAX_FRASES . ' frases por mensagem.');
        }
        // 0.4.1: texto aceita as variáveis criadas (aba Variáveis) e {shopping} se alguma frase tiver {shopping}
        $comShopping = (bool) array_filter($ns, fn($x) => str_contains($x, '{shopping}'));
        $permitidas = $this->nomesVariaveis();   // criadas no painel (fixas e por shopping)
        if ($comShopping) {
            $permitidas[] = 'shopping';
        }
        [$t, $erro] = self::validarTexto($texto, $permitidas);
        if ($erro !== null) {
            if (!$comShopping && in_array('shopping', self::variaveisDoTexto($texto), true)) {
                throw new ErroDeUso('Para usar {shopping} no texto, coloque {shopping} na frase (ex.: "qual a holding do {shopping}").');
            }
            throw new ErroDeUso($permitidas
                ? $erro . ' Para outra, crie na aba Variáveis.'
                : str_replace('Este trecho não aceita variáveis.', 'Ainda não há variáveis: crie na aba Variáveis.', $erro));
        }
        // conflito com outra mensagem nova
        $st = $this->pdo()->prepare("SELECT titulo, f FROM ixc.mensagens m, unnest(m.frases_norm) AS f
                                       WHERE m.criada_painel AND m.chave LIKE 'resp.%' AND m.chave <> ? AND f = ANY(?::text[]) LIMIT 1");
        $st->execute([$ignorar, '{' . implode(',', array_map(fn($x) => '"' . $x . '"', $ns)) . '}']);
        if ($r = $st->fetch()) {
            throw new ErroDeUso('A frase "' . $fs[array_search($r['f'], $ns, true)] . '" já aciona a mensagem "' . $r['titulo'] . '".');
        }
        // conflito com pergunta de setor
        $st = $this->pdo()->prepare('SELECT alvo, frase FROM ixc.perguntas WHERE frase_norm = ANY(?::text[]) LIMIT 1');
        $st->execute(['{' . implode(',', array_map(fn($x) => '"' . $x . '"', $ns)) . '}']);
        if ($r = $st->fetch()) {
            throw new ErroDeUso('A frase "' . $r['frase'] . '" já aciona a resposta de ' . (self::ALVOS[$r['alvo']] ?? $r['alvo']) . ' (Perguntas). Use outra frase.');
        }
        return [$tit, (string) $t, $fs, $ns, in_array($grupos, self::GRUPOS, true) ? $grupos : 'todos'];
    }

    public const RX_VARIAVEL = '/^[a-z][a-z0-9_]{1,29}$/';
    public const RESERVADAS = ['shopping'];
    public const MAX_VALOR = 1000;

    /**
     * Frase de mensagem nova: as regras das perguntas + no máximo um {shopping} (casa com qualquer shopping cadastrado,
     * nome ou apelido). Norma: as partes normalizadas em volta de "{shopping}". @return array{0:?string,1:?string,2:?string}
     */
    public static function validarFraseNova(string $frase): array
    {
        $f = trim(preg_replace('/\s+/u', ' ', $frase) ?? $frase);
        preg_match_all('/\{([^}]*)\}/', $f, $m);
        foreach ($m[1] as $v) {
            if (mb_strtolower(trim($v)) !== 'shopping') {
                return [null, null, 'na frase só vale a variável {shopping}.'];
            }
        }
        if (count($m[1]) > 1) {
            return [null, null, 'use {shopping} uma vez só na frase.'];
        }
        if (!$m[1]) {
            return self::validarFrase($f);
        }
        $partes = preg_split('/\{[^}]*\}/', $f, 2);
        $a = self::norm($partes[0]);
        $b = self::norm($partes[1] ?? '');
        $n = trim(($a !== '' ? $a . ' ' : '') . '{shopping}' . ($b !== '' ? ' ' . $b : ''));
        if (mb_strlen($f) > self::MAX_FRASE) {
            return [null, null, 'Pergunta grande demais (máximo ' . self::MAX_FRASE . ' caracteres): use só o trecho que identifica o pedido.'];
        }
        if (count(array_filter(explode(' ', trim($a . ' ' . $b)))) < 2) {
            return [null, null, 'Use pelo menos 2 palavras além do {shopping} (ex.: "qual a holding do {shopping}").'];
        }
        $f = preg_replace('/\{[^}]*\}/', '{shopping}', $f) ?? $f;
        return [$f, $n, null];
    }

    /** Nomes das variáveis criadas (ativas ou não). @return list<string> */
    public function nomesVariaveis(): array
    {
        $st = $this->pdo()->query("SELECT substr(chave, 5) FROM ixc.mensagens WHERE chave LIKE 'var.%' ORDER BY chave");
        return array_map('strval', $st->fetchAll(PDO::FETCH_COLUMN));
    }

    /** @return array{0:string,1:string} [valor, descricao] */
    private static function validarValor(string $valor, string $descricao): array
    {
        $v = rtrim(str_replace(["\r\n", "\r"], "\n", $valor));
        if (trim($v) === '') {
            throw new ErroDeUso('Escreva o valor da variável.');
        }
        if (mb_strlen($v) > self::MAX_VALOR) {
            throw new ErroDeUso('Valor grande demais (máximo ' . self::MAX_VALOR . ' caracteres).');
        }
        if (preg_match('/\{[a-z_]+\}/', $v)) {
            throw new ErroDeUso('O valor não pode ter outra {variável} dentro.');
        }
        $d = trim(preg_replace('/\s+/u', ' ', $descricao) ?? $descricao);
        if (mb_strlen($d) > self::MAX_TITULO) {
            throw new ErroDeUso('Descrição grande demais (máximo ' . self::MAX_TITULO . ' caracteres).');
        }
        return [$v, $d];
    }

    private function variavel(string $nome): array
    {
        $st = $this->pdo()->prepare(Bot::SQL_MENSAGEM . ' WHERE chave = ?');
        $st->execute(['var.' . $nome]);
        $r = $st->fetch();
        if (!$r) {
            throw new ErroDeUso('Variável não encontrada (pode ter sido excluída por outra pessoa). Recarregue a página.');
        }
        foreach ($this->bot->variaveis() as $v) {
            if ($v['nome'] === $nome) {
                return $v;
            }
        }
        throw new ErroDeUso('Variável não encontrada.');
    }

    /**
     * 0.4.2: tipo "fixo" (valor) ou "shopping" (valor por shopping + valor padrão para quem não tiver; texto = JSON
     * {"EMPRESA:ID": valor}). @param array<string,string> $valores @return array{0:string,1:string,2:?string}
     */
    private function validarTipo(string $tipo, string $valor, array $valores, string $descricao): array
    {
        if ($tipo !== 'shopping') {
            [$v, $d] = self::validarValor($valor, $descricao);
            return [$v, $d, null];
        }
        $padrao = trim($valor) === '' ? '' : self::validarValor($valor, $descricao)[0];
        $d = self::validarValor('x', $descricao)[1];
        $locais = [];
        foreach ($this->bot->listaShoppings() as $l) {
            $locais[$l['chave']] = $l['nome'];
        }
        $limpo = [];
        foreach ($valores as $k => $v) {
            $k = (string) $k;
            if (trim((string) $v) === '') {
                continue;
            }
            if (!isset($locais[$k])) {
                throw new ErroDeUso('Shopping não encontrado: ' . $k . '. Recarregue a página.');
            }
            try {
                $limpo[$k] = self::validarValor((string) $v, '')[0];
            } catch (ErroDeUso $e) {
                throw new ErroDeUso($locais[$k] . ': ' . $e->getMessage());
            }
        }
        if ($padrao === '' && !$limpo) {
            throw new ErroDeUso('Preencha o valor de pelo menos um shopping (ou o valor padrão).');
        }
        ksort($limpo);
        return [$padrao, $d, json_encode($limpo, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)];
    }

    /** @param array<string,string> $valores @return array<string,mixed> */
    public function criarVariavel(string $nome, string $valor, string $descricao, string $tipo = 'fixo', array $valores = []): array
    {
        $nome = mb_strtolower(trim(trim($nome), '{}'));
        if (!preg_match(self::RX_VARIAVEL, $nome)) {
            throw new ErroDeUso('Nome da variável: só letras minúsculas sem acento, números e _, começando com letra (2 a 30), ex.: holding, senha_wifi.');
        }
        if (in_array($nome, self::RESERVADAS, true) || isset(Bot::VARS_BOT[$nome])) {
            throw new ErroDeUso('{' . $nome . '} já é uma variável do bot. Escolha outro nome.');
        }
        [$v, $d, $json] = $this->validarTipo($tipo, $valor, $valores, $descricao);
        $this->emTransacao(function (PDO $pdo) use ($nome, $v, $d, $json) {
            $st = $pdo->prepare('SELECT 1 FROM ixc.mensagens WHERE chave = ?');
            $st->execute(['var.' . $nome]);
            if ($st->fetchColumn()) {
                throw new ErroDeUso('Já existe a variável {' . $nome . '}.');
            }
            $pdo->prepare("INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, texto, variaveis, ativo,
                                                      criada_painel, frases, frases_norm, grupos, criado_por, criado_em, atualizado, atualizado_por)
                           VALUES (?, 'Variáveis', 0, ?, '03', NULL, ?, ?, '{}', true, true, '{}', '{}', 'todos', ?, now(), now(), ?)")
                ->execute(['var.' . $nome, $d, $v, $json, $this->quem, $this->quem]);
            $this->hist('var.' . $nome, null, '(criada) ' . ($json === null ? $v : 'por shopping: ' . $json . ($v !== '' ? ' · padrão: ' . $v : '')));
        });
        return $this->variavel($nome);
    }

    /** O nome não muda (as mensagens usam {nome}); muda tipo, valor(es) e descrição. @param array<string,string> $valores @return array<string,mixed> */
    public function editarVariavel(string $nome, string $valor, string $descricao, string $tipo = 'fixo', array $valores = []): array
    {
        $atual = $this->variavel($nome);
        [$v, $d, $json] = $this->validarTipo($tipo, $valor, $valores, $descricao);
        $antes = $atual['tipo'] === 'fixo' ? $atual['valor'] : 'por shopping: ' . json_encode($atual['valores'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . ($atual['valor'] !== '' ? ' · padrão: ' . $atual['valor'] : '');
        $depois = $json === null ? $v : 'por shopping: ' . $json . ($v !== '' ? ' · padrão: ' . $v : '');
        $this->emTransacao(function (PDO $pdo) use ($nome, $v, $d, $json, $antes, $depois) {
            $pdo->prepare("UPDATE ixc.mensagens SET titulo = ?, texto_padrao = ?, texto = ?, atualizado = now(), atualizado_por = ? WHERE chave = ?")
                ->execute([$d, $v, $json, $this->quem, 'var.' . $nome]);
            if ($antes !== $depois) {
                $this->hist('var.' . $nome, $antes, $depois);
            }
        });
        return $this->variavel($nome);
    }

    // ---------------------------------------------------------------- 0.4.2: variáveis do bot (vsys.<nome>)

    private function variavelBot(string $nome): array
    {
        foreach ($this->bot->variaveisBot() as $v) {
            if ($v['nome'] === $nome) {
                return $v;
            }
        }
        throw new ErroDeUso('Variável do bot desconhecida: {' . $nome . '}.');
    }

    /** Cria a linha vsys.<nome> se ainda não existe (com o padrão). */
    private function garantirVsys(PDO $pdo, string $nome): void
    {
        [$desc, $ex] = Bot::VARS_BOT[$nome];
        $pdo->prepare("INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, texto, variaveis, ativo,
                                                  criada_painel, frases, frases_norm, grupos, criado_por, criado_em, atualizado, atualizado_por)
                       VALUES (?, 'Variáveis do bot', 0, ?, '-', NULL, ?, NULL, '{}', true, false, '{}', '{}', 'todos', ?, now(), now(), ?)
                       ON CONFLICT (chave) DO NOTHING")
            ->execute(['vsys.' . $nome, $desc, $ex, $this->quem, $this->quem]);
    }

    /** Descrição e exemplo (só no painel: lista e pré-visualização). @return array<string,mixed> */
    public function editarVariavelBot(string $nome, string $descricao, string $exemplo): array
    {
        $this->variavelBot($nome);
        $d = trim(preg_replace('/\s+/u', ' ', $descricao) ?? $descricao);
        if ($d === '' || mb_strlen($d) > 120) {
            throw new ErroDeUso('Descrição: de 1 a 120 caracteres.');
        }
        if (mb_strlen($exemplo) > 300 || preg_match('/\{[a-z_]+\}/', $exemplo)) {
            throw new ErroDeUso('Exemplo: até 300 caracteres, sem {variável} dentro.');
        }
        $this->emTransacao(function (PDO $pdo) use ($nome, $d, $exemplo) {
            $this->garantirVsys($pdo, $nome);
            $pdo->prepare('UPDATE ixc.mensagens SET titulo = ?, texto_padrao = ?, atualizado = now(), atualizado_por = ? WHERE chave = ?')
                ->execute([$d, $exemplo, $this->quem, 'vsys.' . $nome]);
        });
        return $this->variavelBot($nome);
    }

    /** Desativada = vazia em todas as mensagens do bot (whatsapp-ixc 0.6.3). @return array<string,mixed> */
    public function ligarVariavelBot(string $nome, bool $ativo): array
    {
        $v = $this->variavelBot($nome);
        if ($v['ativo'] === $ativo) {
            return $v;
        }
        $this->emTransacao(function (PDO $pdo) use ($nome) {
            $this->garantirVsys($pdo, $nome);
        });
        $this->ligarMensagem('vsys.' . $nome, $ativo);
        return $this->variavelBot($nome);
    }

    /** Volta descrição, exemplo e "ativa" ao padrão (apaga a linha vsys.<nome>). @return array<string,mixed> */
    public function restaurarVariavelBot(string $nome): array
    {
        $this->variavelBot($nome);
        $this->pdo()->prepare("DELETE FROM ixc.mensagens WHERE chave = ? AND NOT criada_painel")->execute(['vsys.' . $nome]);
        return $this->variavelBot($nome);
    }

    /** @return array<string,mixed> */
    public function ligarVariavel(string $nome, bool $ativo): array
    {
        $this->variavel($nome);
        $this->ligarMensagem('var.' . $nome, $ativo);
        return $this->variavel($nome);
    }

    /** Só se nenhuma mensagem nova usa (senão o bot mostraria {nome} cru). */
    public function excluirVariavel(string $nome): void
    {
        $v = $this->variavel($nome);
        if ($v['usos']) {
            throw new ErroDeUso('{' . $nome . '} é usada em: ' . implode(', ', array_map(fn($u) => '"' . $u['titulo'] . '"', $v['usos']))
                . '. Tire das mensagens antes de excluir (ou desative a variável: o trecho fica vazio).');
        }
        $this->pdo()->prepare("DELETE FROM ixc.mensagens WHERE chave = ? AND criada_painel")->execute(['var.' . $nome]);
    }

    /** Histórico da variável (o mesmo das mensagens). @return list<array<string,mixed>> */
    public function historicoVariavel(string $nome): array
    {
        return $this->historico('var.' . $nome);
    }

    private static function pgArr(array $l): string
    {
        return '{' . implode(',', array_map(fn($x) => '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], (string) $x) . '"', $l)) . '}';
    }

    /** @param list<string>|string $frases @return array<string,mixed> */
    public function criarNova(string $titulo, string $texto, array|string $frases, string $grupos): array
    {
        [$tit, $t, $fs, $ns, $g] = $this->validarNova($titulo, $texto, $frases, $grupos);
        $chave = (string) $this->emTransacao(function (PDO $pdo) use ($tit, $t, $fs, $ns, $g) {
            $pdo->exec('LOCK TABLE ixc.mensagens IN SHARE ROW EXCLUSIVE MODE');   // número da chave sem corrida
            $n = (int) $pdo->query("SELECT coalesce(max(substr(chave, 6)::int), 0) + 1 FROM ixc.mensagens WHERE chave ~ '^resp\\.[0-9]+$'")->fetchColumn();
            $chave = 'resp.' . $n;
            $pdo->prepare("INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, texto, variaveis, ativo,
                                                      criada_painel, frases, frases_norm, grupos, criado_por, criado_em, atualizado, atualizado_por)
                           VALUES (?, ?, ?, ?, '03', ?, ?, NULL, '{}', true, true, ?::text[], ?::text[], ?, ?, now(), now(), ?)")
                ->execute([$chave, self::GRUPO_NOVAS, -$n, $tit, $fs[0], $t, self::pgArr($fs), self::pgArr($ns), $g, $this->quem, $this->quem]);
            $this->hist($chave, null, '(criada) ' . $t);
            return $chave;
        });
        return $this->mensagem($chave);
    }

    /** @param list<string>|string $frases @return array<string,mixed> */
    public function editarNova(string $chave, string $titulo, string $texto, array|string $frases, string $grupos): array
    {
        $m = $this->mensagem($chave);
        if (!$m['nova']) {
            throw new ErroDeUso('Só as mensagens criadas no painel mudam de nome e de frases.');
        }
        [$tit, $t, $fs, $ns, $g] = $this->validarNova($titulo, $texto, $frases, $grupos, $chave);
        $this->emTransacao(function (PDO $pdo) use ($m, $chave, $tit, $t, $fs, $ns, $g) {
            $pdo->prepare('UPDATE ixc.mensagens SET titulo = ?, exemplo = ?, texto_padrao = ?, frases = ?::text[], frases_norm = ?::text[], grupos = ?,
                                                    atualizado = now(), atualizado_por = ? WHERE chave = ? AND criada_painel')
                ->execute([$tit, $fs[0], $t, self::pgArr($fs), self::pgArr($ns), $g, $this->quem, $chave]);
            if ($t !== $m['texto_padrao']) {
                $this->hist($chave, $m['texto_padrao'], $t);
            }
        });
        return $this->mensagem($chave);
    }

    /** Só as criadas no painel. As do bot: desativar (ou restaurar o texto). */
    public function excluirNova(string $chave): void
    {
        $m = $this->mensagem($chave);
        if (!$m['nova']) {
            throw new ErroDeUso('Mensagem do bot não se exclui: use "Desativar".');
        }
        $this->pdo()->prepare('DELETE FROM ixc.mensagens WHERE chave = ? AND criada_painel')->execute([$chave]);
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
        // 0.4.0: frase de mensagem nova (to_jsonb: banco sem as colunas novas = nenhuma)
        $st = $this->pdo()->prepare("SELECT titulo FROM ixc.mensagens m WHERE (to_jsonb(m)->>'criada_painel') = 'true'
                                        AND jsonb_exists(coalesce(to_jsonb(m)->'frases_norm', '[]'::jsonb), ?) LIMIT 1");
        $st->execute([$norm]);
        if ($t = $st->fetchColumn()) {
            throw new ErroDeUso('Essa frase já aciona a mensagem nova "' . $t . '" (Mensagens).');
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
        // 0.3.1: como o nome aparece na planilha ESCALAS (12x36); vazio = o próprio nome
        $np = trim(preg_replace('/\s+/u', ' ', (string) ($d['nome_planilha'] ?? '')));
        if (mb_strlen($np) > 60 || ($np !== '' && !preg_match('/\p{L}/u', $np))) {
            throw new ErroDeUso('Nome na planilha: até 60 caracteres, com letras (ou vazio).');
        }
        $np = ($np === '' || self::norm($np) === self::norm($nome)) ? null : $np;
        $st = $this->pdo()->prepare('SELECT coalesce(fone, \'\') FROM ixc.tecnicos WHERE empresa = ? AND id_func = ?');
        $st->execute([$emp, $id]);
        $antigo = $st->fetchColumn();
        if ($novo && $antigo !== false) {
            throw new ErroDeUso('Já existe o técnico ' . $emp . ' id ' . $id . ' (edite o que está na lista).');
        }
        if (!$novo && $antigo === false) {
            throw new ErroDeUso('Técnico não encontrado (pode ter sido excluído). Recarregue a página.');
        }
        $this->emTransacao(function (PDO $pdo) use ($novo, $emp, $id, $nome, $fone, $grupo, $antigo, $np) {
            if ($novo) {
                $pdo->prepare('INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo, nome_planilha) VALUES (?, ?, ?, ?, ?, ?)')
                    ->execute([$emp, $id, $nome, $fone === '' ? null : $fone, $grupo, $np]);
                return null;
            }
            $pdo->prepare('UPDATE ixc.tecnicos SET nome = ?, fone = ?, grupo = ?, nome_planilha = ? WHERE empresa = ? AND id_func = ?')
                ->execute([$nome, $fone === '' ? null : $fone, $grupo, $np, $emp, $id]);
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
