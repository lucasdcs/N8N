-- Automacao IXC -> WhatsApp (WAHA): CONFIGURACAO (empresas/IXCs, shoppings e grupos, tecnicos, funcionarios,
-- parametros, escala base por shopping, contatos por setor, feriados). Rodar depois do 01:  psql -d <BANCO> -f 02_configuracao_atual.sql
-- Adaptado em 27/10/2026 a partir da configuracao de 05/10/2026 (Evolution API -> WAHA; sem Hermes).
--
-- ANTES DE RODAR, TROCAR:
--   'Basic __SEGREDO__'  -> em cada IXC (tabela empresas): base64 de "<id usuario API>:<token>"
--   waha_session                                   -> nome da sessao do WAHA (a mesma do lembrete diario)
--   grupo_automacao                                -> JID do grupo onde os comandos "ixc" e os avisos de sistema saem
-- A chave do WAHA NAO fica no banco: esta na credencial 'WAHA API' do n8n.
-- DEPOIS DE RODAR: atualizar empresas.last_evento_id para o maior id atual de su_oss_chamado_mensagem de cada IXC
--   (senao a automacao reenvia eventos antigos). Ver o README.
-- Log (eventos), comandos e escala do dia NAO vao aqui (sao gerados em funcionamento).

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: contatos_setor; Type: TABLE DATA; Schema: ixc; Owner: -
--

