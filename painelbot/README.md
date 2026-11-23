# Painel do Bot (`painelbot`) — plugin GLPI 11

Gerencia o bot de WhatsApp da automação [`whatsapp-ixc`](../whatsapp-ixc/README.md) (n8n + WAHA) de dentro do GLPI.
Autor SCDell, GPLv3+. Requisitos: GLPI 11.0.x, PHP 8.2+ com `pdo_pgsql` (`apt install php-pgsql`).

Os dados **não** ficam no MariaDB do GLPI: o plugin lê e grava o Postgres do bot (schema `ixc`) com o usuário `painel_glpi`,
que não tem acesso aos tokens do IXC e só grava nas tabelas do painel (mensagens, histórico e perguntas).

## O que tem

**0.2.1** — catálogo de textos padrão igual ao do whatsapp-ixc 0.3.0 (ajuda dos comandos, lembretes, técnico não encontrado, linha "sem técnico").

**0.2.0** — edição em **Mensagens** (salvar com conferência das `{variáveis}`, restaurar o padrão, histórico) e nas **perguntas** de cada setor
(nova, editar, ligar/desligar, excluir as criadas no painel, religar padrões). Os textos e perguntas passam a valer no WhatsApp com o whatsapp-ixc 0.3.0.

**0.1.0** — consulta:

| Seção | Conteúdo | Área do perfil |
|---|---|---|
| Visão geral | as 4 funcionalidades (avisos de chamado, lembretes de visita, bot de escalas, sync da planilha) com modo e números de 24 h; IXCs lidos | Visão geral e últimos envios |
| Shoppings e escala | quem o bot responde hoje/amanhã, horários, tipo (fixo/12x36) | Shoppings e escala |
| Técnicos · Contatos de setor | técnicos de campo e contatos de N2/financeiro/comercial/compras/RH | Técnicos e contatos de setor |
| Mensagens | catálogo dos ~55 textos do bot, com pré-visualização WhatsApp; no título de cada setor, as perguntas que acionam a resposta e um campo para testar uma frase | Mensagens (+ Perguntas) |
| Parâmetros | `ixc.parametros` e próximos feriados | Parâmetros e conexão |
| Últimos envios | `ixc.eventos` | Visão geral e últimos envios |

Tema claro/escuro (botão só com ícone, gravado por usuário). Conexão em **Configurar > Geral > Painel do Bot**.

## Permissões (Administração > Perfis > aba Painel do Bot)

Matriz Área × **Visualizar / Editar / Excluir**: Visão geral e últimos envios (V) · Mensagens (V, E) · Perguntas (V, E, X) ·
Shoppings e escala (V, E, X) · Técnicos e contatos (V, E, X) · Avisos automáticos (V, E, X) · Parâmetros e conexão (V, E).
Na instalação só os perfis com Configuração > Atualizar (Super-Admin) recebem tudo; os demais nascem sem acesso.

## Banco do bot (`sql/`)

1. `01-mensagens-perguntas.sql` — cria `ixc.mensagens`, `ixc.mensagens_hist` e `ixc.perguntas` com os textos e perguntas atuais (idempotente; não sobrescreve texto editado).
2. `02-usuario-painel.sql` — cria/atualiza o usuário `painel_glpi` (leitura sem `empresas.auth`; desde a 0.2.0 grava só em `mensagens.texto`, `mensagens_hist` e `perguntas`). Rodar com `-v senha="'...'"` (rodar de novo a cada versão que mude permissões).

`catalogo-mensagens.json` é a fonte do 01; regere com `python3 sql/gerar-sql.py sql/catalogo-mensagens.json sql/01-mensagens-perguntas.sql`.

## Instalar / atualizar

```bash
cd /var/www/html/glpi/plugins
unzip -o /home/resolutto/painelbot-X.Y.Z.zip
chown -R www-data:www-data painelbot
runuser -u www-data -- php /var/www/html/glpi/bin/console plugin:install --force --username=<admin> painelbot
runuser -u www-data -- php /var/www/html/glpi/bin/console plugin:activate painelbot
runuser -u www-data -- php /var/www/html/glpi/bin/console cache:clear
systemctl restart apache2
```
