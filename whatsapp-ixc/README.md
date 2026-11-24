# whatsapp-ixc — Notificações de chamados IXC no WhatsApp (WAHA)

Versão **0.6.1** (24/11/2026) — avisos de chamado (WF 01) **só no particular do técnico atribuído**; nada mais vai para grupo. Só eventos de hoje, no máximo 10 avisos por rodada, 8 s entre mensagens. Textos, perguntas, apelidos e mensagens editáveis pelo **Painel do Bot** (plugin GLPI [`painelbot`](../painelbot/README.md)). Adaptação para o **WAHA** da automação "IXC → WhatsApp" recebida de terceiro (feita para a Evolution API, documentação de 04/10/2026). Sem IA (o assistente "Hermes", workflows 05/06, ficou de fora).

| Pasta | Conteúdo |
|---|---|
| `n8n/` | 4 workflows adaptados, importáveis: 01 notificações, 02 lembretes de visita, 03 comandos `ixc` + "quem está" + setores, 04 sync da planilha ESCALAS |
| `banco/` | `01_estrutura_schema_ixc.sql` (schema `ixc`: tabelas, funções) e `02_configuracao_atual.sql` (configuração: IXCs, shoppings, grupos, técnicos, parâmetros, horários) |
| `fontes/` | O código de cada nó (`.js` = nó Code, `.sql` = nó Postgres), extraído dos JSON, para ler e comparar |
| `scripts/` | `adaptar_waha.py` (gera `n8n/`, `banco/`, `fontes/` a partir do pacote original), `sanitizar_publico.py` (gera a cópia pública), `check/` (validação e testes) |

> No GitHub (repositório público) telefones, JIDs de grupo e nomes de pessoas estão trocados por marcadores (`55__TELEFONE__`, `__GRUPO_TECNICOS__@g.us`, `Tecnico 4B-45`, `__NOME__`). O pacote de produção (`whatsapp-ixc-0.1.0.zip`) tem os valores reais; só os tokens do IXC ficam para preencher.

## 1. O que faz

| Workflow | Gatilho | O que faz |
|---|---|---|
| **01** Notificações de chamados | a cada 3 min | Lê os eventos novos de O.S. (aberto, transferido, assumido) dos IXCs e avisa **no particular do técnico atribuído** (0.6.0, `tecnicos.fone`), sem @ e sem grupo — só aberto e transferido. Pedido de infra escrito na O.S. → particular do responsável pela infra (`infra_fone`). **Não notifica:** chamado assumido, chamado sem técnico, chamado do dono do número, pessoa fora de `ixc.tecnicos` ou técnico sem telefone — fica em `ixc.eventos` como `ignorado`, com o motivo. Reenvio automático do que falhou (até 5×, no máximo 5 por rodada; falha antiga para grupo não é reenviada). **Trava (0.6.1):** evento de O.S. que não é de hoje ou tem mais de 60 min é descartado (o histórico parado não vira aviso); no máximo 10 avisos por rodada; 1 mensagem a cada 8 s. Com `aviso_privado = nao` volta ao modo grupo: aviso no grupo do shopping com @, sem responsável aos 10 min + reavisos + "escalado" com 4 h, infra no grupo do responsável, plantão marcado quando o atribuído está de folga. |
| **02** Lembretes de visita | a cada 5 min | 1 hora antes de cada visita agendada: aviso completo **com a planta da loja** (0.2.0); 10 minutos antes: só um texto curto ("Não esqueça: visita na *Loja* (Shopping, loja) daqui 10 minutos, às 14:00."). **No particular do técnico** (0.2.1); sem técnico atribuído ou sem telefone cadastrado → grupo do shopping, marcando quem está em `marcar_sem_tec`. |
| **03** Comandos e consulta de escala | webhook `/webhook/ixc-whatsapp` | No grupo de automação: comandos `ixc …` (lista, técnicos, quem, trocar técnico/número, incluir/remover, novo técnico) com confirmação `ixc ok`. Nos grupos liberados: "quem está no jockey?", "alguém do financeiro?", "algum N2?". |
| **04** Sync planilha ESCALAS | a cada hora (min 20) | Lê a aba HOJE da planilha e grava quem trabalha hoje/amanhã nos shoppings 12x36 e Porto Belo/Tijucas (`ixc.escala_dia`). 3 falhas seguidas → aviso no grupo de automação. |

