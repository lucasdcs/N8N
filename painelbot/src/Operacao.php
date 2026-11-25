<?php

namespace GlpiPlugin\Painelbot;

use PDO;

/**
 * 0.5.0 — gravações de operação no Postgres do bot: valor dos parâmetros, dados das bases (ixc.empresas),
 * troca do token do IXC (só grava; o usuário do painel não lê a coluna auth) e a auditoria (ixc.painel_auditoria).
 * Direitos conferidos em front/acao.php. Parâmetros não são criados nem apagados; bases são criadas (0.5.1, inativas), nunca apagadas.
 */
final class Operacao
{
    public function __construct(private Bot $bot, private string $quem)
    {
    }

    private function pdo(): PDO
    {
        return $this->bot->pdo();
    }

    /** Registra uma alteração (também usada para pausar/retomar workflow). */
    public function registrar(string $acao, string $alvo, ?string $antes, ?string $depois): void
    {
        $st = $this->pdo()->prepare('INSERT INTO ixc.painel_auditoria (quem, acao, alvo, antes, depois) VALUES (?, ?, ?, ?, ?)');
        $st->execute([$this->quem, $acao, mb_substr($alvo, 0, 200), $antes, $depois]);
    }

    /** @return list<array<string,mixed>> */
    public function auditoria(int $limite = 60, string $alvo = ''): array
    {
        $sql = "SELECT id, to_char(ts, 'DD/MM/YYYY HH24:MI') AS em, quem, acao, alvo, coalesce(antes, '') AS antes, coalesce(depois, '') AS depois
                  FROM ixc.painel_auditoria" . ($alvo !== '' ? ' WHERE alvo = ?' : '') . ' ORDER BY id DESC LIMIT ' . max(1, min(200, $limite));
        $st = $this->pdo()->prepare($sql);
        $st->execute($alvo !== '' ? [$alvo] : []);
        return $st->fetchAll();
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
     * Grava o valor de um parâmetro que já existe. Ligar o modo REAL exige $confirmar === 'REAL'.
     * @return array{chave:string, valor:string, antes:string}
     */
    public function salvarParametro(string $chave, string $valor, string $confirmar = ''): array
    {
        if (!preg_match('/^[a-z0-9_]{1,60}$/', $chave) || Parametros::interno($chave)) {
            throw new ErroDeUso('Parâmetro inválido.');
        }
        $st = $this->pdo()->prepare('SELECT valor FROM ixc.parametros WHERE chave = ?');
        $st->execute([$chave]);
        $atual = $st->fetchColumn();
        if ($atual === false) {
            throw new ErroDeUso('O parâmetro "' . $chave . '" não existe no banco do bot (o painel não cria parâmetros).');
        }
        $atual = (string) $atual;
        $novo = Parametros::validar($chave, $valor);
        if (Parametros::ligaReal($chave, $novo, $atual) && strtoupper(trim($confirmar)) !== 'REAL') {
            throw new ErroDeUso('Modo REAL manda mensagens de verdade aos técnicos e grupos. Para confirmar, digite REAL.');
        }
        if ($novo === $atual) {
            return ['chave' => $chave, 'valor' => $novo, 'antes' => $atual];
        }
        $this->emTransacao(function (PDO $pdo) use ($chave, $novo, $atual) {
            $pdo->prepare('UPDATE ixc.parametros SET valor = ? WHERE chave = ?')->execute([$novo, $chave]);
            $this->registrar('parametro', $chave, $atual, $novo);
        });
        return ['chave' => $chave, 'valor' => $novo, 'antes' => $atual];
    }

    /** Lista de ids de assunto do IXC ("12, 30 45") → text[] do Postgres. @return list<string> */
    public static function idsAssunto(mixed $v): array
    {
        $l = is_array($v) ? $v : (preg_split('/[,;\s]+/', (string) $v) ?: []);
        $out = [];
        foreach ($l as $x) {
            $x = trim((string) $x);
            if ($x === '') {
                continue;
            }
            if (!preg_match('/^\d{1,9}$/', $x)) {
                throw new ErroDeUso('"' . $x . '" não é um id de assunto do IXC (só números).');
            }
            $out[(string) (int) $x] = true;
        }
        $out = array_map('strval', array_keys($out));
        sort($out, SORT_NUMERIC);
        return $out;
    }

    private static function pgArr(array $l): string
    {
        return '{' . implode(',', array_map(fn($x) => '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], (string) $x) . '"', $l)) . '}';
    }

    /** @return array<string,mixed> base sem o token */
    private function base(string $id): array
    {
        $st = $this->pdo()->prepare("SELECT id, nome, base_url, ativo, coalesce(dono_id, '') AS dono_id, semtec_sem_local,
                                            array_to_string(coalesce(ignorar_assuntos, '{}'), ',') AS ignorar_assuntos,
                                            array_to_string(coalesce(assuntos_financeiros, '{}'), ',') AS assuntos_financeiros
                                       FROM ixc.empresas WHERE id = ?");
        $st->execute([$id]);
        $r = $st->fetch();
        if (!$r) {
            throw new ErroDeUso('Base "' . $id . '" não encontrada (o painel não cria bases).');
        }
        return $r;
    }

    /**
     * Edita uma base: nome, endereço do IXC, ativa, dono do número (id do colaborador), sem técnico e sem shopping, assuntos.
     * @param array<string,mixed> $d @return array<string,mixed>
     */
    public function salvarBase(string $id, array $d): array
    {
        $antes = $this->base($id);
        $nome = trim((string) ($d['nome'] ?? ''));
        if ($nome === '' || mb_strlen($nome) > 80) {
            throw new ErroDeUso('Nome da base: de 1 a 80 caracteres.');
        }
        $url = self::urlIxc((string) ($d['base_url'] ?? ''));
        $dono = trim((string) ($d['dono_id'] ?? ''));
        if ($dono !== '' && !preg_match('/^\d{1,9}$/', $dono)) {
            throw new ErroDeUso('Dono do número: o id do colaborador no IXC (só números) ou vazio.');
        }
        $ign = self::idsAssunto($d['ignorar_assuntos'] ?? '');
        $fin = self::idsAssunto($d['assuntos_financeiros'] ?? '');
        $ativo = !empty($d['ativo']);
        $semLocal = !empty($d['semtec_sem_local']);
        $depois = ['id' => $id, 'nome' => $nome, 'base_url' => $url, 'ativo' => $ativo, 'dono_id' => $dono, 'semtec_sem_local' => $semLocal,
                   'ignorar_assuntos' => implode(',', $ign), 'assuntos_financeiros' => implode(',', $fin)];
        $mudou = [];
        foreach ($depois as $k => $v) {
            if ((string) (is_bool($v) ? (int) $v : $v) !== (string) (is_bool($antes[$k]) ? (int) $antes[$k] : $antes[$k])) {
                $mudou[$k] = true;
            }
        }
        if ($mudou === []) {
            return $depois;
        }
        $this->emTransacao(function (PDO $pdo) use ($id, $nome, $url, $ativo, $dono, $semLocal, $ign, $fin, $antes, $depois, $mudou) {
            $pdo->prepare('UPDATE ixc.empresas SET nome = ?, base_url = ?, ativo = ?, dono_id = ?, semtec_sem_local = ?, ignorar_assuntos = ?::text[], assuntos_financeiros = ?::text[] WHERE id = ?')
                ->execute([$nome, $url, $ativo ? 't' : 'f', $dono === '' ? null : $dono, $semLocal ? 't' : 'f', self::pgArr($ign), self::pgArr($fin), $id]);
            $txt = static fn(array $b) => json_encode(array_intersect_key($b, $mudou), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $this->registrar('base', $id, $txt($antes), $txt($depois));
        });
        return $depois;
    }

    /** Endereço do IXC: https (http só para o simulador / rede interna), sem barra no fim e sem o /webservice. */
    public static function urlIxc(string $u): string
    {
        $url = rtrim(trim($u), '/');
        if (!preg_match('#^https?://[A-Za-z0-9._-]{3,120}(:\d{2,5})?(/[A-Za-z0-9._~%/-]*)?$#', $url) || str_contains($url, '/webservice')) {
            throw new ErroDeUso('Endereço do IXC: https://… sem o /webservice (ex.: https://ixc.suaempresa.com.br).');
        }
        return $url;
    }

    /** "id:chave", o base64 ou "Basic ..." → valor do cabeçalho Authorization que o bot manda ao IXC. */
    public static function auth(string $token): string
    {
        $t = trim((string) preg_replace('/^Basic\s+/i', '', trim($token)));
        if (!preg_match('/^[A-Za-z0-9:+\/=._-]{8,300}$/', $t)) {
            throw new ErroDeUso('Token: cole o token do usuário da API do IXC (formato id:chave), sem espaços.');
        }
        return 'Basic ' . (str_contains($t, ':') ? base64_encode($t) : $t);
    }

    /**
     * 0.5.1: base nova. Nasce INATIVA e começando do último evento que já existe no IXC (pergunta ao IXC com o token digitado):
     * assim o bot não lê o histórico inteiro quando ela for ativada. Se o IXC não responder, nada é criado.
     * @param array<string,mixed> $d id, nome, base_url, token, dono_id, ignorar_assuntos, assuntos_financeiros, semtec_sem_local
     * @param callable(string,string):int $ultimoEvento (url, Authorization) → último id de su_oss_chamado_mensagem
     * @return array<string,mixed>
     */
    public function criarBase(array $d, callable $ultimoEvento): array
    {
        $id = strtoupper(trim((string) ($d['id'] ?? '')));
        if (!preg_match('/^[A-Z0-9_]{2,20}$/', $id)) {
            throw new ErroDeUso('Sigla da base: 2 a 20 letras maiúsculas, números ou _ (ex.: 4B, PONTO). É a usada nos shoppings e técnicos.');
        }
        $st = $this->pdo()->prepare('SELECT 1 FROM ixc.empresas WHERE id = ?');
        $st->execute([$id]);
        if ($st->fetchColumn()) {
            throw new ErroDeUso('Já existe a base ' . $id . '.');
        }
        $nome = trim((string) ($d['nome'] ?? ''));
        if ($nome === '' || mb_strlen($nome) > 80) {
            throw new ErroDeUso('Nome da base: de 1 a 80 caracteres.');
        }
        $url = self::urlIxc((string) ($d['base_url'] ?? ''));
        $auth = self::auth((string) ($d['token'] ?? ''));
        $dono = trim((string) ($d['dono_id'] ?? ''));
        if ($dono !== '' && !preg_match('/^\d{1,9}$/', $dono)) {
            throw new ErroDeUso('Dono do número: o id do colaborador no IXC (só números) ou vazio.');
        }
        $ign = self::idsAssunto($d['ignorar_assuntos'] ?? '');
        $fin = self::idsAssunto($d['assuntos_financeiros'] ?? '');
        $semLocal = !empty($d['semtec_sem_local']);
        $ultimo = $ultimoEvento($url, $auth);   // ErroDeUso se o IXC não responder: nada é criado
        $this->emTransacao(function (PDO $pdo) use ($id, $nome, $url, $auth, $ultimo, $dono, $ign, $fin, $semLocal) {
            $pdo->prepare('INSERT INTO ixc.empresas (id, nome, base_url, auth, last_evento_id, dono_id, ignorar_assuntos, semtec_sem_local, ativo, assuntos_financeiros)
                           VALUES (?, ?, ?, ?, ?, ?, ?::text[], ?, false, ?::text[])')
                ->execute([$id, $nome, $url, $auth, $ultimo, $dono === '' ? null : $dono, self::pgArr($ign), $semLocal ? 't' : 'f', self::pgArr($fin)]);
            $this->registrar('base_criar', $id, null, json_encode(['nome' => $nome, 'base_url' => $url, 'ultimo_evento' => $ultimo, 'ativo' => false],
                JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        });
        return ['id' => $id, 'nome' => $nome, 'ultimo_evento' => $ultimo, 'ativo' => false];
    }

    /** Troca o token do IXC da base (o painel grava a coluna auth, mas não lê). Na auditoria fica só "(token trocado)". */
    public function trocarToken(string $id, string $token): void
    {
        $this->base($id);
        $auth = self::auth($token);
        $this->emTransacao(function (PDO $pdo) use ($id, $auth) {
            $pdo->prepare('UPDATE ixc.empresas SET auth = ? WHERE id = ?')->execute([$auth, $id]);
            $this->registrar('base_token', $id, null, '(token trocado)');
        });
    }
}
