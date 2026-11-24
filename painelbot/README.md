# Painel do Bot (`painelbot`) — plugin GLPI 11

Gerencia o bot de WhatsApp da automação [`whatsapp-ixc`](../whatsapp-ixc/README.md) (n8n + WAHA) de dentro do GLPI.
Autor SCDell, GPLv3+. Requisitos: GLPI 11.0.x, PHP 8.2+ com `pdo_pgsql` (`apt install php-pgsql`).

Os dados **não** ficam no MariaDB do GLPI: o plugin lê e grava o Postgres do bot (schema `ixc`) com o usuário `painel_glpi`,
que não tem acesso aos tokens do IXC e só grava nas tabelas do painel (mensagens, histórico, perguntas, apelidos e cadastros).

## O que tem

**0.4.2** — Variáveis: tipo **por shopping** (um valor para cada shopping + valor padrão; ex. `{holding}`: "qual a holding do jockey?" responde o do Jockey) e lista das **36 variáveis do bot** (o que traz, exemplo, em quais mensagens aparece), com descrição/exemplo editáveis, **desativar** (fica vazia em todas as mensagens do bot) e restaurar padrão (linhas `vsys.<nome>` em `ixc.mensagens`). Sem mudança no banco. Vale no WhatsApp com o whatsapp-ixc 0.6.3. Testes: Editor 90, tela 73.

**0.4.1** — aba **Variáveis**: criar, editar (valor e descrição), ativar/desativar, excluir (só se nenhuma mensagem nova usa) e histórico de variáveis de **valor fixo** para o texto das mensagens novas (`{nome}`; guardadas em `ixc.mensagens` com chave `var.<nome>`, sem mudança no banco). Frase da mensagem nova aceita **`{shopping}`** (casa com qualquer shopping, nome ou apelido; sem shopping reconhecido, o bot responde para todos) e o texto usa `{shopping}` = nome do shopping. Botões das variáveis no editor, pré-visualização com os valores e teste da frase mostrando o shopping. Vale no WhatsApp com o whatsapp-ixc 0.6.2 (entregue antes como 0.5.1). Testes: Editor 69, tela 60.

**0.4.0** — **Mensagens**: **Nova mensagem** = resposta automática no grupo quando alguém escreve uma das frases escolhidas (nome, até 10 frases, todos os grupos ou só o Recados, texto com formatação do WhatsApp; telefone vira @; prioridade sobre escala e setores; chave `resp.N` em `ixc.mensagens`); editar, **excluir** (direito novo Mensagens > Excluir, dado na atualização a quem tem Configuração > Atualizar) e **ativar/desativar qualquer mensagem** (desativada = o trecho fica vazio; mensagem inteira vazia não é enviada; tipo de aviso de chamado desativado = registrado como ignorado). Filtro "Desativadas", teste da frase e pré-visualização. `sql/01` ganha as colunas `ativo, criada_painel, frases, frases_norm, grupos, criado_por, criado_em` (e as permissões do `painel_glpi`, sem precisar rodar o `02`). Vale no WhatsApp com o whatsapp-ixc 0.5.0. Testes em `tests/` (Editor 43, tela 42, migração).

**0.3.1** — Técnicos: campo **Nome na planilha ESCALAS** (`ixc.tecnicos.nome_planilha`, coluna nova no `sql/01`): liga o nome da planilha dos 12x36 ao cadastro, para o nome editado no painel aparecer também nos 12x36 (com o whatsapp-ixc 0.4.1). Vazio = usa o nome. Coluna "Na planilha" na lista.

**0.3.0** — **cadastros editáveis**: Shoppings e escala (novo/editar/excluir: base, id do condomínio, nome, grupo do WhatsApp, técnico padrão, tipo, horários, equipe, quem marcar sem técnico e ao escalar, **apelidos**), Técnicos (novo/editar/excluir; trocar o número atualiza as marcações) e Contatos de setor (novo/editar/excluir). Pergunta padrão agora também se exclui (some da lista e o bot para de responder; volta em "Restaurar padrões"). Tabela nova `ixc.apelidos` (os apelidos valem no WhatsApp com o whatsapp-ixc 0.4.0).

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
2. `02-usuario-painel.sql` — cria/atualiza o usuário `painel_glpi` (leitura sem `empresas.auth`; grava em mensagens, perguntas, apelidos e, desde a 0.3.0, em `locais`, `escala_base`, `tecnicos` e `contatos_setor`; nunca em parâmetros, eventos, empresas). Rodar com `-v senha="'...'"` (rodar de novo a cada versão que mude permissões).

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