Toda a configuração (IXCs, grupos, técnicos, horários, parâmetros) fica no **PostgreSQL, schema `ixc`**, e é lida a cada execução. Nada de LLM: regras fixas.

**Filtros importantes:** os assuntos de **projeto T.I** (ativação, documentação, auditoria, levantamento, comparativo, agente) estão em `empresas.ignorar_assuntos` em todas as bases. Por isso estes workflows **não** se sobrepõem às Frentes 1/2 (encaminhamento por condomínio e Documentação) nem à Auditoria: eles cuidam das O.S. de suporte aos lojistas (assistência técnica etc.).

## 2. O que mudou da Evolution API para o WAHA

| Ponto | Evolution (original) | WAHA (esta versão) |
|---|---|---|
| Enviar texto | `POST /message/sendText/<inst>` `{number, text, mentioned}` | `POST /api/sendText` `{session, chatId, text, mentions:[55…@c.us], linkPreview:false}` |
| Enviar imagem (planta da loja) | `sendMedia` | `POST /api/sendImage` `{session, chatId, file:{mimetype, filename, data}, caption}` |
| Validar número (`ixc numero`) | `POST /chat/whatsappNumbers` → `exists/jid` | `GET /api/contacts/check-exists?phone=&session=` → `numberExists/chatId` |
| Citar a pergunta (bot de escalas) | `quoted` | `reply_to: <id da mensagem>` |
| Receber mensagens (WF 03) | webhook `MESSAGES_UPSERT`, `data.key.remoteJid` | evento `message.any`; o nó **"WAHA: Normalizar"** converte o payload (`from/body/fromMe/participant`) para o formato interno, e o resto do workflow não mudou |
| Chave da API | header `apikey` fixo nos nós ou no banco | credencial do n8n **"WAHA API"** (`X-Api-Key`), a mesma do lembrete diário |
| Endereço / sessão / grupo de automação | fixos nos nós 03/04 | parâmetros `waha_url`, `waha_session`, `grupo_automacao` no banco (nó "Carregar Parametros") |
| Resposta de envio | `key.id` | `id` (string ou objeto) sem `error` |
| Supervisor / coordenador | nomes fixos no código | parâmetros `supervisor_nome` / `coordenador_nome` |
| Modo de envio (01/02) | não tinha | `envio` = `NENHUM` / `SIMULAR` / `REAL` + `envio_teste_para` |

Removidos: `evolution_url`, `evolution_apikey`, `hermes_token`; a troca fixa de nome no WF 04 (regra morta: a planilha foi corrigida em 03/10). O serviço `planta-loja` está em `planta-loja/` desde a 0.2.0 (seção "Planta da loja").

## 3. Parâmetros novos (`ixc.parametros`)

| Chave | Valor | Para quê |
|---|---|---|
| `waha_url` | `http://waha:3000` | WAHA visto pelo n8n (mesma rede Docker) |
| `waha_session` | `session_01m4xy9khpbqgnafzqhd9wchx1` | sessão pareada com o número remetente (a mesma do lembrete diário) |
| `grupo_automacao` | JID do grupo | onde os comandos `ixc` funcionam e os avisos de sistema saem (o 2121 precisa ser membro) |
| `envio` | `NENHUM` → `SIMULAR` → `REAL` | WF 01/02: `NENHUM` só avança o estado (consome o histórico sem mandar nada); `SIMULAR` manda tudo para `envio_teste_para` com "🧪 SIMULAÇÃO → <grupo>" no topo; `REAL` manda para os destinos (particular do técnico no WF 01 desde a 0.6.0) |
| `envio_teste_para` | número do remetente | quem recebe no modo SIMULAR |
| `supervisor_nome` / `coordenador_nome` | nomes | exibidos junto de `supervisor_fone` / `coordenador_fone` |
| `aviso_privado` | `sim` (padrão, mesmo sem a linha) | WF 01 (0.6.0): avisos de chamado (aberto, transferido) só no particular do técnico atribuído; assumido, sem técnico e sem telefone não saem. `nao` = grupos como antes |
| `infra_fone` | 55 + DDD + número | WF 01 (0.6.0, com `aviso_privado = sim`): particular de quem recebe o "pedido de infra". Vazio = o pedido não sai |
| `aviso_max_idade_min` | `60` (padrão) | WF 01 (0.6.1): evento de O.S. mais velho que isso, ou de outro dia, não avisa. `0` = só a regra do dia |
| `aviso_max_rodada` | `10` (padrão) | WF 01 (0.6.1): avisos por rodada de 3 min; o excedente fica em `ixc.eventos` como ignorado |
| `reenvio_max_rodada` | `5` (padrão) | WF 01 (0.6.1): reenvios de falha por rodada |
| `lembrete_privado` | `sim` (padrão, mesmo sem a linha) | WF 02 (0.2.1): lembretes de visita no particular do técnico atribuído (`tecnicos.fone`); `nao` = volta tudo para o grupo |
| `planta_ativo` | `nao` → `sim` | `sim` só com o serviço `planta-loja` no ar (WF 01: Ativação/Vistoria; WF 02: lembrete de 1 h). Ver a seção Planta da loja |
| `escala_trocar_nomes` | `Quem Saiu=Quem Cobre;Outro=Substituto@2026-10-30` | WF 04 (0.1.1/0.1.2): trocas aplicadas ao CSV da planilha ESCALAS antes de ler (quem saiu, férias, atestado). `@AAAA-MM-DD` = vale até essa data, inclusive; sem data = até você tirar. Vazio = nenhuma |
| `escala_ler_porto_belo` | `sim` / `nao` | WF 04 (0.2.6): `sim` = Porto Belo/Tijucas vêm da planilha (escala do dia); `nao` = técnico fixo de cada um pela `escala_base`/`locais.tec_padrao` |