INSERT INTO ixc.contatos_setor (id, setor, ordem, nome, fone, seg, ter, qua, qui, sex, sab, dom, obs, ativo, escala) VALUES (1, 'rh', 1, 'Contato rh 1', '55__TELEFONE__', '08:00-18:00', '08:00-18:00', '08:00-18:00', '08:00-18:00', '08:00-18:00', NULL, NULL, NULL, true, NULL);
INSERT INTO ixc.contatos_setor (id, setor, ordem, nome, fone, seg, ter, qua, qui, sex, sab, dom, obs, ativo, escala) VALUES (2, 'financeiro', 1, 'Contato financeiro 1', '55__TELEFONE__', '07:45-12:00,13:30-18:00', '07:45-12:00,13:30-18:00', '07:45-12:00,13:30-18:00', '07:45-12:00,13:30-18:00', '07:45-12:00,13:30-18:00', NULL, NULL, 'Não repassar este número a clientes (pedido do Financeiro 25/09): para o cliente, informe o contato da holding. Fatura: mensagem rápida com o portal da holding.', true, NULL);
INSERT INTO ixc.contatos_setor (id, setor, ordem, nome, fone, seg, ter, qua, qui, sex, sab, dom, obs, ativo, escala) VALUES (3, 'compras', 1, 'Contato compras 1', '55__TELEFONE__', '07:42-18:00', '07:42-18:00', '07:42-18:00', '07:42-18:00', '07:42-18:00', NULL, NULL, NULL, true, NULL);
INSERT INTO ixc.contatos_setor (id, setor, ordem, nome, fone, seg, ter, qua, qui, sex, sab, dom, obs, ativo, escala) VALUES (4, 'compras', 2, 'Contato compras 2', '55__TELEFONE__', '07:40-18:00', '07:40-18:00', '07:40-18:00', '07:40-18:00', '07:40-18:00', NULL, NULL, NULL, true, NULL);
INSERT INTO ixc.contatos_setor (id, setor, ordem, nome, fone, seg, ter, qua, qui, sex, sab, dom, obs, ativo, escala) VALUES (6, 'n2', 1, 'Contato n2 1', '55__TELEFONE__', '08:00-17:00', '08:00-17:00', '08:00-17:00', '08:00-17:00', '08:00-17:00', NULL, NULL, NULL, true, NULL);
INSERT INTO ixc.contatos_setor (id, setor, ordem, nome, fone, seg, ter, qua, qui, sex, sab, dom, obs, ativo, escala) VALUES (7, 'n2', 2, 'Contato n2 2', '55__TELEFONE__', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', NULL, NULL, NULL, true, NULL);
INSERT INTO ixc.contatos_setor (id, setor, ordem, nome, fone, seg, ter, qua, qui, sex, sab, dom, obs, ativo, escala) VALUES (8, 'n2', 3, 'Contato n2 3', '55__TELEFONE__', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', NULL, NULL, NULL, true, NULL);
INSERT INTO ixc.contatos_setor (id, setor, ordem, nome, fone, seg, ter, qua, qui, sex, sab, dom, obs, ativo, escala) VALUES (9, 'n2', 4, 'Contato n2 4', '55__TELEFONE__', '10:00-17:29', '10:00-17:29', '10:00-17:29', '10:00-17:29', '10:00-17:29', '10:00-18:00', NULL, NULL, true, NULL);
INSERT INTO ixc.contatos_setor (id, setor, ordem, nome, fone, seg, ter, qua, qui, sex, sab, dom, obs, ativo, escala) VALUES (5, 'comercial', 1, 'Contato comercial 1', '55__TELEFONE__', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', 'Técnico: chame o Comercial pela plataforma *OPA* (internamente), transferindo o chat para o departamento *Comercial*. O Comercial não atende por WhatsApp.', true, NULL);
INSERT INTO ixc.contatos_setor (id, setor, ordem, nome, fone, seg, ter, qua, qui, sex, sab, dom, obs, ativo, escala) VALUES (10, 'n2', 5, 'Contato n2 5', '55__TELEFONE__', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, '4B:199');
INSERT INTO ixc.contatos_setor (id, setor, ordem, nome, fone, seg, ter, qua, qui, sex, sab, dom, obs, ativo, escala) VALUES (11, 'n2', 6, 'Contato n2 6', '55__TELEFONE__', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, '4B:199');


--
-- Data for Name: empresas; Type: TABLE DATA; Schema: ixc; Owner: -
--

INSERT INTO ixc.empresas (id, nome, base_url, auth, last_evento_id, dono_id, ignorar_assuntos, semtec_sem_local, ativo, atualizado, assuntos_financeiros) VALUES ('4B', '4B Telecom', 'https://ixc.4btelecom.com.br', 'Basic __SEGREDO__', 2348, '52', '{11,12,37,64,89,90,91,92,93,94}', true, true, '2026-10-04 06:12:19.083946-03', '{6,7,8,9,17,68,70,71}');
INSERT INTO ixc.empresas (id, nome, base_url, auth, last_evento_id, dono_id, ignorar_assuntos, semtec_sem_local, ativo, atualizado, assuntos_financeiros) VALUES ('BUZZ', 'Buzz Telecom', 'https://ixc.buzztelecom.com.br', 'Basic __SEGREDO__', 1010, '51', '{29,30,44,62,63,83,84,85,86,87,88}', false, true, '2026-10-03 14:58:27.879252-03', '{6,7,8,9,39,47,48,49,50,66,68,69}');
INSERT INTO ixc.empresas (id, nome, base_url, auth, last_evento_id, dono_id, ignorar_assuntos, semtec_sem_local, ativo, atualizado, assuntos_financeiros) VALUES ('PONTO', 'Ponto Telecom', 'https://ixc.pontotelecom.com', 'Basic __SEGREDO__', 1929, '60', '{29,3,30,61,62,63,64,65,66}', false, true, '2026-10-03 14:58:27.879252-03', '{6,7,8,9,34,36,37}');
INSERT INTO ixc.empresas (id, nome, base_url, auth, last_evento_id, dono_id, ignorar_assuntos, semtec_sem_local, ativo, atualizado, assuntos_financeiros) VALUES ('CACTA', 'Cacta Telecom', 'https://ixc.cactatelecom.com.br', 'Basic __SEGREDO__', 1939, '55', '{29,30,42,53,73,74,75,76,77,78}', false, true, '2026-10-04 14:21:18.697484-03', '{6,7,8,9,54,56,57}');


--
-- Data for Name: locais; Type: TABLE DATA; Schema: ixc; Owner: -
--

INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('4B', '199', 'Palladium Curitiba', '__GRUPO_TECNICOS__@g.us', NULL, '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('4B', '200', 'Shopping Ventura', '__GRUPO_TECNICOS__@g.us', NULL, '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('4B', '201', 'Catuaí Palladium Foz', '__GRUPO_TECNICOS__@g.us', NULL, '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('4B', '202', 'Palladium Umuarama', '__GRUPO_TECNICOS__@g.us', NULL, '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('4B', '243', 'Shopping Petrópolis', '__GRUPO_TECNICOS__@g.us', NULL, '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('4B', '244', 'Shopping City Center', '__GRUPO_TECNICOS__@g.us', NULL, '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('4B', '275', 'Shopping Cidade dos Lagos', '__GRUPO_TECNICOS__@g.us', NULL, '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('4B', '276', 'Shopping Pato Branco', '__GRUPO_TECNICOS__@g.us', NULL, '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('PONTO', '84', 'Pátio Chapecó', '__GRUPO_TECNICOS__@g.us', '20', '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('PONTO', '273', 'Pulse Open Mall', '__GRUPO_TECNICOS__@g.us', '61', '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('PONTO', '104', 'Itajaí Shopping', '__GRUPO_TECNICOS__@g.us', '59', '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('PONTO', '110', 'Riviera', '__GRUPO_TECNICOS__@g.us', '59', '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('PONTO', '159', 'Passo Fundo', '__GRUPO_TECNICOS__@g.us', '17', '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('PONTO', '216', 'Shopping Sinop', '__GRUPO_TECNICOS__@g.us', '37', '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('CACTA', '263', 'Jockey Plaza', '__GRUPO_TECNICOS__@g.us', '32', '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('CACTA', '260', 'Catuaí Cascavel', '__GRUPO_TECNICOS__@g.us', '31', '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('CACTA', '206', 'Shopping Pontal', '__GRUPO_TECNICOS__@g.us', '13', '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('CACTA', '247', 'Patteo Urupema Mogi das Cruzes', '__GRUPO_TECNICOS__@g.us', '6', '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('CACTA', '253', 'Park City Sumaré', '__GRUPO_TECNICOS__@g.us', '44', '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('CACTA', '248', 'Shopping Mogi Mirim', '__GRUPO_TECNICOS__@g.us', '35', '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('BUZZ', '269', 'Shopping Estação', '__GRUPO_TECNICOS__@g.us', '46', '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('BUZZ', '280', 'Plaza Campos Gerais', '__GRUPO_TECNICOS__@g.us', '42', '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('BUZZ', '271', 'Shopping Gravataí', '__GRUPO_TECNICOS__@g.us', '43', '{55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('PONTO', '144', 'IFashion Outlet Tijucas', '__GRUPO_TECNICOS__@g.us', '62', '{55__TELEFONE__,55__TELEFONE__}', '{55__TELEFONE__}');
INSERT INTO ixc.locais (empresa, id_condominio, nome, grupo, tec_padrao, marcar_sem_tec, marcar_escalar) VALUES ('PONTO', '134', 'Outlet Porto Belo', '__GRUPO_TECNICOS__@g.us', '62', '{55__TELEFONE__,55__TELEFONE__,55__TELEFONE__}', '{55__TELEFONE__}');


--
-- Data for Name: escala_base; Type: TABLE DATA; Schema: ixc; Owner: -
--

INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('4B', '199', '12x36', '__TECNICOS__', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', 'revezam 12x36');
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('4B', '201', '12x36', '__TECNICOS__', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', 'revezam 12x36');
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('CACTA', '263', '12x36', '__TECNICOS__', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', 'revezam 12x36');
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('CACTA', '260', '12x36', '__TECNICOS__', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', 'revezam 12x36');
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('4B', '202', 'fixo', '__TECNICOS__', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-17:30', NULL, NULL);
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('4B', '276', 'fixo', '__TECNICOS__', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-17:30', NULL, NULL);
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('4B', '243', 'fixo', '__TECNICOS__', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-17:30', NULL, NULL);
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('4B', '244', 'fixo', '__TECNICOS__', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-17:30', NULL, NULL);
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('4B', '200', 'fixo', '__TECNICOS__', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', NULL, NULL, 'não trabalha sábado');
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('BUZZ', '269', 'fixo', NULL, '08:00-17:00', '08:00-17:00', '08:00-17:00', '08:00-17:00', '08:00-17:00', '08:00-13:00', NULL, NULL);
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('BUZZ', '271', 'fixo', NULL, '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-17:30', NULL, NULL);
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('BUZZ', '280', 'fixo', NULL, '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-17:30', NULL, NULL);
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('CACTA', '206', 'fixo', NULL, '08:00-18:00', '08:00-18:00', '08:00-18:00', '08:00-18:00', '08:00-18:00', NULL, NULL, NULL);
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('CACTA', '253', 'fixo', NULL, '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-17:30', NULL, NULL);
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('CACTA', '247', 'fixo', NULL, '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', NULL, NULL, NULL);
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('CACTA', '248', 'fixo', NULL, '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', NULL, NULL, NULL);
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('PONTO', '84', 'fixo', NULL, '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-17:30', NULL, NULL);
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('PONTO', '273', 'fixo', NULL, NULL, '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-17:30', NULL, 'escala diferenciada: terça a sábado');
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('PONTO', '104', 'fixo', NULL, '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-17:30', NULL, NULL);
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('PONTO', '110', 'fixo', NULL, '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-17:30', NULL, 'atendido pelo __NOME__ (Itajaí) com deslocamento se necessário');
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('PONTO', '159', 'fixo', NULL, '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-17:30', NULL, NULL);
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('PONTO', '216', 'fixo', NULL, '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-17:30', NULL, '__NOME__ Miranda — horários acima em Brasília; em Sinop (MT) é 1h a menos: seg–sex 09h–17h30, sáb 09h–16h30');
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('4B', '275', 'fixo', '__TECNICOS__', '11:00-19:00', '11:00-19:00', '11:00-19:00', '11:00-19:00', '11:00-19:00', '11:00-19:00', NULL, NULL);
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('PONTO', '134', 'escala', '__TECNICOS__', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', 'revezam __NOME__ e __NOME__ __NOME__ entre Porto Belo e Tijucas — escala do dia na planilha ESCALAS');
INSERT INTO ixc.escala_base (empresa, id_condominio, tipo, tecnicos, seg, ter, qua, qui, sex, sab, dom, obs) VALUES ('PONTO', '144', 'escala', '__TECNICOS__', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', '10:00-18:30', 'revezam __NOME__ e __NOME__ __NOME__ entre Porto Belo e Tijucas — escala do dia na planilha ESCALAS');


--
-- Data for Name: feriados; Type: TABLE DATA; Schema: ixc; Owner: -
--

INSERT INTO ixc.feriados (id, data, empresa, id_condominio, descricao, criado) VALUES (2, '2026-10-12', NULL, NULL, 'Nossa Senhora Aparecida', '2026-09-27 21:14:17.16138-03');
INSERT INTO ixc.feriados (id, data, empresa, id_condominio, descricao, criado) VALUES (3, '2026-11-02', NULL, NULL, 'Finados', '2026-09-27 21:14:17.16138-03');
INSERT INTO ixc.feriados (id, data, empresa, id_condominio, descricao, criado) VALUES (4, '2026-11-15', NULL, NULL, 'Proclamação da República', '2026-09-27 21:14:17.16138-03');
INSERT INTO ixc.feriados (id, data, empresa, id_condominio, descricao, criado) VALUES (5, '2026-11-20', NULL, NULL, 'Consciência Negra', '2026-09-27 21:14:17.16138-03');
INSERT INTO ixc.feriados (id, data, empresa, id_condominio, descricao, criado) VALUES (6, '2026-12-25', NULL, NULL, 'Natal', '2026-09-27 21:14:17.16138-03');
INSERT INTO ixc.feriados (id, data, empresa, id_condominio, descricao, criado) VALUES (7, '2027-01-01', NULL, NULL, 'Confraternização Universal', '2026-09-27 21:14:17.16138-03');
INSERT INTO ixc.feriados (id, data, empresa, id_condominio, descricao, criado) VALUES (8, '2027-03-26', NULL, NULL, 'Sexta-feira Santa', '2026-09-27 21:14:17.16138-03');
INSERT INTO ixc.feriados (id, data, empresa, id_condominio, descricao, criado) VALUES (9, '2027-04-21', NULL, NULL, 'Tiradentes', '2026-09-27 21:14:17.16138-03');
INSERT INTO ixc.feriados (id, data, empresa, id_condominio, descricao, criado) VALUES (10, '2027-05-01', NULL, NULL, 'Dia do Trabalho', '2026-09-27 21:14:17.16138-03');
INSERT INTO ixc.feriados (id, data, empresa, id_condominio, descricao, criado) VALUES (11, '2027-09-07', NULL, NULL, 'Independência', '2026-09-27 21:14:17.16138-03');
INSERT INTO ixc.feriados (id, data, empresa, id_condominio, descricao, criado) VALUES (12, '2027-10-12', NULL, NULL, 'Nossa Senhora Aparecida', '2026-09-27 21:14:17.16138-03');
INSERT INTO ixc.feriados (id, data, empresa, id_condominio, descricao, criado) VALUES (13, '2027-11-02', NULL, NULL, 'Finados', '2026-09-27 21:14:17.16138-03');
INSERT INTO ixc.feriados (id, data, empresa, id_condominio, descricao, criado) VALUES (14, '2027-11-15', NULL, NULL, 'Proclamação da República', '2026-09-27 21:14:17.16138-03');
INSERT INTO ixc.feriados (id, data, empresa, id_condominio, descricao, criado) VALUES (15, '2027-11-20', NULL, NULL, 'Consciência Negra', '2026-09-27 21:14:17.16138-03');
INSERT INTO ixc.feriados (id, data, empresa, id_condominio, descricao, criado) VALUES (16, '2027-12-25', NULL, NULL, 'Natal', '2026-09-27 21:14:17.16138-03');


--
-- Data for Name: funcionarios; Type: TABLE DATA; Schema: ixc; Owner: -
--

INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '61', 'Funcionario 4B-61');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '60', 'Funcionario 4B-60');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '59', 'Funcionario 4B-59');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '58', 'Funcionario 4B-58');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '57', 'Funcionario 4B-57');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '56', 'Funcionario 4B-56');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '55', 'Funcionario 4B-55');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '54', 'Funcionario 4B-54');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '53', 'Funcionario 4B-53');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '52', 'Funcionario 4B-52');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '51', 'Funcionario 4B-51');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '50', 'Funcionario 4B-50');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '49', 'Funcionario 4B-49');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '48', 'Funcionario 4B-48');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '47', 'Funcionario 4B-47');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '46', 'Funcionario 4B-46');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '45', 'Funcionario 4B-45');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '44', 'Funcionario 4B-44');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '43', 'Funcionario 4B-43');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '42', 'Funcionario 4B-42');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '41', 'Funcionario 4B-41');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '40', 'Funcionario 4B-40');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '39', 'Funcionario 4B-39');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '38', 'Funcionario 4B-38');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '37', 'Funcionario 4B-37');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '36', 'Funcionario 4B-36');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '35', 'Funcionario 4B-35');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '34', 'Funcionario 4B-34');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '33', 'Funcionario 4B-33');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '32', 'Funcionario 4B-32');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '31', 'Funcionario 4B-31');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '30', 'Funcionario 4B-30');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '29', 'Funcionario 4B-29');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '28', 'Funcionario 4B-28');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '27', 'Funcionario 4B-27');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '26', 'Funcionario 4B-26');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '25', 'Funcionario 4B-25');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '24', 'Funcionario 4B-24');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '23', 'Funcionario 4B-23');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '22', 'Funcionario 4B-22');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '21', 'Funcionario 4B-21');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '20', 'Funcionario 4B-20');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '19', 'Funcionario 4B-19');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '18', 'Funcionario 4B-18');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '17', 'Funcionario 4B-17');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '16', 'Funcionario 4B-16');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '15', 'Funcionario 4B-15');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '14', 'Funcionario 4B-14');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '13', 'Funcionario 4B-13');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '12', 'Funcionario 4B-12');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '11', 'Funcionario 4B-11');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '8', 'Funcionario 4B-8');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '7', 'Funcionario 4B-7');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '6', 'Funcionario 4B-6');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '5', 'Funcionario 4B-5');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '3', 'Funcionario 4B-3');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '2', 'Funcionario 4B-2');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('4B', '1', 'Funcionario 4B-1');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '66', 'Funcionario PONTO-66');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '65', 'Funcionario PONTO-65');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '64', 'Funcionario PONTO-64');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '63', 'Funcionario PONTO-63');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '62', 'Funcionario PONTO-62');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '61', 'Funcionario PONTO-61');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '60', 'Funcionario PONTO-60');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '59', 'Funcionario PONTO-59');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '58', 'Funcionario PONTO-58');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '57', 'Funcionario PONTO-57');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '56', 'Funcionario PONTO-56');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '55', 'Funcionario PONTO-55');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '54', 'Funcionario PONTO-54');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '53', 'Funcionario PONTO-53');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '52', 'Funcionario PONTO-52');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '51', 'Funcionario PONTO-51');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '50', 'Funcionario PONTO-50');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '49', 'Funcionario PONTO-49');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '48', 'Funcionario PONTO-48');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '47', 'Funcionario PONTO-47');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '46', 'Funcionario PONTO-46');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '45', 'Funcionario PONTO-45');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '44', 'Funcionario PONTO-44');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '43', 'Funcionario PONTO-43');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '42', 'Funcionario PONTO-42');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '41', 'Funcionario PONTO-41');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '40', 'Funcionario PONTO-40');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '39', 'Funcionario PONTO-39');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '38', 'Funcionario PONTO-38');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '37', 'Funcionario PONTO-37');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '36', 'Funcionario PONTO-36');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '35', 'Funcionario PONTO-35');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '34', 'Funcionario PONTO-34');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '33', 'Funcionario PONTO-33');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '32', 'Funcionario PONTO-32');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '31', 'Funcionario PONTO-31');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '30', 'Funcionario PONTO-30');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '29', 'Funcionario PONTO-29');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '28', 'Funcionario PONTO-28');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '27', 'Funcionario PONTO-27');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '26', 'Funcionario PONTO-26');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '25', 'Funcionario PONTO-25');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '24', 'Funcionario PONTO-24');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '23', 'Funcionario PONTO-23');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '22', 'Funcionario PONTO-22');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '21', 'Funcionario PONTO-21');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '20', 'Funcionario PONTO-20');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '19', 'Funcionario PONTO-19');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '18', 'Funcionario PONTO-18');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '17', 'Funcionario PONTO-17');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '16', 'Funcionario PONTO-16');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '15', 'Funcionario PONTO-15');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '14', 'Funcionario PONTO-14');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '13', 'Funcionario PONTO-13');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '11', 'Funcionario PONTO-11');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '8', 'Funcionario PONTO-8');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '7', 'Funcionario PONTO-7');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '5', 'Funcionario PONTO-5');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '3', 'Funcionario PONTO-3');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '2', 'Funcionario PONTO-2');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('PONTO', '1', 'Funcionario PONTO-1');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '63', 'Funcionario CACTA-63');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '62', 'Funcionario CACTA-62');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '61', 'Funcionario CACTA-61');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '60', 'Funcionario CACTA-60');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '59', 'Funcionario CACTA-59');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '58', 'Funcionario CACTA-58');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '56', 'Funcionario CACTA-56');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '55', 'Funcionario CACTA-55');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '54', 'Funcionario CACTA-54');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '53', 'Funcionario CACTA-53');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '52', 'Funcionario CACTA-52');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '51', 'Funcionario CACTA-51');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '50', 'Funcionario CACTA-50');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '49', 'Funcionario CACTA-49');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '48', 'Funcionario CACTA-48');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '47', 'Funcionario CACTA-47');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '46', 'Funcionario CACTA-46');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '45', 'Funcionario CACTA-45');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '44', 'Funcionario CACTA-44');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '43', 'Funcionario CACTA-43');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '42', 'Funcionario CACTA-42');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '41', 'Funcionario CACTA-41');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '40', 'Funcionario CACTA-40');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '39', 'Funcionario CACTA-39');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '38', 'Funcionario CACTA-38');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '37', 'Funcionario CACTA-37');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '36', 'Funcionario CACTA-36');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '35', 'Funcionario CACTA-35');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '34', 'Funcionario CACTA-34');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '33', 'Funcionario CACTA-33');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '32', 'Funcionario CACTA-32');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '31', 'Funcionario CACTA-31');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '30', 'Funcionario CACTA-30');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '29', 'Funcionario CACTA-29');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '28', 'Funcionario CACTA-28');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '27', 'Funcionario CACTA-27');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '26', 'Funcionario CACTA-26');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '25', 'Funcionario CACTA-25');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '24', 'Funcionario CACTA-24');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '23', 'Funcionario CACTA-23');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '22', 'Funcionario CACTA-22');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '21', 'Funcionario CACTA-21');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '20', 'Funcionario CACTA-20');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '19', 'Funcionario CACTA-19');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '18', 'Funcionario CACTA-18');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '17', 'Funcionario CACTA-17');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '16', 'Funcionario CACTA-16');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '15', 'Funcionario CACTA-15');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '14', 'Funcionario CACTA-14');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '13', 'Funcionario CACTA-13');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '12', 'Funcionario CACTA-12');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '11', 'Funcionario CACTA-11');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '8', 'Funcionario CACTA-8');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '7', 'Funcionario CACTA-7');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '6', 'Funcionario CACTA-6');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '5', 'Funcionario CACTA-5');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '4', 'Funcionario CACTA-4');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '3', 'Funcionario CACTA-3');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '2', 'Funcionario CACTA-2');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('CACTA', '1', 'Funcionario CACTA-1');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '65', 'Funcionario BUZZ-65');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '64', 'Funcionario BUZZ-64');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '63', 'Funcionario BUZZ-63');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '62', 'Funcionario BUZZ-62');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '61', 'Funcionario BUZZ-61');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '60', 'Funcionario BUZZ-60');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '59', 'Funcionario BUZZ-59');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '58', 'Funcionario BUZZ-58');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '56', 'Funcionario BUZZ-56');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '55', 'Funcionario BUZZ-55');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '54', 'Funcionario BUZZ-54');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '53', 'Funcionario BUZZ-53');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '52', 'Funcionario BUZZ-52');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '51', 'Funcionario BUZZ-51');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '50', 'Funcionario BUZZ-50');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '49', 'Funcionario BUZZ-49');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '48', 'Funcionario BUZZ-48');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '47', 'Funcionario BUZZ-47');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '46', 'Funcionario BUZZ-46');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '45', 'Funcionario BUZZ-45');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '44', 'Funcionario BUZZ-44');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '43', 'Funcionario BUZZ-43');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '42', 'Funcionario BUZZ-42');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '41', 'Funcionario BUZZ-41');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '40', 'Funcionario BUZZ-40');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '39', 'Funcionario BUZZ-39');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '38', 'Funcionario BUZZ-38');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '37', 'Funcionario BUZZ-37');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '36', 'Funcionario BUZZ-36');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '35', 'Funcionario BUZZ-35');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '33', 'Funcionario BUZZ-33');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '32', 'Funcionario BUZZ-32');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '31', 'Funcionario BUZZ-31');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '30', 'Funcionario BUZZ-30');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '29', 'Funcionario BUZZ-29');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '28', 'Funcionario BUZZ-28');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '27', 'Funcionario BUZZ-27');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '26', 'Funcionario BUZZ-26');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '25', 'Funcionario BUZZ-25');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '24', 'Funcionario BUZZ-24');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '23', 'Funcionario BUZZ-23');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '22', 'Funcionario BUZZ-22');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '21', 'Funcionario BUZZ-21');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '20', 'Funcionario BUZZ-20');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '19', 'Funcionario BUZZ-19');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '18', 'Funcionario BUZZ-18');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '17', 'Funcionario BUZZ-17');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '16', 'Funcionario BUZZ-16');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '15', 'Funcionario BUZZ-15');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '14', 'Funcionario BUZZ-14');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '13', 'Funcionario BUZZ-13');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '12', 'Funcionario BUZZ-12');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '11', 'Funcionario BUZZ-11');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '8', 'Funcionario BUZZ-8');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '7', 'Funcionario BUZZ-7');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '6', 'Funcionario BUZZ-6');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '5', 'Funcionario BUZZ-5');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '4', 'Funcionario BUZZ-4');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '3', 'Funcionario BUZZ-3');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '2', 'Funcionario BUZZ-2');
INSERT INTO ixc.funcionarios (empresa, id_func, nome) VALUES ('BUZZ', '1', 'Funcionario BUZZ-1');


