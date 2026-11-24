-- Painel do Bot 0.3.1 — tabelas de MENSAGENS, PERGUNTAS e APELIDOS do bot (schema ixc, Postgres do whatsapp-ixc).
-- Rodar como o dono do banco (usuário ixc). Idempotente: pode rodar de novo; NÃO sobrescreve textos já editados.
--   docker exec -i n8n-compose-postgres-ixc-1 psql -U ixc -d ixc -v ON_ERROR_STOP=1 < 01-mensagens-perguntas.sql
-- O whatsapp-ixc 0.3.0/0.4.0/0.4.1 lê estas tabelas (texto editado, perguntas, apelidos). Rodar ANTES de importar os workflows.
-- Gerado por sql/gerar-sql.py a partir dos textos atuais dos workflows 01/02/03/04.

BEGIN;

CREATE TABLE IF NOT EXISTS ixc.mensagens (
  chave          text PRIMARY KEY,                 -- ex.: setor.titulo.n2
  grupo          text NOT NULL,                    -- onde aparece (agrupamento da tela)
  ordem          integer NOT NULL DEFAULT 0,
  titulo         text NOT NULL,                    -- quando aparece
  wf             text NOT NULL,                    -- workflow que monta (01, 02, 03, 04)
  exemplo        text,                             -- pergunta/comando de exemplo
  texto_padrao   text NOT NULL,                    -- texto embutido no workflow (o bot usa este se "texto" for nulo)
  texto          text,                             -- texto editado no painel (nulo = usa o padrão)
  variaveis      text[] NOT NULL DEFAULT '{}',     -- {variaveis} aceitas no texto
  atualizado     timestamptz,
  atualizado_por text
);

CREATE TABLE IF NOT EXISTS ixc.mensagens_hist (
  id      bigserial PRIMARY KEY,
  chave   text NOT NULL REFERENCES ixc.mensagens(chave) ON DELETE CASCADE,
  antes   text,
  depois  text,
  quando  timestamptz NOT NULL DEFAULT now(),
  quem    text
);
CREATE INDEX IF NOT EXISTS mensagens_hist_chave ON ixc.mensagens_hist (chave, quando DESC);

CREATE TABLE IF NOT EXISTS ixc.perguntas (
  id             serial PRIMARY KEY,
  alvo           text NOT NULL CHECK (alvo IN ('n2', 'financeiro', 'comercial', 'compras', 'rh')),  -- resposta acionada
  frase          text NOT NULL,                    -- como foi digitada (com acento)
  frase_norm     text NOT NULL,                    -- sem acento/maiúscula/pontuação (é o que o bot compara)
  grupos         text NOT NULL DEFAULT 'todos' CHECK (grupos IN ('todos', 'recados')),
  ativo          boolean NOT NULL DEFAULT true,
  padrao         boolean NOT NULL DEFAULT false,   -- veio com o bot: só desliga, não exclui
  criado_por     text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado     timestamptz,
  atualizado_por text,
  UNIQUE (alvo, frase_norm)
);
-- 0.3.0: pergunta padrao "excluida" no painel = some da lista e fica desligada (o bot para de responder a ela)
ALTER TABLE ixc.perguntas ADD COLUMN IF NOT EXISTS excluida boolean NOT NULL DEFAULT false;
-- 0.3.1: nome do tecnico como aparece na planilha ESCALAS (12x36); vazio = nome. whatsapp-ixc 0.4.1 liga a planilha ao cadastro por ele
ALTER TABLE ixc.tecnicos ADD COLUMN IF NOT EXISTS nome_planilha text;