Os demais (`semtec_min`, `realerta_horarios`, `escalar_min`, `escala_grupos`, `setores_grupo`, `grupo_dono`, `dono_nome`, …) são os do pacote original; estão comentados no `02_configuracao_atual.sql`.

## 4. Instalar na produção (n8n `/root/n8n-compose`, WAHA `/root/waha-compose`)

Pré-requisitos: WAHA `WORKING` com o 2121; o 2121 **membro de todos os grupos** cadastrados (`locais.grupo`, `grupo_automacao`, `escala_grupos`, `setores_grupo`); PostgreSQL alcançável pelo n8n; fuso `America/Sao_Paulo` no n8n.

1. **Postgres.** Se o `n8n-compose` ainda não tem um Postgres, suba um na mesma rede (volume em `/opt/docker`) e inclua no backup. Crie o banco e o usuário da automação.
2. **Tokens do IXC.** No `banco/02_configuracao_atual.sql`, troque `COLE_AQUI_O_BASE64_DE_IDUSUARIO:TOKEN` em cada linha de `ixc.empresas`: `echo -n "<id do usuário de API>:<token>" | base64 -w0`. Confira `grupo_automacao` e os JIDs dos grupos (`GET /api/<sessão>/groups` no WAHA). Não mande este arquivo por chat: ele tem os tokens.
3. **Carregar:** `psql -h <host> -U <usuário> -d <banco> -f banco/01_estrutura_schema_ixc.sql` e depois `-f banco/02_configuracao_atual.sql`.
4. **Último evento lido** (senão reenvia o histórico): para cada IXC, pegue o maior `id` de `su_oss_chamado_mensagem` (listar ordenando por `id desc`, 1 registro) e `UPDATE ixc.empresas SET last_evento_id = <id> WHERE id = '<EMPRESA>';`. Com `envio = NENHUM` a 1ª rodada do WF 01 também avança o estado sem mandar nada — a atualização manual é a garantia.
5. **n8n:** credencial Postgres com o nome exato **"Postgres IXC State"**; conferir a credencial **"WAHA API"**; importar os 4 JSON de `n8n/`. No WF 04, trocar `__PLANILHA_ID__` / `__GID_HOJE__` no nó "Baixar aba HOJE" (os mesmos da planilha ESCALAS do lembrete). **Publicar** cada um (a importação só atualiza o rascunho).
6. **Webhook do WAHA → n8n** (para o WF 03). No `/root/waha-compose/docker-compose.yml`, no serviço `waha`:
   ```
   WHATSAPP_HOOK_URL=http://<nome do container do n8n>:5678/webhook/ixc-whatsapp
   WHATSAPP_HOOK_EVENTS=message.any
   ```
   e `docker compose up -d` (a sessão pareada fica no volume `waha_sessions`). Confira o nome do container do n8n com `docker ps` e, de dentro do WAHA, `wget -qO- http://<container>:5678/healthz`. Só `message.any` (inclui as mensagens do próprio 2121, necessárias para o `ixc ok` digitado no celular); **não** some `message` + `message.any`, senão entrega em dobro. Se preferir por sessão em vez de variável: `PUT /api/sessions/<sessão>` com `config.webhooks`.