--
-- Data for Name: parametros; Type: TABLE DATA; Schema: ixc; Owner: -
--

INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('supervisor_fone', '55__TELEFONE__', '__NOME_SUPERVISOR__ - marcado em chamado sem responsavel (onde e membro do grupo)');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('coordenador_fone', '55__TELEFONE__', '__NOME_COORDENADOR__ - marcado no escalonamento');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('grupo_dono', '__GRUPO_AUTOMACAO__@g.us', 'Grupo do dono do numero (chamados atribuidos a ele)');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('dono_nome', '__NOME_DONO__', 'Nome exibido nos chamados do dono do numero');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('semtec_min', '10', 'Minutos sem ninguem atribuido ate o 1o aviso');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('realerta_min', '120', 'Intervalo do re-alerta (min)');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('realerta_ini', '10', 'Re-alerta so a partir desta hora');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('realerta_fim', '22', 'Re-alerta so ate esta hora');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('escalar_min', '240', 'Minutos sem responsavel ate marcar tambem a coordenacao');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('falha_max_tentativas', '5', 'Reenvios de mensagem que falhou');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('feriados_ativo', 'nao', 'sim = feriados de ixc.feriados param o re-alerta (igual domingo); nao = ignora a tabela');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('realerta_horarios', '11:00,15:30', 'Re-alerta so nestes horarios (HH:MM,...); vazio = a cada realerta_min');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('grupo_sem_local', '__GRUPO_TECNICOS__@g.us', 'Resolutto Tecnicos: chamado sem responsavel e sem shopping (so empresas com semtec_sem_local)');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('escala_grupos', '__GRUPO_AUTOMACAO__@g.us,__GRUPO_N1N2__@g.us,__GRUPO_TECNICOS__@g.us,__GRUPO_RECADOS__@g.us', 'Grupos (JID, separados por virgula) onde "quem esta no <shopping>" responde sozinho. N1/N2 - RESOLUTTO = __GRUPO_N1N2__@g.us');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('setores_grupo', '__GRUPO_RECADOS__@g.us', NULL);
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('waha_url', 'http://waha:3000', 'Endereco do WAHA visto pelo n8n (mesma rede Docker)');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('waha_session', 'session_01m4xy9khpbqgnafzqhd9wchx1', 'Sessao do WAHA pareada com o numero remetente');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('grupo_automacao', '__GRUPO_AUTOMACAO__@g.us', 'Grupo (JID) dos comandos ixc e dos avisos do sistema');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('supervisor_nome', '__NOME_SUPERVISOR__', 'Nome exibido para supervisor_fone');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('coordenador_nome', '__NOME_COORDENADOR__', 'Nome exibido para coordenador_fone');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('planta_ativo', 'nao', 'sim = manda o recorte da planta (servico planta-loja no ar); nao = so texto');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('envio', 'NENHUM', 'Modo dos workflows 01/02: NENHUM (so avanca o estado, nao manda), SIMULAR (manda tudo para envio_teste_para) ou REAL');
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES ('envio_teste_para', '55__TELEFONE__', 'Numero que recebe as mensagens no modo SIMULAR');


