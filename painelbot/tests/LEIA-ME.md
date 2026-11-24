# Testes do painelbot (fora do GLPI)

Postgres de teste (socket/porta em `PGH`/`PGP`, padrão `/tmp/pg` e `5499`), usuário dono `ixc`. O banco `ixc` é recriado a cada rodada com `base-bot-minima.sql` + `sql/01` + `sql/02` (senha `teste`), e os testes conectam como **`painel_glpi`**: falta de permissão aparece como erro.

| Arquivo | O que testa |
|---|---|
| `teste-mensagens.php` | `Editor` + `Bot` da 0.4.0 (Mensagens): desativar, mensagens novas, validações, o que o bot lê |
| `teste-migracao.php` | `Install::migrar` (Excluir em Mensagens para quem tem Configuração > Atualizar; uma vez só) |
| `tela-mensagens.js` | `public/js/painel.js` no jsdom, gravando pelo `front/acao.php` real (GLPI simulado em `glpi-simulado.php`, servido por `servidor-teste.php`) |

```
tests/reset-banco.sh && php tests/teste-mensagens.php
php -S 127.0.0.1:8765 tests/servidor-teste.php &   # outro terminal
node tests/tela-mensagens.js                        # precisa do jsdom (npm i jsdom@24 numa pasta fora do plugin, NODE_PATH)
```