7. **Ativar na ordem:** 04 (sync da escala) → 03 (comandos; teste com `ixc ajuda` no grupo de automação e "quem está no jockey?" num grupo de `escala_grupos`) → 01 e 02 com `envio = NENHUM` por uma rodada → `SIMULAR` por alguns dias (as mensagens chegam no 2121 com o grupo de destino no topo) → `REAL`.
8. Depois de ativar ou salvar qualquer workflow, confira em **Execuções** se os agendados continuam rodando (algumas versões do n8n perdem o agendamento ao salvar; desativar + ativar resolve).

**Conferência:** `SELECT tipo, status, motivo, count(*) FROM ixc.eventos WHERE ts > now() - interval '1 day' GROUP BY 1,2,3;`

## 5. Manutenção do dia a dia

| Quero… | Como |
|---|---|
| Trocar técnico de um shopping / número / quem é marcado | comandos `ixc …` no grupo de automação + `ixc ok` (`ixc ajuda` lista) |
| Incluir um IXC novo (ex.: Resolutto) | usuário de API com Listar em `su_oss_chamado_mensagem`, `su_oss_chamado`, `cliente`, `su_oss_assunto`; `INSERT` em `empresas` (`last_evento_id` = maior id atual), `locais`, `tecnicos`, `funcionarios`; horários em `escala_base` |
| Incluir um shopping | `INSERT` em `locais` (id_condominio, JID do grupo, técnico padrão, quem marcar) + `escala_base` |
| Mudar horários do reaviso | `UPDATE ixc.parametros SET valor = '10:00,16:00' WHERE chave = 'realerta_horarios';` |
| Filtrar mais um assunto | `UPDATE ixc.empresas SET ignorar_assuntos = ignorar_assuntos \|\| '{<id>}' WHERE id = '<EMPRESA>';` (ou `assuntos_financeiros`) |
| Liberar "quem está" em outro grupo | acrescentar o JID em `escala_grupos` |
| Trocar contato/horário de um setor | `UPDATE ixc.contatos_setor …` (vale na próxima pergunta) |
| Ver por que algo não chegou | `ixc.eventos` (status/motivo) — na 0.6.0 o técnico sem telefone aparece como "técnico sem telefone cadastrado (<nome>)": cadastre o `tecnicos.fone` (55 + DDD + número) |
| Voltar os avisos para os grupos | `INSERT INTO ixc.parametros (chave, valor) VALUES ('aviso_privado', 'nao') ON CONFLICT (chave) DO UPDATE SET valor = 'nao';` |
| Desligar um IXC sem apagar | `UPDATE ixc.empresas SET ativo = false WHERE id = '<EMPRESA>';` |
| Desligar tudo | `UPDATE ixc.parametros SET valor = 'NENHUM' WHERE chave = 'envio';` (01/02) e desativar o 03 |

## 6. Armadilhas conhecidas

- **Reimportar um workflow** de `n8n/` não religa as credenciais e traz a URL da planilha como marcador: confira os nós Postgres (`Postgres IXC State`), os HTTP do WAHA (`WAHA API`), recoloque a URL no "Baixar aba HOJE" do 04 e clique em **Publish** (*Execute workflow* roda o rascunho; o agendamento roda só a versão publicada).
- **Sessão do WAHA**: o nome está em `ixc.parametros.waha_session` e no nó Config do lembrete diário e do aviso de O.S. nova. Para reconectar o celular use Logout/Start na sessão existente; criar uma sessão nova muda o nome e para os envios.

