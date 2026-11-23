-- Painel do Bot 0.1.0 — usuário do Postgres do bot (schema ixc) usado pelo GLPI.
-- Só leitura nesta versão, e SEM acesso à coluna ixc.empresas.auth (tokens do IXC).
-- Rodar como o dono do banco (usuário ixc), DEPOIS do 01-mensagens-perguntas.sql, trocando a senha:
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
                ixc.mensagens, ixc.mensagens_hist, ixc.perguntas TO painel_glpi;
-- empresas: todas as colunas MENOS auth (token do IXC)
GRANT SELECT (id, nome, base_url, last_evento_id, dono_id, ignorar_assuntos, semtec_sem_local, ativo, atualizado, assuntos_financeiros)
  ON ixc.empresas TO painel_glpi;

-- conferência: le_mensagens = t, altera_mensagens = f, le_tokens = f
SELECT has_table_privilege('painel_glpi', 'ixc.mensagens', 'SELECT') AS le_mensagens,
       has_table_privilege('painel_glpi', 'ixc.mensagens', 'UPDATE') AS altera_mensagens,
       has_column_privilege('painel_glpi', 'ixc.empresas', 'auth', 'SELECT') AS le_tokens;
