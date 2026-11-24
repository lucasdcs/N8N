-- Desfaz o banco-sim.sql no banco de TESTE (pbot-pg-teste): volta base_url/auth das empresas e waha_url/envio.
\set ON_ERROR_STOP on
BEGIN;
UPDATE ixc.empresas e SET base_url = a.valor FROM ixc.sim_antes a WHERE a.tabela = 'empresas' AND a.coluna = 'base_url' AND a.chave = e.id;
UPDATE ixc.empresas e SET auth = a.valor FROM ixc.sim_antes a WHERE a.tabela = 'empresas' AND a.coluna = 'auth' AND a.chave = e.id;
UPDATE ixc.parametros p SET valor = a.valor FROM ixc.sim_antes a WHERE a.tabela = 'parametros' AND a.chave = p.chave;
DROP TABLE ixc.sim_antes;
COMMIT;
SELECT id, base_url FROM ixc.empresas ORDER BY id;
