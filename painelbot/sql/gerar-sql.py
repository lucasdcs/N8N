# Gera sql/01-mensagens-perguntas.sql a partir de sql/catalogo-mensagens.json (textos atuais do whatsapp-ixc)
# uso: python3 sql/gerar-sql.py sql/catalogo-mensagens.json sql/01-mensagens-perguntas.sql
import json, unicodedata, re, sys, os
cat = json.load(open(sys.argv[1]))
ORD_G = ['Bot de escalas (perguntas no grupo)', 'Setores (algum N2? / financeiro? …)', 'Comandos ixc (alterações pelo grupo)',
         'Avisos de chamado (grupo do shopping)', 'Lembretes de visita', 'Alertas internos (grupo de automação)']
def lit(s): return "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"
def arr(a): return "ARRAY[" + ",".join(lit(x) for x in a) + "]::text[]" if a else "'{}'::text[]"
def norm(s):
    s = unicodedata.normalize('NFD', s.lower()); s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', ' ', s)).strip()
L = []
L.append("""-- Painel do Bot 0.5.2 — tabelas de MENSAGENS, PERGUNTAS, APELIDOS, AUDITORIA e ALERTAS do painel (schema ixc, Postgres do whatsapp-ixc).
-- Rodar como o dono do banco (usuário ixc). Idempotente: pode rodar de novo; NÃO sobrescreve textos já editados.
--   docker exec -i n8n-compose-postgres-ixc-1 psql -U ixc -d ixc -v ON_ERROR_STOP=1 < 01-mensagens-perguntas.sql
-- O whatsapp-ixc 0.3.0 em diante lê estas tabelas (texto editado, perguntas, apelidos; 0.5.0: mensagens desativadas e novas). Rodar ANTES de importar os workflows.
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
-- 0.4.0: mensagem desativada (o bot deixa o trecho vazio; mensagem inteira vazia nao e enviada) e mensagens NOVAS criadas
-- no painel (chave resp.N): resposta automatica no grupo quando alguem escreve uma das frases. whatsapp-ixc 0.5.0 le.
ALTER TABLE ixc.mensagens ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
ALTER TABLE ixc.mensagens ADD COLUMN IF NOT EXISTS criada_painel boolean NOT NULL DEFAULT false;  -- resp.N: texto em texto_padrao
ALTER TABLE ixc.mensagens ADD COLUMN IF NOT EXISTS frases text[] NOT NULL DEFAULT '{}';         -- como foram digitadas
ALTER TABLE ixc.mensagens ADD COLUMN IF NOT EXISTS frases_norm text[] NOT NULL DEFAULT '{}';    -- o que o bot compara
ALTER TABLE ixc.mensagens ADD COLUMN IF NOT EXISTS grupos text NOT NULL DEFAULT 'todos';        -- todos | recados
ALTER TABLE ixc.mensagens ADD COLUMN IF NOT EXISTS criado_por text;
ALTER TABLE ixc.mensagens ADD COLUMN IF NOT EXISTS criado_em timestamptz;

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
""")
L.append("-- ---------------------------------------------------------------- mensagens (textos atuais = padrão)")
cont = {}
for m in cat:
    g = ORD_G.index(m['grupo']); cont[g] = cont.get(g, 0) + 1
    ordem = (g + 1) * 100 + cont[g]
    L.append("INSERT INTO ixc.mensagens (chave, grupo, ordem, titulo, wf, exemplo, texto_padrao, variaveis) VALUES (%s, %s, %d, %s, %s, %s, %s, %s)\n  ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem, titulo = EXCLUDED.titulo, wf = EXCLUDED.wf, exemplo = EXCLUDED.exemplo, texto_padrao = EXCLUDED.texto_padrao, variaveis = EXCLUDED.variaveis;"
             % (lit(m['chave']), lit(m['grupo']), ordem, lit(m['quando']), lit(m['wf']), lit(m['exemplo'] or None), lit(m['texto']), arr(m['vars'])))
# perguntas padrão: as mesmas formas que o nó "Escala: Filtrar Pergunta" (SET) reconhece hoje
SET = {'n2': [('n2', 'do')], 'financeiro': [('financeiro', 'do'), ('faturamento', 'do'), ('cobrança', 'da')],
       'comercial': [('comercial', 'do'), ('vendas', 'de')], 'compras': [('compras', 'de')], 'rh': [('rh', 'do'), ('recursos humanos', 'de')]}
