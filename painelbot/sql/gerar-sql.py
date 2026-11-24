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
L.append("""-- Painel do Bot 0.4.0 — tabelas de MENSAGENS, PERGUNTAS e APELIDOS do bot (schema ixc, Postgres do whatsapp-ixc).
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

COMMIT;

-- conferência
SELECT grupo, count(*) AS mensagens, count(*) FILTER (WHERE texto IS NOT NULL) AS editadas, count(*) FILTER (WHERE NOT ativo) AS desativadas FROM ixc.mensagens GROUP BY grupo ORDER BY min(ordem);
SELECT alvo, count(*) AS perguntas, count(*) FILTER (WHERE NOT padrao) AS criadas_no_painel FROM ixc.perguntas GROUP BY alvo ORDER BY alvo;
SELECT count(*) AS apelidos, count(*) FILTER (WHERE NOT padrao) AS criados_no_painel FROM ixc.apelidos;
""")
open(sys.argv[2], 'w').write('\n'.join(L))
print(len(cat), 'mensagens', len(vistos), 'perguntas')
