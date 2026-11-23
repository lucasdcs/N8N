<?php

/**
 * 0.2.0 — gravações do Painel do Bot (POST JSON {acao, ...}). O core valida o CSRF (header X-Glpi-Csrf-Token).
 *
 *   mensagem_salvar      {chave, texto}        Mensagens > Editar
 *   mensagem_restaurar   {chave}               Mensagens > Editar
 *   mensagem_historico   {chave}               Mensagens > Visualizar
 *   pergunta_criar       {alvo, frase, grupos} Perguntas > Editar
 *   pergunta_editar      {id, frase, grupos}   Perguntas > Editar   (só as criadas no painel)
 *   pergunta_ligar       {id, ativo}           Perguntas > Editar
 *   pergunta_excluir     {id}                  Perguntas > Excluir  (só as criadas no painel)
 *   perguntas_restaurar  {alvo}                Perguntas > Editar   (religa as padrão desligadas)
 */

use GlpiPlugin\Painelbot\Bot;
use GlpiPlugin\Painelbot\Direito;
use GlpiPlugin\Painelbot\Editor;
use GlpiPlugin\Painelbot\ErroDeUso;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$saida = static function (array $r, int $http = 200): never {
    http_response_code($http);
    echo json_encode($r, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
};

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    $saida(['ok' => false, 'erro' => 'use POST'], 405);
}
$corpo = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($corpo)) {
    $saida(['ok' => false, 'erro' => 'Corpo inválido.'], 400);
}
$acao = (string) ($corpo['acao'] ?? '');

/** Direito exigido por ação: [área, bit]. */
$exige = [
    'mensagem_salvar'     => [Direito::MENSAGENS, UPDATE],
    'mensagem_restaurar'  => [Direito::MENSAGENS, UPDATE],
    'mensagem_historico'  => [Direito::MENSAGENS, READ],
    'pergunta_criar'      => [Direito::PERGUNTAS, UPDATE],
    'pergunta_editar'     => [Direito::PERGUNTAS, UPDATE],
    'pergunta_ligar'      => [Direito::PERGUNTAS, UPDATE],
    'pergunta_excluir'    => [Direito::PERGUNTAS, DELETE],
    'perguntas_restaurar' => [Direito::PERGUNTAS, UPDATE],
];
if (!isset($exige[$acao])) {
    $saida(['ok' => false, 'erro' => 'Ação desconhecida.'], 400);
}
[$area, $bit] = $exige[$acao];
if (!Direito::pode($area, $bit)) {
    $nomes = [READ => 'Visualizar', UPDATE => 'Editar', DELETE => 'Excluir'];
    $saida(['ok' => false, 'erro' => 'Seu perfil não tem "' . Direito::AREAS[$area][0] . ' > ' . $nomes[$bit] . '" (Administração > Perfis > Painel do Bot).'], 403);
}

$quem = trim((string) ($_SESSION['glpifriendlyname'] ?? $_SESSION['glpiname'] ?? ''));
$quem = $quem !== '' ? $quem : ('usuário #' . Session::getLoginUserID());
session_write_close();

try {
    $ed = new Editor(new Bot(), mb_substr($quem, 0, 100));
    $id = (int) ($corpo['id'] ?? 0);
    $r = match ($acao) {
        'mensagem_salvar'     => ['mensagem' => $ed->salvarMensagem((string) ($corpo['chave'] ?? ''), (string) ($corpo['texto'] ?? ''))],
        'mensagem_restaurar'  => ['mensagem' => $ed->restaurarMensagem((string) ($corpo['chave'] ?? ''))],
        'mensagem_historico'  => ['historico' => $ed->historico((string) ($corpo['chave'] ?? ''))],
        'pergunta_criar'      => ['pergunta' => $ed->criarPergunta((string) ($corpo['alvo'] ?? ''), (string) ($corpo['frase'] ?? ''), (string) ($corpo['grupos'] ?? 'todos'))],
        'pergunta_editar'     => ['pergunta' => $ed->editarPergunta($id, (string) ($corpo['frase'] ?? ''), (string) ($corpo['grupos'] ?? ''))],
        'pergunta_ligar'      => ['pergunta' => $ed->ligarPergunta($id, !empty($corpo['ativo']))],
        'pergunta_excluir'    => (function () use ($ed, $id) { $ed->excluirPergunta($id); return ['excluida' => $id]; })(),
        'perguntas_restaurar' => ['religadas' => $ed->restaurarPadroes((string) ($corpo['alvo'] ?? ''))],
    };
    $saida(['ok' => true] + $r);
} catch (ErroDeUso $e) {
    $saida(['ok' => false, 'erro' => $e->getMessage()], 422);
} catch (\PDOException $e) {
    if ($e->getCode() === '42501') {   // insufficient_privilege: usuário do banco ainda com as permissões da 0.1.0
        $saida(['ok' => false, 'erro' => 'O usuário do banco do bot ainda não pode gravar. Rode de novo o painelbot/sql/02-usuario-painel.sql (versão 0.2.0).'], 502);
    }
    Toolbox::logInFile('php-errors', 'painelbot acao ' . $acao . ': ' . Bot::limparErro($e->getMessage()) . "\n");
    $saida(['ok' => false, 'erro' => 'Erro ao gravar no banco do bot — ver files/_log/php-errors.log (painelbot).'], 500);
} catch (\RuntimeException $e) {
    $saida(['ok' => false, 'erro' => $e->getMessage()], 502);   // conexão/config
} catch (\Throwable $e) {
    Toolbox::logInFile('php-errors', 'painelbot acao ' . $acao . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() . "\n");
    $saida(['ok' => false, 'erro' => 'Erro interno — ver files/_log/php-errors.log (painelbot).'], 500);
}