--
-- Data for Name: tecnicos; Type: TABLE DATA; Schema: ixc; Owner: -
--

INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('4B', '45', 'Tecnico 4B-45', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('4B', '48', 'Tecnico 4B-48', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('4B', '18', 'Tecnico 4B-18', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('4B', '25', 'Tecnico 4B-25', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('4B', '47', 'Tecnico 4B-47', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('4B', '41', 'Tecnico 4B-41', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('4B', '22', 'Tecnico 4B-22', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('4B', '46', 'Tecnico 4B-46', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('4B', '12', 'Tecnico 4B-12', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('4B', '16', 'Tecnico 4B-16', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('PONTO', '21', 'Tecnico PONTO-21', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('PONTO', '20', 'Tecnico PONTO-20', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('PONTO', '61', 'Tecnico PONTO-61', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('PONTO', '59', 'Tecnico PONTO-59', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('PONTO', '17', 'Tecnico PONTO-17', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('PONTO', '37', 'Tecnico PONTO-37', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('CACTA', '32', 'Tecnico CACTA-32', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('CACTA', '46', 'Tecnico CACTA-46', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('CACTA', '31', 'Tecnico CACTA-31', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('CACTA', '38', 'Tecnico CACTA-38', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('CACTA', '13', 'Tecnico CACTA-13', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('CACTA', '6', 'Tecnico CACTA-6', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('CACTA', '44', 'Tecnico CACTA-44', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('CACTA', '35', 'Tecnico CACTA-35', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('BUZZ', '46', 'Tecnico BUZZ-46', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('BUZZ', '42', 'Tecnico BUZZ-42', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('BUZZ', '43', 'Tecnico BUZZ-43', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');
INSERT INTO ixc.tecnicos (empresa, id_func, nome, fone, grupo) VALUES ('PONTO', '62', 'Tecnico PONTO-62', '55__TELEFONE__', '__GRUPO_TECNICOS__@g.us');


--
-- Name: contatos_setor_id_seq; Type: SEQUENCE SET; Schema: ixc; Owner: -
--

SELECT pg_catalog.setval('ixc.contatos_setor_id_seq', 11, true);


--
-- Name: feriados_id_seq; Type: SEQUENCE SET; Schema: ixc; Owner: -
--

SELECT pg_catalog.setval('ixc.feriados_id_seq', 16, true);


--
-- PostgreSQL database dump complete
--


