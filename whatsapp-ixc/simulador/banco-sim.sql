-- Simulador do whatsapp-ixc: aponta o banco de TESTE (container pbot-pg-teste) para o simulador.
-- NUNCA rodar no postgres-ixc da produção. Idempotente. Os valores de antes ficam em ixc.sim_antes (o remover.sh devolve).
-- Os workflows [SIM] já usam o simulador com endereço fixo; isto deixa o banco coerente (tela do painel, envio REAL).
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE IF NOT EXISTS ixc.sim_antes (tabela text NOT NULL, chave text NOT NULL, coluna text NOT NULL, valor text, PRIMARY KEY (tabela, chave, coluna));
INSERT INTO ixc.sim_antes SELECT 'empresas', id, 'base_url', base_url FROM ixc.empresas ON CONFLICT DO NOTHING;
INSERT INTO ixc.sim_antes SELECT 'empresas', id, 'auth', auth FROM ixc.empresas ON CONFLICT DO NOTHING;
INSERT INTO ixc.sim_antes SELECT 'parametros', chave, 'valor', valor FROM ixc.parametros WHERE chave IN ('waha_url', 'envio') ON CONFLICT DO NOTHING;

UPDATE ixc.empresas SET base_url = 'http://ixc-simulador:3999/ixc/' || id, auth = 'Basic c2ltdWxhZG9y';   -- "simulador": nenhum token real
UPDATE ixc.parametros SET valor = 'http://ixc-simulador:3999' WHERE chave = 'waha_url';
UPDATE ixc.parametros SET valor = 'REAL' WHERE chave = 'envio';   -- REAL aqui = manda para os grupos do SIMULADOR
COMMIT;

SELECT (SELECT count(*) FROM ixc.empresas WHERE base_url LIKE 'http://ixc-simulador:3999/%') AS empresas_no_simulador,
       (SELECT count(*) FROM ixc.empresas WHERE base_url NOT LIKE 'http://ixc-simulador:3999/%') AS empresas_fora,
       (SELECT valor FROM ixc.parametros WHERE chave = 'envio') AS envio,
       (SELECT valor FROM ixc.parametros WHERE chave = 'waha_url') AS waha_url;