- Resposta do IXC vem como texto em `json.data` → sempre `JSON.parse` (função `unwrap`).
- `@` de quem **não é membro** do grupo não notifica: conferir os participantes antes de cadastrar.
- `last_evento_id` zerado ou antigo reenvia histórico: acertar antes de ativar. **Workflow despublicado também deixa o `last_evento_id` parado** (incidente de 24/11). Desde a 0.6.1, o WF 01 descarta eventos que não são de hoje ou têm mais de 60 min. Mesmo assim, ao republicar depois de muito tempo parado, rode antes uma rodada com `envio = NENHUM`.
- Editar workflow a partir de cópia antiga desfaz mudanças: baixar o atual antes de editar/publicar.
- O bot não responde a si mesmo: as respostas começam com emoji e os filtros ignoram mensagens que começam com emoji.
- Dump do banco contém tokens: pasta restrita, nunca por chat/e-mail.
- Modo SIMULAR também marca os lembretes do WF 02 como enviados (`motivo = SIMULADO`): eles não saem de novo quando virar REAL.

## 7. Versões

| Versão | Data | O quê |
|---|---|---|
| 0.1.0 | 27/10/2026 | Adaptação Evolution → WAHA (2121), sem Hermes, modos NENHUM/SIMULAR/REAL, parâmetros no banco, nomes fora do código |
| 0.1.1 | 28/10/2026 | WF 04: nó "Carregar Trocas" + parâmetro `escala_trocar_nomes` (quem saiu → quem cobre); `banco/atualizacao-escalas-2026-10-28.sql` (Porto Belo/Tijucas, Ventura, Itajaí/Riviera) |
| 0.1.2 | 28/10/2026 | `escala_trocar_nomes` com validade (`De=Para@AAAA-MM-DD`): a troca expira sozinha |
| 0.2.0 | 28/10/2026 | Planta da loja: serviço `planta-loja` (23 shoppings, Docker na rede do n8n); WF 02 com a planta no lembrete de 1 h e lembrete curto de 10 min (antes 15 min, texto completo) |
| 0.2.1 | 29/10/2026 | WF 02: lembretes (1 h com planta e 10 min) no **particular do técnico**, sem @ e sem cópia no grupo; sem técnico/sem telefone/dono do número → grupo como antes; parâmetro `lembrete_privado` |
| 0.2.6 | 19/11/2026 | WF 03: apelidos do Shopping Canoas (BUZZ 281). WF 04: `escala_ler_porto_belo` (Porto Belo/Tijucas podem sair da planilha e virar técnico fixo); armadilhas de reimportação e da sessão do WAHA no README |
| 0.3.0 | 23/11/2026 | Painel do Bot: os 55 textos do bot passam por `M(chave, padrão, vars)` — texto editado em `ixc.mensagens` ou o padrão embutido (sem edição = resposta igual à 0.2.6, teste diferencial). Linha cuja variável vem vazia some. WF 03: as frases ligadas de `ixc.perguntas` **somam** ao reconhecimento de setor de hoje; frase padrão desligada cala o setor; "só Recados" respeitado. Menção (@) pelo telefone em qualquer linha da resposta. Exige `painelbot/sql/01-mensagens-perguntas.sql` no banco antes de importar |
| 0.4.0 | 24/11/2026 | WF 03: apelidos de shopping ("quem está no <apelido>?") vêm de `ixc.apelidos`, editados no Painel do Bot (tabela vazia = os fixos de antes; com os padrão carregados a resposta é igual à 0.3.0 — `check/teste06.js`). Shopping novo cadastrado no painel passa a ser reconhecido pelo apelido. Exige o `painelbot/sql/01` da 0.3.0 do painel |
| 0.4.1 | 24/11/2026 | Planilha ESCALAS ligada ao cadastro por `nome_planilha` (nome inteiro; senão 1º nome, empate pelo 2º); resposta e `ixc quem` com nome e telefone do cadastro; WF 01 "de folga" pelo mesmo vínculo |
| 0.4.2 | 24/11/2026 | Técnico renomeado no painel sem "Nome na planilha" continua ligado ao 12x36 (nome da planilha contido no do cadastro; WF 03 também pelo telefone da Equipe) |
| 0.4.3 | 24/11/2026 | 2º nome no vínculo da planilha (um único candidato pelo 1º nome não basta se o 2º não bate) |
| 0.5.0 | 24/11/2026 | Painel do Bot 0.4.0: qualquer mensagem pode ser desativada (trecho some; mensagem inteira vazia não sai; tipo de aviso desativado = ignorado) e mensagens novas (resposta fixa a frases escolhidas, prioridade sobre setores/escala) |
| 0.6.0 | 24/11/2026 | WF 01: avisos **só no particular do técnico atribuído** (`tecnicos.fone`, sem @), para acabar com o spam nos grupos. Assumido, sem técnico, dono do número, fora do cadastro ou sem telefone = não sai (registrado como ignorado). Pedido de infra no particular do responsável (`infra_fone`). Sem marcação de plantão. Reenvio não manda falha antiga para grupo. `aviso_privado = nao` volta ao modo grupo. Script `v060_aviso_particular.py` (aplica também sobre o WF 01 0.2.x de produção); `check/teste11.js` |
| 0.6.1 | 24/11/2026 | Incidente de 24/11 (WF 01 de produção estava despublicado; ao publicar, mandou o histórico parado). WF 01: evento de O.S. que não é de hoje ou tem mais de `aviso_max_idade_min` (60) min é descartado; no máximo `aviso_max_rodada` (10) avisos e `reenvio_max_rodada` (5) reenvios por rodada; 8 s entre mensagens (antes 1,5 s). Script `v061_trava_antigos.py`; `check/teste12.js` |
| 0.4.1 | 24/11/2026 | Nome do técnico editado no Painel do Bot vale também nos shoppings **12x36**: a planilha ESCALAS é ligada ao cadastro por `ixc.tecnicos.nome_planilha` (vazio = nome; nome inteiro, senão 1º nome com desempate pelo 2º) e a resposta do WF 03 (pergunta e `ixc quem`) mostra o nome e o telefone do cadastro; WF 01 usa o mesmo vínculo para o "está de folga" (renomear não gera folga falsa) e mostra o plantão pelo nome do cadastro. Sem vínculo, igual à 0.4.0 (`check/teste07.js`). Coluna nova no `painelbot/sql/01` da 0.3.1 (a query funciona antes dela, por `to_jsonb`) |
| 0.4.2 | 24/11/2026 | Técnico **renomeado no Painel do Bot sem preencher o "Nome na planilha"** continua ligado à planilha nos 12x36: depois das regras da 0.4.1, liga se o nome da planilha está dentro do nome do cadastro ("Juliano" → "Testinho - Juliano", só um técnico da empresa, só com o campo vazio) e, no WF 03, pelo telefone da Equipe do shopping (o mesmo do @). Corrige a resposta "Juliano — @Testinho - Juliano" e o "está de folga" falso do WF 01 (`teste08` 18/18). |
| 0.4.3 | 24/11/2026 | O **1º nome sozinho** não liga mais a planilha a um técnico cujo 2º nome contradiz: no Jockey a planilha diz "Joao Soares"; com o Soares renomeado, a 0.4.2 mostrava o único "joao" que sobrou (Joao Henrique). Telefone da Equipe (`foneDe`) passa a preferir o nome inteiro / o 2º nome. WF 01: o "está de folga" confere o 2º nome (antes, Henrique atribuído com planilha "Joao Soares" não gerava folga mesmo sem renomear ninguém) (`teste09` 17/17). |
| 0.5.0 | 24/11/2026 | **Mensagens do Painel do Bot 0.4.0.** Mensagem **desativada** no painel: o trecho fica vazio e mensagem inteira vazia não é enviada (resposta do grupo, comando `ixc`, lembrete; tipo de aviso de chamado desativado é registrado como ignorado; alerta da planilha não avisa). **Mensagens novas**: WF 03 responde com o texto da mensagem quando a pergunta tem uma das frases (palavras inteiras, na ordem, também sem hífen; prioridade sobre setores e escala; "só Recados" respeitado). Consultas com `to_jsonb`: banco sem as colunas novas = igual à 0.4.3. Sem nada desativado, saída idêntica à 0.4.3 (`teste05` A=0.4.3/B=0.5.0). `teste10` 50/50; `scripts/check/cfgs_do_banco.py` gera o `cfgs.json` dos testes a partir do `banco/` + `painelbot/sql/01`. |