FORMAS_PRINC = ['algum {p}', 'alguém {a} {p}', 'alguém no {p}', 'quem está {a} {p}', 'quem está no {p}', '{p} disponível', '{p} online', '{p} on',
                '{p} na ativa', '{p} agora', 'contato {a} {p}', 'número {a} {p}', 'telefone {a} {p}', 'whatsapp {a} {p}', 'ramal {a} {p}']
FORMAS_SIN = ['alguém {a} {p}', 'contato {a} {p}', '{p} disponível']
L.append("\n-- ---------------------------------------------------------------- perguntas padrão (hoje embutidas no WF 03)")
vistos = set()
for alvo, palavras in SET.items():
    for k, (p, a) in enumerate(palavras):
        for f in (FORMAS_PRINC if k == 0 else FORMAS_SIN):
            frase = f.format(p=p, a=a)
            if alvo == 'n2': frase = frase.replace(' n2', ' N2').replace('n2 ', 'N2 ')
            if alvo == 'rh': frase = frase.replace('rh', 'RH')
            n = norm(frase)
            if (alvo, n) in vistos: continue
            vistos.add((alvo, n))
            L.append("INSERT INTO ixc.perguntas (alvo, frase, frase_norm, padrao, criado_por) VALUES (%s, %s, %s, true, 'bot (padrão)') ON CONFLICT (alvo, frase_norm) DO NOTHING;" % (lit(alvo), lit(frase), lit(n)))
L.append("\n-- ---------------------------------------------------------------- apelidos padrão (hoje fixos no WF 03)")
for a in json.load(open(os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), 'apelidos-padrao.json'))):
    L.append("INSERT INTO ixc.apelidos (apelido, apelido_norm, alvos, generico, padrao, criado_por) VALUES (%s, %s, %s, %s, true, 'bot (padrão)') ON CONFLICT (apelido_norm) DO NOTHING;"
             % (lit(a['apelido']), lit(norm(a['apelido'])), arr(a['alvos']), 'true' if a['generico'] else 'false'))
