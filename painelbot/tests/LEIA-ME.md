# Testes do painelbot (fora do GLPI)

Postgres de teste (socket/porta em `PGH`/`PGP`, padrão `/tmp/pg` e `5499`), usuário dono `ixc`. O banco `ixc` é recriado a cada rodada com `base-bot-minima.sql` + `sql/01` + `sql/02` (senha `teste`), e os testes conectam como **`painel_glpi`**: falta de permissão aparece como erro.

| Arquivo | O que testa |
|---|---|
| `teste-mensagens.php` | `Editor` + `Bot` (Mensagens 0.4.0, Variáveis e {shopping} 0.4.1): desativar, mensagens novas, variáveis, validações, o que o bot lê |
| `teste-migracao.php` | `Install::migrar` (Excluir em Mensagens para quem tem Configuração > Atualizar; uma vez só) |
| `teste-operacao.php` | 0.5.0: `Parametros` (validação por tipo), `Operacao` (parâmetros, bases, token, auditoria, o que o painel_glpi NÃO pode) e `Servicos` (n8n/WAHA com HTTP falso). Usa `semente-operacao.sql` |
| `teste-config.php` | 0.5.0: campos novos da Configuração (endereço e chave do n8n e do WAHA, ids pausáveis) |
| `tela-operacao.js` | 0.5.0: aba Operação e Parâmetros no jsdom, gravando pelo `acao.php` real; n8n, WAHA e IXC falsos em `n8n-falso.php` (porta 8766); 0.5.1: Rodar agora e Nova base |
| `teste-alertas-banco.sh` | 0.5.2: `ixc.alertas`/`ixc.alertas_sombra` do `sql/01` — linhas padrão, permissões do `painel_glpi`, restrições, rodar o 01/02 de novo sem desfazer edição |
| `tela-mensagens.js` | `public/js/painel.js` no jsdom, gravando pelo `front/acao.php` real (GLPI simulado em `glpi-simulado.php`, servido por `servidor-teste.php`) |

```
tests/reset-banco.sh && php tests/teste-mensagens.php
php -S 127.0.0.1:8765 tests/servidor-teste.php &   # outro terminal
node tests/tela-mensagens.js                        # precisa do jsdom (npm i jsdom@24 numa pasta fora do plugin, NODE_PATH)
tests/reset-banco.sh && php tests/teste-operacao.php
php -S 127.0.0.1:8766 tests/n8n-falso.php &          # n8n/WAHA falsos (estado em n8n-estado.json)
node tests/tela-operacao.js
tests/teste-alertas-banco.sh                        # recria o banco sozinho
```