Regenerar a partir do pacote original: `python3 scripts/adaptar_waha.py <Exportacao_Automacao_IXC> <saída>`; cópia pública: `python3 scripts/sanitizar_publico.py n8n/sanitizar-workflows.py <saída> <Exportacao_Automacao_IXC> <pública>`; validar: `node scripts/check/valida.js <saída>/n8n && node scripts/check/teste01.js && node scripts/check/teste03.js`.

A partir da 0.2.0, depois do `adaptar_waha.py`: `python3 scripts/v020_lembrete_planta.py <saída>` (WF 02 com a planta) e `node scripts/check/teste02.js <saída>/n8n`. Na 0.2.1, depois do v020: `python3 scripts/v021_lembrete_particular.py <saída>`. Na 0.3.0, depois do v021: `python3 scripts/v030_mensagens_perguntas.py <saída>` e `node scripts/check/teste05.js <n8n 0.2.6> <saída>/n8n <cfgs.json>` (cfgs = saída das queries dos nós de config num banco com o schema `ixc` + `painelbot/sql/01`). Na 0.4.0: `python3 scripts/v040_apelidos.py <saída>` e `node scripts/check/teste06.js <n8n 0.3.0> <saída>/n8n <cfgs com apelidos>`. Na 0.4.1: `python3 scripts/v041_nome_planilha.py <saída>` e `node scripts/check/teste07.js <n8n 0.4.0> <saída>/n8n <cfgs>`. Na 0.4.2: `python3 scripts/v042_vinculo_renomeado.py <saída>` e `node scripts/check/teste08.js <n8n 0.4.1> <saída>/n8n` (dados fictícios, sem banco). Na 0.4.3: `python3 scripts/v043_segundo_nome.py <saída>` e `node scripts/check/teste09.js <n8n 0.4.2> <saída>/n8n`. Na 0.5.0: `python3 scripts/v050_mensagens_novas.py <saída>` e `node scripts/check/teste10.js <n8n 0.4.3> <saída>/n8n <cfgs.json>` (o `cfgs.json` sai de `scripts/check/cfgs_do_banco.py`; precisa do `painelbot/sql/01` da 0.4.0 rodado antes da importação).

