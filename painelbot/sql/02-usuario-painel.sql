-- Painel do Bot 0.3.0 — usuário do Postgres do bot (schema ixc) usado pelo GLPI.
-- Lê o schema (SEM a coluna ixc.empresas.auth, tokens do IXC). Grava: texto das mensagens (+ histórico), perguntas,
-- apelidos e, desde a 0.3.0, os cadastros (shoppings, escala base, técnicos, contatos de setor).
-- Não altera empresas/tokens, parâmetros, eventos, escala do dia (planilha) nem o texto padrão das mensagens.
-- Rodar como o dono do banco (usuário ixc), DEPOIS do 01-mensagens-perguntas.sql, trocando a senha (pode ser a mesma):
--   docker exec -i n8n-compose-postgres-ixc-1 psql -U ixc -d ixc -v ON_ERROR_STOP=1 -v senha="'SENHA_FORTE'" < 02-usuario-painel.sql
-- Pode rodar de novo: recria as permissões e troca a senha. (Mesmo usuário da P15-1 descartada, se já existir.)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'painel_glpi') THEN
    CREATE ROLE painel_glpi LOGIN;
  END IF;
END $$;
ALTER ROLE painel_glpi LOGIN PASSWORD :senha;

GRANT CONNECT ON DATABASE ixc TO painel_glpi;
GRANT USAGE ON SCHEMA ixc TO painel_glpi;
REVOKE ALL ON ALL TABLES IN SCHEMA ixc FROM painel_glpi;
GRANT SELECT ON ixc.parametros, ixc.locais, ixc.tecnicos, ixc.escala_base, ixc.escala_dia,
                ixc.contatos_setor, ixc.feriados, ixc.eventos, ixc.funcionarios,
                ixc.mensagens, ixc.mensagens_hist, ixc.perguntas, ixc.apelidos TO painel_glpi;
-- empresas: todas as colunas MENOS auth (token do IXC)
GRANT SELECT (id, nome, base_url, last_evento_id, dono_id, ignorar_assuntos, semtec_sem_local, ativo, atualizado, assuntos_financeiros)
  ON ixc.empresas TO painel_glpi;

-- 0.2.0: edição pelo painel
GRANT UPDATE (texto, atualizado, atualizado_por) ON ixc.mensagens TO painel_glpi;
GRANT INSERT ON ixc.mensagens_hist TO painel_glpi;
GRANT INSERT, DELETE ON ixc.perguntas TO painel_glpi;
GRANT UPDATE (frase, frase_norm, grupos, ativo, atualizado, atualizado_por) ON ixc.perguntas TO painel_glpi;
GRANT UPDATE (excluida) ON ixc.perguntas TO painel_glpi;
GRANT USAGE ON SEQUENCE ixc.mensagens_hist_id_seq, ixc.perguntas_id_seq TO painel_glpi;
-- 0.3.0: cadastros e apelidos
GRANT INSERT, UPDATE, DELETE ON ixc.locais, ixc.escala_base, ixc.tecnicos, ixc.contatos_setor, ixc.apelidos TO painel_glpi;
GRANT USAGE ON SEQUENCE ixc.contatos_setor_id_seq, ixc.apelidos_id_seq TO painel_glpi;

-- conferência: t | t | f | t | f | f
SELECT has_table_privilege('painel_glpi', 'ixc.mensagens', 'SELECT') AS le_mensagens,
       has_column_privilege('painel_glpi', 'ixc.mensagens', 'texto', 'UPDATE') AS edita_texto,
       has_column_privilege('painel_glpi', 'ixc.mensagens', 'texto_padrao', 'UPDATE') AS muda_padrao,
       has_table_privilege('painel_glpi', 'ixc.locais', 'UPDATE') AS edita_shoppings,
       has_table_privilege('painel_glpi', 'ixc.parametros', 'UPDATE') AS muda_parametros,
       has_column_privilege('painel_glpi', 'ixc.empresas', 'auth', 'SELECT') AS le_tokens;