-- 0.3.0: apelidos de shopping (como as pessoas chamam no grupo: "quem esta no <apelido>?"); antes fixos no WF 03
CREATE TABLE IF NOT EXISTS ixc.apelidos (
  id             serial PRIMARY KEY,
  apelido        text NOT NULL,                    -- como foi digitado
  apelido_norm   text NOT NULL UNIQUE,             -- sem acento/maiuscula/pontuacao (o que o bot compara)
  alvos          text[] NOT NULL,                  -- shoppings 'EMPRESA:ID_CONDOMINIO' (mais de um = apelido de cidade/rede)
  generico       boolean NOT NULL DEFAULT false,   -- so vale se nenhum shopping especifico foi citado (ex.: curitiba)
  padrao         boolean NOT NULL DEFAULT false,   -- veio do WF 03
  criado_por     text,
  criado_em      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- mensagens (textos atuais = padrão)
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('escala.cabecalho', 'Bot de escalas (perguntas no grupo)', 101, 'Topo de toda resposta automática do bot (shoppings e setores)', '03', 'quem está no Jockey?', '🤖 *Resposta automática do bot de escalas*', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('escala.shopping.titulo', 'Bot de escalas (perguntas no grupo)', 102, 'Resposta de um shopping — 1ª linha', '03', 'quem está no Jockey?', '🏬 *{shopping}* ({empresa}){regime}', ARRAY['shopping','empresa','regime']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('escala.shopping.dia', 'Bot de escalas (perguntas no grupo)', 103, 'Linha de Hoje / Amanhã', '03', 'quem está no Jockey?', '*{rotulo} ({dia} {data})* — {horario}{status}', ARRAY['rotulo','dia','data','horario','status']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('escala.shopping.nao_atende', 'Bot de escalas (perguntas no grupo)', 104, 'Dia em que o shopping não tem atendimento', '03', 'quem está no Pontal domingo?', '*{rotulo} ({dia} {data})*: não atende', ARRAY['rotulo','dia','data']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('escala.shopping.pessoa', 'Bot de escalas (perguntas no grupo)', 105, 'Cada técnico listado (o telefone vira @menção)', '03', 'quem está no Jockey?', '👤 {tecnico} — {telefone}', ARRAY['tecnico','telefone']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('escala.shopping.proximo', 'Bot de escalas (perguntas no grupo)', 106, 'Shopping sem atendimento hoje e amanhã', '03', 'quem está no Sinop?', '*Próximo atendimento ({dia} {data})* — {horario}', ARRAY['dia','data','horario']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('escala.shopping.horario', 'Bot de escalas (perguntas no grupo)', 107, 'Rodapé com o horário da semana', '03', 'quem está no Jockey?', 'Horário: {semana}', ARRAY['semana']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('escala.status.comeca', 'Bot de escalas (perguntas no grupo)', 108, 'Status: ainda não começou', '03', NULL, ' · ⏳ começa às {inicio}', ARRAY['inicio']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('escala.status.atendendo', 'Bot de escalas (perguntas no grupo)', 109, 'Status: em atendimento agora', '03', NULL, ' · 🟢 em atendimento (até {fim})', ARRAY['fim']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('escala.status.encerrou', 'Bot de escalas (perguntas no grupo)', 110, 'Status: já encerrou', '03', NULL, ' · 🔴 encerrou às {fim}', ARRAY['fim']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('escala.sem_escala_dia', 'Bot de escalas (perguntas no grupo)', 111, '12x36 sem linha do dia na planilha', '03', NULL, '_(escala do dia não encontrada na planilha)_', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('escala.sem_tecnico', 'Bot de escalas (perguntas no grupo)', 112, 'Shopping sem técnico cadastrado', '03', NULL, 'sem técnico cadastrado', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('escala.quem_hoje.titulo', 'Bot de escalas (perguntas no grupo)', 113, 'Lista geral: quem atende hoje', '03', 'quem tá hoje?', '👷 *Quem atende hoje* ({dia} {data}, {hora})', ARRAY['dia','data','hora']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('escala.pelotas', 'Bot de escalas (perguntas no grupo)', 114, 'Pergunta sobre Pelotas (sem contrato ativo)', '03', 'tem alguém em Pelotas?', '🏬 *Shopping Pelotas*
Sem técnico no momento (em fase de entrega de contrato).', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('setor.titulo.n2', 'Setores (algum N2? / financeiro? …)', 201, 'Título do bloco N2', '03', 'algum N2 disponível?', '🛠️ *Suporte N2*', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('setor.titulo.financeiro', 'Setores (algum N2? / financeiro? …)', 202, 'Título do bloco Financeiro (só no grupo Recados)', '03', 'alguém do financeiro?', '💰 *Financeiro*', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('setor.titulo.comercial', 'Setores (algum N2? / financeiro? …)', 203, 'Título do bloco Comercial (só no grupo Recados)', '03', 'comercial na ativa?', '💼 *Comercial*', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('setor.titulo.compras', 'Setores (algum N2? / financeiro? …)', 204, 'Título do bloco Compras (só no grupo Recados)', '03', 'alguém de compras?', '🛒 *Compras*', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('setor.titulo.rh', 'Setores (algum N2? / financeiro? …)', 205, 'Título do bloco RH (só no grupo Recados)', '03', 'contato do RH', '👥 *RH*', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('setor.contato', 'Setores (algum N2? / financeiro? …)', 206, 'Cada pessoa do setor (o telefone vira @menção)', '03', 'algum N2?', '👤 {nome} — {telefone}
🕐 {horario} · {status}', ARRAY['nome','telefone','horario','status']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('setor.status.atendendo', 'Setores (algum N2? / financeiro? …)', 207, 'Status: atendendo agora', '03', 'algum N2?', '🟢 atendendo agora (até {fim})', ARRAY['fim']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('setor.status.volta_hoje', 'Setores (algum N2? / financeiro? …)', 208, 'Status: volta mais tarde hoje', '03', NULL, '⏳ volta hoje às {inicio}', ARRAY['inicio']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('setor.status.fora', 'Setores (algum N2? / financeiro? …)', 209, 'Status: fora do horário', '03', NULL, '🔴 fora do horário · volta {quando} às {inicio}', ARRAY['quando','inicio']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('setor.status.plantao_comeca', 'Setores (algum N2? / financeiro? …)', 210, '12x36: de plantão hoje, ainda não começou', '03', NULL, '⏳ de plantão hoje, começa às {inicio}', ARRAY['inicio']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('setor.status.plantao_agora', 'Setores (algum N2? / financeiro? …)', 211, '12x36: de plantão agora', '03', NULL, '🟢 de plantão agora (até {fim})', ARRAY['fim']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('setor.status.plantao_encerrou', 'Setores (algum N2? / financeiro? …)', 212, '12x36: plantão de hoje encerrou', '03', NULL, '🔴 plantão de hoje encerrou às {fim} · próximo {dia} {data} às {inicio}', ARRAY['fim','dia','data','inicio']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('setor.status.folga_amanha', 'Setores (algum N2? / financeiro? …)', 213, '12x36: folga hoje, plantão amanhã', '03', NULL, '🔴 folga hoje · plantão amanhã às {inicio}', ARRAY['inicio']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('setor.status.folga', 'Setores (algum N2? / financeiro? …)', 214, '12x36: folga hoje', '03', NULL, '🔴 folga hoje (12x36)', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('setor.status.sem_horario', 'Setores (algum N2? / financeiro? …)', 215, 'Contato sem horário cadastrado', '03', NULL, '⚪ horário não informado', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('setor.sem_contato', 'Setores (algum N2? / financeiro? …)', 216, 'Setor sem ninguém ativo', '03', NULL, '_sem contato cadastrado_', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('setor.ir_recados', 'Setores (algum N2? / financeiro? …)', 217, 'Pergunta de Financeiro/Comercial/Compras/RH fora do grupo Recados', '03', 'alguém do financeiro? (num grupo de shopping)', '📌 Para falar com *{setores}*, pergunte no grupo *Resolutto - Recados*: é lá que estão todos os setores (Financeiro, Comercial, Compras e RH).', ARRAY['setores']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('cmd.ajuda', 'Comandos ixc (alterações pelo grupo)', 301, 'Resposta de *ixc ajuda*', '03', 'ixc ajuda', '🛠️ *Comandos IXC* (só valem depois de *ixc ok*)

*ixc lista* [empresa ou shopping] — quem é marcado em cada shopping
*ixc tecnicos* [empresa] — técnicos e números
*ixc quem* <shopping ou técnico> — quem atende, horário, hoje e amanhã (*ixc quem hoje* = todos)

*ixc shopping* <shopping> *tecnico* <técnico> — troca o técnico do shopping
*ixc numero* <técnico> <telefone> — troca o número do técnico
*ixc incluir* <técnico ou telefone> *em* <shopping> — marca também essa pessoa quando o chamado ficar sem técnico
*ixc remover* <técnico ou telefone> *de* <shopping>
*ixc novo tecnico* <empresa> <id no IXC> <nome> <telefone>

*ixc ok* — aplica a alteração pendente · *ixc cancelar* — descarta

Ex.: _ixc shopping Tijucas tecnico Joao_ · _ixc numero Fulano 41 99999-0000_', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('cmd.lista.titulo', 'Comandos ixc (alterações pelo grupo)', 302, 'Resposta de *ixc lista*', '03', 'ixc lista', '📋 *Marcação por shopping*
_técnico → chamado atribuído a ele marca ele; sem técnico → marca a lista_', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('cmd.tecnicos.titulo', 'Comandos ixc (alterações pelo grupo)', 303, 'Resposta de *ixc tecnicos*', '03', 'ixc tecnicos', '👷 *Técnicos*', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('cmd.feriados.titulo', 'Comandos ixc (alterações pelo grupo)', 304, 'Resposta de *ixc feriados*', '03', 'ixc feriados', '📅 *Próximos feriados (sem reaviso)*', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('cmd.pendente', 'Comandos ixc (alterações pelo grupo)', 305, 'Toda alteração pedida, antes do *ixc ok*', '03', 'ixc numero Fulano 41 99999-0000', '📝 *Alteração pendente:* {alteracao}

Responda *ixc ok* em até 15 min pra aplicar (ou *ixc cancelar*).', ARRAY['alteracao']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('cmd.sem_whatsapp', 'Comandos ixc (alterações pelo grupo)', 306, 'Número informado não tem WhatsApp', '03', NULL, '❌ O número {telefone} não tem WhatsApp. Confere e manda de novo.', ARRAY['telefone']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('cmd.nao_confirmou_whatsapp', 'Comandos ixc (alterações pelo grupo)', 307, 'WAHA não respondeu a checagem do número', '03', NULL, '⚠️ Não consegui confirmar se o número tem WhatsApp.', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('cmd.nao_achei_shopping', 'Comandos ixc (alterações pelo grupo)', 308, 'Shopping digitado não existe', '03', 'ixc quem Xpto', 'Não achei o shopping "{busca}". Veja os nomes com *ixc lista*.', ARRAY['busca']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('cmd.nao_achei_tecnico', 'Comandos ixc (alterações pelo grupo)', 309, 'Técnico digitado não existe', '03', NULL, 'Não achei o técnico "{busca}"{na_empresa}. Veja com *ixc tecnicos*{empresa} (técnico novo: *ixc novo tecnico*).', ARRAY['busca','na_empresa','empresa']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('cmd.nao_achei_nada', 'Comandos ixc (alterações pelo grupo)', 310, '*ixc quem* sem resultado', '03', 'ixc quem Fulano', 'Não achei shopping nem técnico "{busca}". Tente *ixc quem hoje* ou *ixc lista*.', ARRAY['busca']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('cmd.nao_entendi', 'Comandos ixc (alterações pelo grupo)', 311, 'Comando ixc desconhecido', '03', 'ixc blabla', 'Não entendi o comando. Mande *ixc ajuda* pra ver a lista.', '{}'::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('aviso.novo', 'Avisos de chamado (grupo do shopping)', 401, 'Chamado aberto com técnico', '01', NULL, '🆕 Novo chamado — {marcados}', ARRAY['marcados']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('aviso.transferido', 'Avisos de chamado (grupo do shopping)', 402, 'Chamado transferido para alguém', '01', NULL, '📨 Chamado transferido — {marcados}', ARRAY['marcados']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('aviso.assumido', 'Avisos de chamado (grupo do shopping)', 403, 'Técnico assumiu o chamado', '01', NULL, '👤 Chamado assumido — {marcados}', ARRAY['marcados']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('aviso.sem_tecnico', 'Avisos de chamado (grupo do shopping)', 404, 'Chamado 10 min sem técnico', '01', NULL, '⚠️ Chamado sem técnico há 10+ min — {marcados}', ARRAY['marcados']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('aviso.segue_sem_tecnico', 'Avisos de chamado (grupo do shopping)', 405, 'Reaviso de chamado parado sem técnico', '01', NULL, '⚠️ Chamado segue sem técnico há {tempo} — {marcados}', ARRAY['tempo','marcados']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('aviso.escalado', 'Avisos de chamado (grupo do shopping)', 406, 'Reaviso escalado para supervisão/coordenação', '01', NULL, '🚨 Chamado segue sem técnico há {tempo} (escalado) — {marcados}', ARRAY['tempo','marcados']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('aviso.folga', 'Avisos de chamado (grupo do shopping)', 407, 'Técnico atribuído está de folga hoje', '01', NULL, '⚠️ {tecnico} está de folga hoje — plantão no {shopping}: {plantao}', ARRAY['tecnico','shopping','plantao']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('aviso.corpo', 'Avisos de chamado (grupo do shopping)', 408, 'Linhas do chamado abaixo do título (as vazias somem)', '01', NULL, '🎫 #{protocolo} · {assunto}
🏢 {shopping}
👤 {cliente}
🏬 {loja}
📞 {telefone}
💬 {resumo}', ARRAY['protocolo','assunto','shopping','cliente','loja','telefone','resumo']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('aviso.sem_tecnico_linha', 'Avisos de chamado (grupo do shopping)', 409, 'Linha do shopping quando o chamado está sem técnico', '01', NULL, '{shopping} · sem técnico atribuído', ARRAY['shopping']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('lembrete.1h', 'Lembretes de visita', 501, '1 hora antes da visita agendada (vai com a planta da loja)', '02', NULL, '⏰ *Lembrete de visita — {janela}* — {marcados}
🏢 {shopping}
🕐 Visita às *{hora}*{ate}
🎫 #{protocolo} · {assunto}
👤 {cliente}
🏬 {loja}
📍 {local}
📞 {telefone}', ARRAY['janela','marcados','shopping','hora','ate','protocolo','assunto','cliente','loja','local','telefone']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('lembrete.10min', 'Lembretes de visita', 502, '10 minutos antes da visita', '02', NULL, '⏰ Não esqueça: visita {visita}{onde} daqui {minutos}, às {hora}.
{marcados}', ARRAY['visita','onde','minutos','hora','marcados']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('alerta.planilha', 'Alertas internos (grupo de automação)', 601, 'Planilha ESCALAS falhou 3 leituras seguidas', '04', NULL, '⚠️ Leitura da planilha ESCALAS falhou 3x seguidas (quem está no shopping pode ficar desatualizado): {erro}', ARRAY['erro']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;
INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES ('envio.simulacao', 'Alertas internos (grupo de automação)', 602, 'Prefixo no modo SIMULAR (vai para o número de teste)', '01/02', NULL, '🧪 SIMULAÇÃO → {grupo}', ARRAY['grupo']::text[])
  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;

-- ---------------------------------------------------------------- perguntas padrão (hoje embutidas no WF 03)
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('n2', 'algum N2', 'algum n2', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('n2', 'alguém do N2', 'alguem do n2', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('n2', 'alguém no N2', 'alguem no n2', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('n2', 'quem está do N2', 'quem esta do n2', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('n2', 'quem está no N2', 'quem esta no n2', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('n2', 'N2 disponível', 'n2 disponivel', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('n2', 'N2 online', 'n2 online', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('n2', 'N2 on', 'n2 on', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('n2', 'N2 na ativa', 'n2 na ativa', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('n2', 'N2 agora', 'n2 agora', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('n2', 'contato do N2', 'contato do n2', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('n2', 'número do N2', 'numero do n2', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('n2', 'telefone do N2', 'telefone do n2', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('n2', 'whatsapp do N2', 'whatsapp do n2', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('n2', 'ramal do N2', 'ramal do n2', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'algum financeiro', 'algum financeiro', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'alguém do financeiro', 'alguem do financeiro', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'alguém no financeiro', 'alguem no financeiro', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'quem está do financeiro', 'quem esta do financeiro', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'quem está no financeiro', 'quem esta no financeiro', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'financeiro disponível', 'financeiro disponivel', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'financeiro online', 'financeiro online', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'financeiro on', 'financeiro on', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'financeiro na ativa', 'financeiro na ativa', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'financeiro agora', 'financeiro agora', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'contato do financeiro', 'contato do financeiro', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'número do financeiro', 'numero do financeiro', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'telefone do financeiro', 'telefone do financeiro', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'whatsapp do financeiro', 'whatsapp do financeiro', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'ramal do financeiro', 'ramal do financeiro', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'alguém do faturamento', 'alguem do faturamento', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'contato do faturamento', 'contato do faturamento', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'faturamento disponível', 'faturamento disponivel', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'alguém da cobrança', 'alguem da cobranca', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'contato da cobrança', 'contato da cobranca', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('financeiro', 'cobrança disponível', 'cobranca disponivel', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'algum comercial', 'algum comercial', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'alguém do comercial', 'alguem do comercial', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'alguém no comercial', 'alguem no comercial', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'quem está do comercial', 'quem esta do comercial', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'quem está no comercial', 'quem esta no comercial', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'comercial disponível', 'comercial disponivel', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'comercial online', 'comercial online', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'comercial on', 'comercial on', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'comercial na ativa', 'comercial na ativa', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'comercial agora', 'comercial agora', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'contato do comercial', 'contato do comercial', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'número do comercial', 'numero do comercial', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'telefone do comercial', 'telefone do comercial', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'whatsapp do comercial', 'whatsapp do comercial', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'ramal do comercial', 'ramal do comercial', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'alguém de vendas', 'alguem de vendas', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'contato de vendas', 'contato de vendas', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('comercial', 'vendas disponível', 'vendas disponivel', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('compras', 'algum compras', 'algum compras', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('compras', 'alguém de compras', 'alguem de compras', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('compras', 'alguém no compras', 'alguem no compras', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('compras', 'quem está de compras', 'quem esta de compras', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('compras', 'quem está no compras', 'quem esta no compras', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('compras', 'compras disponível', 'compras disponivel', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('compras', 'compras online', 'compras online', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('compras', 'compras on', 'compras on', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('compras', 'compras na ativa', 'compras na ativa', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('compras', 'compras agora', 'compras agora', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('compras', 'contato de compras', 'contato de compras', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('compras', 'número de compras', 'numero de compras', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('compras', 'telefone de compras', 'telefone de compras', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('compras', 'whatsapp de compras', 'whatsapp de compras', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('compras', 'ramal de compras', 'ramal de compras', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'algum RH', 'algum rh', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'alguém do RH', 'alguem do rh', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'alguém no RH', 'alguem no rh', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'quem está do RH', 'quem esta do rh', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'quem está no RH', 'quem esta no rh', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'RH disponível', 'rh disponivel', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'RH online', 'rh online', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'RH on', 'rh on', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'RH na ativa', 'rh na ativa', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'RH agora', 'rh agora', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'contato do RH', 'contato do rh', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'número do RH', 'numero do rh', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'telefone do RH', 'telefone do rh', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'whatsapp do RH', 'whatsapp do rh', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'ramal do RH', 'ramal do rh', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'alguém de recursos humanos', 'alguem de recursos humanos', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'contato de recursos humanos', 'contato de recursos humanos', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;
INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES ('rh', 'recursos humanos disponível', 'recursos humanos disponivel', true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;

-- ---------------------------------------------------------------- apelidos padrão (hoje fixos no WF 03)
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('palladium curitiba', 'palladium curitiba', ARRAY['4B:199']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('palladium cwb', 'palladium cwb', ARRAY['4B:199']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('palladium ctba', 'palladium ctba', ARRAY['4B:199']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('paladiun curitiba', 'paladiun curitiba', ARRAY['4B:199']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('paladium curitiba', 'paladium curitiba', ARRAY['4B:199']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('palladium', 'palladium', ARRAY['4B:199']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('paladiun', 'paladiun', ARRAY['4B:199']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('paladium', 'paladium', ARRAY['4B:199']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('curitiba', 'curitiba', ARRAY['4B:199','4B:200','CACTA:263','BUZZ:269']::text[], true, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('catuai palladium', 'catuai palladium', ARRAY['4B:201']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('catuai foz', 'catuai foz', ARRAY['4B:201']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('palladium foz', 'palladium foz', ARRAY['4B:201']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('foz do iguacu', 'foz do iguacu', ARRAY['4B:201']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('foz', 'foz', ARRAY['4B:201']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('palladium umuarama', 'palladium umuarama', ARRAY['4B:202']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('umuarama', 'umuarama', ARRAY['4B:202']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('cidade dos lagos', 'cidade dos lagos', ARRAY['4B:275']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('guarapuava', 'guarapuava', ARRAY['4B:275']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('outlet city center', 'outlet city center', ARRAY['4B:244']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('city center campo largo', 'city center campo largo', ARRAY['4B:244']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('city center', 'city center', ARRAY['4B:244']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('citty center', 'citty center', ARRAY['4B:244']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('city centre', 'city centre', ARRAY['4B:244']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('cit center', 'cit center', ARRAY['4B:244']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('sity center', 'sity center', ARRAY['4B:244']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('citycenter', 'citycenter', ARRAY['4B:244']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('outlet campo largo', 'outlet campo largo', ARRAY['4B:244']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('campo largo', 'campo largo', ARRAY['4B:244']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('pato branco', 'pato branco', ARRAY['4B:276']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('petropolis', 'petropolis', ARRAY['4B:243']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('ventura', 'ventura', ARRAY['4B:200']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('plaza campos gerais', 'plaza campos gerais', ARRAY['BUZZ:280']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('campos gerais', 'campos gerais', ARRAY['BUZZ:280']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('ponta grossa', 'ponta grossa', ARRAY['BUZZ:280']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('estacao', 'estacao', ARRAY['BUZZ:269']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('gravatai', 'gravatai', ARRAY['BUZZ:271']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('canoas shopping', 'canoas shopping', ARRAY['BUZZ:281']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('canoas', 'canoas', ARRAY['BUZZ:281']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('catuai cascavel', 'catuai cascavel', ARRAY['CACTA:260']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('cascavel', 'cascavel', ARRAY['CACTA:260']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('jockey plaza', 'jockey plaza', ARRAY['CACTA:263']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('jockey plazza', 'jockey plazza', ARRAY['CACTA:263']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('jockey', 'jockey', ARRAY['CACTA:263']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('park city sumare', 'park city sumare', ARRAY['CACTA:253']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('parck city sumare', 'parck city sumare', ARRAY['CACTA:253']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('park city', 'park city', ARRAY['CACTA:253']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('parck city', 'parck city', ARRAY['CACTA:253']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('parque city', 'parque city', ARRAY['CACTA:253']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('park citi', 'park citi', ARRAY['CACTA:253']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('parkcity', 'parkcity', ARRAY['CACTA:253']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('park sumare', 'park sumare', ARRAY['CACTA:253']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('shopping sumare', 'shopping sumare', ARRAY['CACTA:253']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('sumare', 'sumare', ARRAY['CACTA:253']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('patteo urupema', 'patteo urupema', ARRAY['CACTA:247']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('patteo', 'patteo', ARRAY['CACTA:247']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('pateo', 'pateo', ARRAY['CACTA:247']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('patio urupema', 'patio urupema', ARRAY['CACTA:247']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('urupema', 'urupema', ARRAY['CACTA:247']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('mogi das cruzes', 'mogi das cruzes', ARRAY['CACTA:247']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('park shopping', 'park shopping', ARRAY['CACTA:253','CACTA:248']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('parkshopping', 'parkshopping', ARRAY['CACTA:253','CACTA:248']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('parck shopping', 'parck shopping', ARRAY['CACTA:253','CACTA:248']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('park', 'park', ARRAY['CACTA:253','CACTA:248']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('parck', 'parck', ARRAY['CACTA:253','CACTA:248']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('parkshopping mogi mirim', 'parkshopping mogi mirim', ARRAY['CACTA:248']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('park shopping mogi mirim', 'park shopping mogi mirim', ARRAY['CACTA:248']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('parkshopping mogi', 'parkshopping mogi', ARRAY['CACTA:248']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('park shopping mogi', 'park shopping mogi', ARRAY['CACTA:248']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('parck shopping mogi', 'parck shopping mogi', ARRAY['CACTA:248']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('parque shopping mogi', 'parque shopping mogi', ARRAY['CACTA:248']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('park mogi', 'park mogi', ARRAY['CACTA:248']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('parck mogi', 'parck mogi', ARRAY['CACTA:248']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('shopping mogi mirim', 'shopping mogi mirim', ARRAY['CACTA:248']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('mogi mirim', 'mogi mirim', ARRAY['CACTA:248']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('mogi mirin', 'mogi mirin', ARRAY['CACTA:248']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('pontal', 'pontal', ARRAY['CACTA:206']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('ifashion', 'ifashion', ARRAY['PONTO:144']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('i fashion', 'i fashion', ARRAY['PONTO:144']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('fashion outlet', 'fashion outlet', ARRAY['PONTO:144']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('ifosc', 'ifosc', ARRAY['PONTO:144']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('tijucas', 'tijucas', ARRAY['PONTO:144']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('itajai', 'itajai', ARRAY['PONTO:104']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('porto belo', 'porto belo', ARRAY['PONTO:134']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('portobelo', 'portobelo', ARRAY['PONTO:134']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('passo fundo', 'passo fundo', ARRAY['PONTO:159']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('pulse', 'pulse', ARRAY['PONTO:273']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('patio chapeco', 'patio chapeco', ARRAY['PONTO:84']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('patio', 'patio', ARRAY['PONTO:84']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('chapeco', 'chapeco', ARRAY['PONTO:84','PONTO:273']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('riviera', 'riviera', ARRAY['PONTO:110']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('sinop', 'sinop', ARRAY['PONTO:216']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;
INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES ('catuai', 'catuai', ARRAY['4B:201','CACTA:260']::text[], false, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;

COMMIT;

-- conferência
SELECT grupo, count(*) AS mensagens, count(*) FILTER (WHERE texto IS NOT NULL) AS editadas FROM ixc.mensagens GROUP BY grupo ORDER BY min(ordem);
SELECT alvo, count(*) AS perguntas, count(*) FILTER (WHERE NOT padrao) AS criadas_no_painel FROM ixc.perguntas GROUP BY alvo ORDER BY alvo;
SELECT count(*) AS apelidos, count(*) FILTER (WHERE NOT padrao) AS criados_no_painel FROM ixc.apelidos;