## Planta da loja (0.2.0)

Recorte da planta comercial do shopping com a loja marcada em vermelho, mandado como **imagem com o aviso na legenda** (`/api/sendImage` do WAHA). Serviço em `planta-loja/` (ver o README de lá); as plantas em PDF e o índice ficam só no pacote de produção (`/root/planta-loja/dados`), não no repositório.

| Onde | Quando sai a planta |
|---|---|
| WF 01 | 1ª notificação ou transferência de O.S. de **Ativação/Vistoria** (`planta_assuntos`), com número de loja |
| WF 02 | **lembrete de 1 h** de qualquer visita agendada com número de loja; o de **10 min** é só texto curto. Desde a 0.2.1 os dois vão no **particular do técnico** |

- **Número da loja:** 1º campo preenchido entre apartamento/complemento do chamado e apartamento/complemento do cliente; shopping = `id_condominio` do chamado (ou do cliente).
- **Sem planta** (shopping sem planta — Riviera e Tijucas —, loja não achada ou repetida na planta, serviço fora do ar, `planta_ativo = 'nao'`): sai só o texto, como antes. O motivo fica em `ixc.eventos.motivo` (`com planta: L1 loja 102` / `sem planta: ...`).
- **Ligar/desligar:** `UPDATE ixc.parametros SET valor = 'sim' WHERE chave = 'planta_ativo';` (`'nao'` desliga nos dois workflows, sem mexer no n8n).
- **WF 02, janela curta:** o lembrete "em 15 minutos" (3–15 min, tipo `lembrete_15min`) virou "daqui 10 minutos" (3–10 min, tipo `lembrete_10min`). Na troca, uma visita que já recebeu o de 15 min pode receber também o de 10 min — só nas visitas daquela hora.
- **Conferência:** `SELECT tipo, status, motivo, count(*) FROM ixc.eventos WHERE tipo LIKE 'lembrete%' AND ts > now() - interval '1 day' GROUP BY 1,2,3;`

## Simulador para o ambiente de teste (simulador 0.1.1)

Pasta `simulador/`: WhatsApp (WAHA) e IXC **de mentira** com tela de grupos no navegador, para testar o bot de perguntas, os comandos `ixc`, os avisos de chamado e os lembretes de visita no n8n de teste, ligado ao banco de teste. Os workflows `[SIM]` são gerados da produção por `simulador/gerar_sim.py` com os endereços fixos no simulador (nada sai para o WhatsApp nem para o IXC reais). Instalação e limites: `simulador/README.md`. O pacote com os workflows convertidos tem dados reais e **não** vai para o repositório.