L.append("""
-- 0.4.0: permissoes do usuario do painel nas colunas novas (sem precisar rodar o 02 de novo; o 02 tambem tem)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'painel_glpi') THEN
    GRANT INSERT, DELETE ON ixc.mensagens TO painel_glpi;
    GRANT UPDATE (titulo, exemplo, texto_padrao, ativo, frases, frases_norm, grupos) ON ixc.mensagens TO painel_glpi;
  END IF;
END $$;

-- 0.5.0: o painel passa a operar o bot. Auditoria de quem mudou parametros, bases, modo de envio e workflows.
CREATE TABLE IF NOT EXISTS ixc.painel_auditoria (
  id      bigserial PRIMARY KEY,
  ts      timestamptz NOT NULL DEFAULT now(),
  quem    text NOT NULL,                 -- usuario do GLPI
  acao    text NOT NULL,                 -- parametro, base, base_token, workflow_pausar, workflow_retomar...
  alvo    text NOT NULL,                 -- chave do parametro, id da base, id do workflow
  antes   text,                          -- valor anterior (token nunca: so "(token trocado)")
  depois  text
);
CREATE INDEX IF NOT EXISTS painel_auditoria_ts ON ixc.painel_auditoria (ts DESC);
-- 0.5.0: parametros e bases editaveis no painel. Token do IXC (auth): o painel GRAVA, mas continua sem LER.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'painel_glpi') THEN
    GRANT SELECT, INSERT ON ixc.painel_auditoria TO painel_glpi;
    GRANT USAGE ON SEQUENCE ixc.painel_auditoria_id_seq TO painel_glpi;
    GRANT UPDATE (valor) ON ixc.parametros TO painel_glpi;
    GRANT UPDATE (nome, base_url, ativo, ignorar_assuntos, assuntos_financeiros, semtec_sem_local, dono_id, auth) ON ixc.empresas TO painel_glpi;
    -- 0.5.1: nova base (nasce inativa, com o ultimo evento do IXC)
    GRANT INSERT (id, nome, base_url, auth, last_evento_id, dono_id, ignorar_assuntos, semtec_sem_local, ativo, assuntos_financeiros) ON ixc.empresas TO painel_glpi;
  END IF;
END $$;
-- 0.5.1: chave do "Rodar agora" (whatsapp-ixc 0.6.5: webhook "Rodar agora (painel)" so roda com ela). Gerada uma vez, aleatoria;
-- o painel le do banco e nunca mostra. Trocar: UPDATE ixc.parametros SET valor = md5(random()::text) WHERE chave = 'painel_rodar_chave';
INSERT INTO ixc.parametros (chave, valor, descricao)
VALUES ('painel_rodar_chave', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text),
        'painelbot 0.5.1: chave do Rodar agora do painel (nao mostrar, nao editar)')
ON CONFLICT (chave) DO NOTHING;

-- 0.5.2 (F2a do roadmap de acoes): ALERTAS = regras dos avisos de chamado no banco, para o painel criar/editar/pausar.
-- Nesta versao nenhum workflow le estas tabelas: o WF 01 continua mandando como hoje. O motor novo (whatsapp-ixc 0.7.0)
-- roda em SOMBRA (calcula e grava em ixc.alertas_sombra, sem enviar) ate bater 100% com o WF 01; so depois assume.
CREATE TABLE IF NOT EXISTS ixc.alertas (
  id             serial PRIMARY KEY,
  chave          text UNIQUE,                      -- padrao.<nome> nas linhas que vieram com o bot; nulo nas criadas no painel
  nome           text NOT NULL,
  descricao      text,
  quando         text NOT NULL CHECK (quando IN ('aberto', 'transferido', 'assumido', 'sem_tecnico', 'segue_sem_tecnico', 'escalado', 'infra')),
  quando_min     integer CHECK (quando_min IS NULL OR quando_min BETWEEN 1 AND 10080),  -- sem tecnico ha X min, escalado com X min; nulo = parametro atual
  filtros        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {bases, shoppings, assuntos, assuntos_excluir, dias (1=seg..7=dom), hora_ini, hora_fim}; vazio = tudo
  destino        text NOT NULL CHECK (destino IN ('tecnico', 'grupo_shopping', 'numero', 'parametro')),
  destino_valor  text,                             -- numero (55 + DDD + numero) ou nome do parametro (ex.: infra_fone)
  marcar         text NOT NULL DEFAULT 'nenhum' CHECK (marcar IN ('nenhum', 'tecnico', 'marcar_sem_tec', 'marcar_escalar')),
  texto_chave    text REFERENCES ixc.mensagens(chave) ON UPDATE CASCADE ON DELETE SET NULL,  -- nulo = texto montado pelo bot
  repeticao      text NOT NULL DEFAULT 'uma_vez' CHECK (repeticao IN ('uma_vez', 'horarios', 'a_cada_min')),
  repeticao_valor text,                            -- 'HH:MM,HH:MM' ou minutos; nulo = parametro atual
  situacao       text NOT NULL DEFAULT 'teste' CHECK (situacao IN ('teste', 'ativo', 'pausado')),  -- teste = so para envio_teste_para
  padrao         boolean NOT NULL DEFAULT false,   -- veio com o bot: edita e pausa, nao exclui
  ordem          integer NOT NULL DEFAULT 0,
  criado_por     text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado     timestamptz,
  atualizado_por text,
  CHECK (destino NOT IN ('numero', 'parametro') OR coalesce(destino_valor, '') <> '')
);

-- O que o motor novo mandaria x o que o WF 01 mandou, por evento (whatsapp-ixc 0.7.0 grava; o painel so le).
CREATE TABLE IF NOT EXISTS ixc.alertas_sombra (
  id             bigserial PRIMARY KEY,
  ts             timestamptz NOT NULL DEFAULT now(),
  empresa        text,
  id_chamado     text,
  protocolo      text,
  quando         text,                             -- evento como em ixc.alertas.quando
  alerta_id      integer,                          -- alerta que casou (nulo = nenhum)
  destino_motor  text,                             -- chatId que o motor novo usaria (nulo = nao mandaria)
  destino_wf01   text,                             -- chatId que o WF 01 usou (nulo = ignorado)
  status_wf01    text,                             -- enviado / simulado / ignorado / falha
  bate           boolean,
  detalhe        text
);
CREATE INDEX IF NOT EXISTS alertas_sombra_ts ON ixc.alertas_sombra (ts DESC);

-- Avisos de hoje como linhas pre-cadastradas. Com aviso_privado = sim (producao desde a 0.6.0) saem no particular:
-- aberto, transferido e pedido de infra (ATIVOS). Os do modo grupo (aviso_privado = nao) nascem PAUSADOS.
-- ON CONFLICT DO NOTHING: rodar de novo nao desfaz o que foi editado no painel.
INSERT INTO ixc.alertas (chave, nome, descricao, quando, destino, destino_valor, marcar, texto_chave, repeticao, situacao, padrao, ordem, criado_por) VALUES
 ('padrao.aberto', 'Chamado aberto', 'Particular do técnico atribuído', 'aberto', 'tecnico', NULL, 'nenhum', 'aviso.novo', 'uma_vez', 'ativo', true, 10, 'bot (padrão)'),
 ('padrao.transferido', 'Chamado transferido', 'Particular do técnico que recebeu', 'transferido', 'tecnico', NULL, 'nenhum', 'aviso.transferido', 'uma_vez', 'ativo', true, 20, 'bot (padrão)'),
 ('padrao.infra', 'Pedido de infra', 'Particular do responsável pela infra (parâmetro infra_fone)', 'infra', 'parametro', 'infra_fone', 'nenhum', NULL, 'uma_vez', 'ativo', true, 30, 'bot (padrão)'),
 ('padrao.aberto_grupo', 'Chamado aberto (grupo)', 'Modo grupo: grupo do shopping marcando o técnico', 'aberto', 'grupo_shopping', NULL, 'tecnico', 'aviso.novo', 'uma_vez', 'pausado', true, 110, 'bot (padrão)'),
 ('padrao.transferido_grupo', 'Chamado transferido (grupo)', 'Modo grupo: grupo do shopping marcando o técnico', 'transferido', 'grupo_shopping', NULL, 'tecnico', 'aviso.transferido', 'uma_vez', 'pausado', true, 120, 'bot (padrão)'),
 ('padrao.assumido_grupo', 'Chamado assumido (grupo)', 'Modo grupo: grupo do shopping marcando o técnico', 'assumido', 'grupo_shopping', NULL, 'tecnico', 'aviso.assumido', 'uma_vez', 'pausado', true, 130, 'bot (padrão)'),
 ('padrao.sem_tecnico', 'Sem técnico', 'Modo grupo: chamado sem técnico há X min (parâmetro semtec_min)', 'sem_tecnico', 'grupo_shopping', NULL, 'marcar_sem_tec', 'aviso.sem_tecnico', 'uma_vez', 'pausado', true, 140, 'bot (padrão)'),
 ('padrao.segue_sem_tecnico', 'Segue sem técnico', 'Modo grupo: reaviso nos horários do parâmetro realerta_horarios', 'segue_sem_tecnico', 'grupo_shopping', NULL, 'marcar_sem_tec', 'aviso.segue_sem_tecnico', 'horarios', 'pausado', true, 150, 'bot (padrão)'),
 ('padrao.escalado', 'Escalado', 'Modo grupo: sem técnico há X min (parâmetro escalar_min), marca supervisão/coordenação', 'escalado', 'grupo_shopping', NULL, 'marcar_escalar', 'aviso.escalado', 'uma_vez', 'pausado', true, 160, 'bot (padrão)')
ON CONFLICT (chave) DO NOTHING;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'painel_glpi') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ixc.alertas TO painel_glpi;
    GRANT USAGE ON SEQUENCE ixc.alertas_id_seq TO painel_glpi;
    GRANT SELECT ON ixc.alertas_sombra TO painel_glpi;
  END IF;
END $$;

COMMIT;

-- conferência
SELECT grupo, count(*) AS mensagens, count(*) FILTER (WHERE texto IS NOT NULL) AS editadas, count(*) FILTER (WHERE NOT ativo) AS desativadas FROM ixc.mensagens GROUP BY grupo ORDER BY min(ordem);
SELECT alvo, count(*) AS perguntas, count(*) FILTER (WHERE NOT padrao) AS criadas_no_painel FROM ixc.perguntas GROUP BY alvo ORDER BY alvo;
SELECT count(*) AS apelidos, count(*) FILTER (WHERE NOT padrao) AS criados_no_painel FROM ixc.apelidos;
SELECT count(*) AS alteracoes_auditadas FROM ixc.painel_auditoria;
SELECT situacao, count(*) AS alertas, count(*) FILTER (WHERE padrao) AS padrao FROM ixc.alertas GROUP BY situacao ORDER BY situacao;
""")
open(sys.argv[2], 'w').write('\n'.join(L))
print(len(cat), 'mensagens', len(vistos), 'perguntas')
