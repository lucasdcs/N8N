-- Automacao IXC -> WhatsApp: ESTRUTURA do schema ixc (tabelas, indices, funcoes dos comandos "ixc").
-- Rodar 1o, no banco que o n8n acessa (credencial Postgres do n8n):  psql -d <BANCO> -f 01_estrutura_schema_ixc.sql
-- Nao contem dados.

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
-- Name: ixc; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA ixc;


--
-- Name: aplicar_comando(text); Type: FUNCTION; Schema: ixc; Owner: -
--

CREATE FUNCTION ixc.aplicar_comando(p_autor text) RETURNS text
    LANGUAGE plpgsql
    AS $$
declare
  r ixc.comandos; a jsonb; v_emp text; v_cond text; v_fone text; n int := 0; tecfones text[];
begin
  select * into r from ixc.comandos where status = 'pendente' order by id desc limit 1;
  if not found then return 'Nenhuma alteração pendente pra aplicar.'; end if;
  if r.ts < now() - interval '15 minutes' then
    update ixc.comandos set status = 'expirado' where id = r.id;
    return '⌛ A alteração pendente expirou (mais de 15 min). Mande o comando de novo.';
  end if;
  a := r.acao; v_emp := a->>'empresa'; v_cond := a->>'id_condominio'; v_fone := a->>'fone';
  case a->>'acao'
  when 'numero' then
    update ixc.locais l set marcar_sem_tec = array_replace(l.marcar_sem_tec, a->>'fone_antigo', v_fone),
                            marcar_escalar = array_replace(l.marcar_escalar, a->>'fone_antigo', v_fone)
      where l.empresa = v_emp and a->>'fone_antigo' is not null;
    update ixc.tecnicos t set fone = v_fone where t.empresa = v_emp and t.id_func = a->>'id_func';
    get diagnostics n = row_count;
  when 'shopping_tecnico' then
    select array_agg(t.fone) into tecfones from ixc.tecnicos t where t.empresa = v_emp and t.fone is not null and t.id_func <> a->>'id_func';
    update ixc.locais l set tec_padrao = a->>'id_func',
      marcar_sem_tec = array_prepend(v_fone, array_remove(
        array(select x from unnest(l.marcar_sem_tec) x where not (x = any(coalesce(tecfones, '{}')))), v_fone))
      where l.empresa = v_emp and l.id_condominio = v_cond;
    get diagnostics n = row_count;
  when 'incluir' then
    update ixc.locais l set marcar_sem_tec = array_append(array_remove(l.marcar_sem_tec, v_fone), v_fone)
      where l.empresa = v_emp and l.id_condominio = v_cond;
    get diagnostics n = row_count;
  when 'remover' then
    update ixc.locais l set marcar_sem_tec = array_remove(l.marcar_sem_tec, v_fone)
      where l.empresa = v_emp and l.id_condominio = v_cond and v_fone = any(l.marcar_sem_tec);
    get diagnostics n = row_count;
  when 'novo_tecnico' then
    insert into ixc.tecnicos (empresa, id_func, nome, fone, grupo) values (v_emp, a->>'id_func', a->>'nome', v_fone, a->>'grupo')
      on conflict (empresa, id_func) do update set nome = excluded.nome, fone = excluded.fone;
    get diagnostics n = row_count;
  when 'feriado_add' then
    insert into ixc.feriados (data, empresa, id_condominio, descricao)
      values ((a->>'data')::date, v_emp, v_cond, a->>'descricao') on conflict do nothing;
    get diagnostics n = row_count;
  when 'feriado_del' then
    delete from ixc.feriados f where f.data = (a->>'data')::date and coalesce(f.empresa,'') = coalesce(v_emp,'') and coalesce(f.id_condominio,'') = coalesce(v_cond,'');
    get diagnostics n = row_count;
  else
    update ixc.comandos set status = 'erro', resultado = 'ação desconhecida' where id = r.id;
    return '❌ Ação desconhecida.';
  end case;
  if n = 0 then
    update ixc.comandos set status = 'erro', resultado = 'nada alterado' where id = r.id;
    return '⚠️ Nada foi alterado (não encontrado ou já estava assim): ' || r.resumo;
  end if;
  update ixc.comandos set status = 'aplicado', aplicado_em = now(), resultado = coalesce(p_autor, '') || ' confirmou' where id = r.id;
  return '✅ Aplicado: ' || r.resumo || E'\nVale a partir da próxima checagem (até 3 min).';
end $$;


--
-- Name: cancelar_comando(); Type: FUNCTION; Schema: ixc; Owner: -
--

CREATE FUNCTION ixc.cancelar_comando() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare r ixc.comandos;
begin
  select * into r from ixc.comandos where status = 'pendente' order by id desc limit 1;
  if not found then return 'Nenhuma alteração pendente.'; end if;
  update ixc.comandos set status = 'cancelado' where id = r.id;
  return '🚫 Cancelado: ' || r.resumo;
end $$;


--
-- Name: registrar_comando(jsonb, text, text, text); Type: FUNCTION; Schema: ixc; Owner: -
--

CREATE FUNCTION ixc.registrar_comando(p_acao jsonb, p_resumo text, p_autor text, p_texto text) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
declare v bigint;
begin
  update ixc.comandos set status = 'expirado' where status = 'pendente';
  insert into ixc.comandos (autor, texto, acao, resumo) values (p_autor, p_texto, p_acao, p_resumo) returning id into v;
  return v;
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: comandos; Type: TABLE; Schema: ixc; Owner: -
--

CREATE TABLE ixc.comandos (
    id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    autor text,
    texto text,
    acao jsonb NOT NULL,
    resumo text NOT NULL,
    status text DEFAULT 'pendente'::text NOT NULL,
    resultado text,
    aplicado_em timestamp with time zone
);


--
-- Name: TABLE comandos; Type: COMMENT; Schema: ixc; Owner: -
--

COMMENT ON TABLE ixc.comandos IS 'Comandos "ixc ..." do grupo de automação; so aplicam apos "ixc ok"';


--
-- Name: comandos_id_seq; Type: SEQUENCE; Schema: ixc; Owner: -
--

CREATE SEQUENCE ixc.comandos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: comandos_id_seq; Type: SEQUENCE OWNED BY; Schema: ixc; Owner: -
--

ALTER SEQUENCE ixc.comandos_id_seq OWNED BY ixc.comandos.id;


--
-- Name: contatos_setor; Type: TABLE; Schema: ixc; Owner: -
--

CREATE TABLE ixc.contatos_setor (
    id integer NOT NULL,
    setor text NOT NULL,
    ordem integer DEFAULT 0,
    nome text NOT NULL,
    fone text,
    seg text,
    ter text,
    qua text,
    qui text,
    sex text,
    sab text,
    dom text,
    obs text,
    ativo boolean DEFAULT true,
    escala text
);


--
-- Name: TABLE contatos_setor; Type: COMMENT; Schema: ixc; Owner: -
--

COMMENT ON TABLE ixc.contatos_setor IS 'Contatos por setor pro bot de escalas (regra de 04/10/2026). Horario: HH:MM-HH:MM, intervalos separados por virgula; vazio = nao atende.';


--
-- Name: COLUMN contatos_setor.escala; Type: COMMENT; Schema: ixc; Owner: -
--

COMMENT ON COLUMN ixc.contatos_setor.escala IS 'empresa:id_condominio da escala 12x36 que o contato segue (horario e dia vem de escala_base/escala_dia, nao de seg..dom)';


--
-- Name: contatos_setor_id_seq; Type: SEQUENCE; Schema: ixc; Owner: -
--

CREATE SEQUENCE ixc.contatos_setor_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contatos_setor_id_seq; Type: SEQUENCE OWNED BY; Schema: ixc; Owner: -
--

ALTER SEQUENCE ixc.contatos_setor_id_seq OWNED BY ixc.contatos_setor.id;


--
-- Name: empresas; Type: TABLE; Schema: ixc; Owner: -
--

CREATE TABLE ixc.empresas (
    id text NOT NULL,
    nome text NOT NULL,
    base_url text NOT NULL,
    auth text NOT NULL,
    last_evento_id bigint DEFAULT 0 NOT NULL,
    dono_id text,
    ignorar_assuntos text[] DEFAULT '{}'::text[] NOT NULL,
    semtec_sem_local boolean DEFAULT false NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    atualizado timestamp with time zone DEFAULT now(),
    assuntos_financeiros text[] DEFAULT '{}'::text[] NOT NULL
);


--
-- Name: COLUMN empresas.assuntos_financeiros; Type: COMMENT; Schema: ixc; Owner: -
--

COMMENT ON COLUMN ixc.empresas.assuntos_financeiros IS 'id_assunto de O.S. financeiras: nao notifica nem lembra (28/09)';


--
-- Name: escala_base; Type: TABLE; Schema: ixc; Owner: -
--

CREATE TABLE ixc.escala_base (
    empresa text NOT NULL,
    id_condominio text NOT NULL,
    tipo text DEFAULT 'fixo'::text NOT NULL,
    tecnicos text,
    seg text,
    ter text,
    qua text,
    qui text,
    sex text,
    sab text,
    dom text,
    obs text
);


--
-- Name: TABLE escala_base; Type: COMMENT; Schema: ixc; Owner: -
--

COMMENT ON TABLE ixc.escala_base IS 'Horario de atendimento por shopping (regras da coordenação, 27/09/2026) para o comando ixc quem';


--
-- Name: escala_dia; Type: TABLE; Schema: ixc; Owner: -
--

CREATE TABLE ixc.escala_dia (
    data date NOT NULL,
    empresa text NOT NULL,
    id_condominio text NOT NULL,
    tecnico text NOT NULL,
    fonte text DEFAULT 'planilha ESCALAS aba HOJE'::text NOT NULL,
    sincronizado timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE escala_dia; Type: COMMENT; Schema: ixc; Owner: -
--

COMMENT ON TABLE ixc.escala_dia IS 'Quem trabalha em cada dia nos shoppings 12x36 e Porto Belo/Tijucas (sync horario da planilha ESCALAS)';


--
-- Name: eventos; Type: TABLE; Schema: ixc; Owner: -
--

CREATE TABLE ixc.eventos (
    id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    empresa text,
    tipo text NOT NULL,
    id_chamado text,
    protocolo text,
    evento text,
    grupo text,
    mentioned text[],
    texto text,
    status text NOT NULL,
    motivo text,
    tentativas integer DEFAULT 0 NOT NULL,
    ultima_tentativa timestamp with time zone
);


--
-- Name: eventos_id_seq; Type: SEQUENCE; Schema: ixc; Owner: -
--

CREATE SEQUENCE ixc.eventos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: eventos_id_seq; Type: SEQUENCE OWNED BY; Schema: ixc; Owner: -
--

ALTER SEQUENCE ixc.eventos_id_seq OWNED BY ixc.eventos.id;


--
-- Name: feriados; Type: TABLE; Schema: ixc; Owner: -
--

CREATE TABLE ixc.feriados (
    id integer NOT NULL,
    data date NOT NULL,
    empresa text,
    id_condominio text,
    descricao text NOT NULL,
    criado timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE feriados; Type: COMMENT; Schema: ixc; Owner: -
--

COMMENT ON TABLE ixc.feriados IS 'Dias sem re-alerta de chamado sem tecnico (igual domingo). empresa/id_condominio null = vale para todos';


--
-- Name: feriados_id_seq; Type: SEQUENCE; Schema: ixc; Owner: -
--

CREATE SEQUENCE ixc.feriados_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: feriados_id_seq; Type: SEQUENCE OWNED BY; Schema: ixc; Owner: -
--

ALTER SEQUENCE ixc.feriados_id_seq OWNED BY ixc.feriados.id;


--
-- Name: funcionarios; Type: TABLE; Schema: ixc; Owner: -
--

CREATE TABLE ixc.funcionarios (
    empresa text NOT NULL,
    id_func text NOT NULL,
    nome text NOT NULL
);


--
-- Name: locais; Type: TABLE; Schema: ixc; Owner: -
--

CREATE TABLE ixc.locais (
    empresa text NOT NULL,
    id_condominio text NOT NULL,
    nome text NOT NULL,
    grupo text NOT NULL,
    tec_padrao text,
    marcar_sem_tec text[] DEFAULT '{}'::text[] NOT NULL,
    marcar_escalar text[] DEFAULT '{}'::text[] NOT NULL
);


--
-- Name: parametros; Type: TABLE; Schema: ixc; Owner: -
--

CREATE TABLE ixc.parametros (
    chave text NOT NULL,
    valor text NOT NULL,
    descricao text
);


--
-- Name: tecnicos; Type: TABLE; Schema: ixc; Owner: -
--

CREATE TABLE ixc.tecnicos (
    empresa text NOT NULL,
    id_func text NOT NULL,
    nome text NOT NULL,
    fone text,
    grupo text
);


--
-- Name: comandos id; Type: DEFAULT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.comandos ALTER COLUMN id SET DEFAULT nextval('ixc.comandos_id_seq'::regclass);


--
-- Name: contatos_setor id; Type: DEFAULT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.contatos_setor ALTER COLUMN id SET DEFAULT nextval('ixc.contatos_setor_id_seq'::regclass);


--
-- Name: eventos id; Type: DEFAULT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.eventos ALTER COLUMN id SET DEFAULT nextval('ixc.eventos_id_seq'::regclass);


--
-- Name: feriados id; Type: DEFAULT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.feriados ALTER COLUMN id SET DEFAULT nextval('ixc.feriados_id_seq'::regclass);


--
-- Name: comandos comandos_pkey; Type: CONSTRAINT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.comandos
    ADD CONSTRAINT comandos_pkey PRIMARY KEY (id);


--
-- Name: contatos_setor contatos_setor_pkey; Type: CONSTRAINT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.contatos_setor
    ADD CONSTRAINT contatos_setor_pkey PRIMARY KEY (id);


--
-- Name: empresas empresas_pkey; Type: CONSTRAINT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.empresas
    ADD CONSTRAINT empresas_pkey PRIMARY KEY (id);


--
-- Name: escala_base escala_base_pkey; Type: CONSTRAINT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.escala_base
    ADD CONSTRAINT escala_base_pkey PRIMARY KEY (empresa, id_condominio);


--
-- Name: escala_dia escala_dia_pkey; Type: CONSTRAINT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.escala_dia
    ADD CONSTRAINT escala_dia_pkey PRIMARY KEY (data, empresa, id_condominio, tecnico);


--
-- Name: eventos eventos_pkey; Type: CONSTRAINT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.eventos
    ADD CONSTRAINT eventos_pkey PRIMARY KEY (id);


--
-- Name: feriados feriados_pkey; Type: CONSTRAINT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.feriados
    ADD CONSTRAINT feriados_pkey PRIMARY KEY (id);


--
-- Name: funcionarios funcionarios_pkey; Type: CONSTRAINT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.funcionarios
    ADD CONSTRAINT funcionarios_pkey PRIMARY KEY (empresa, id_func);


--
-- Name: locais locais_pkey; Type: CONSTRAINT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.locais
    ADD CONSTRAINT locais_pkey PRIMARY KEY (empresa, id_condominio);


--
-- Name: parametros parametros_pkey; Type: CONSTRAINT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.parametros
    ADD CONSTRAINT parametros_pkey PRIMARY KEY (chave);


--
-- Name: tecnicos tecnicos_pkey; Type: CONSTRAINT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.tecnicos
    ADD CONSTRAINT tecnicos_pkey PRIMARY KEY (empresa, id_func);


--
-- Name: eventos_lemb; Type: INDEX; Schema: ixc; Owner: -
--

CREATE INDEX eventos_lemb ON ixc.eventos USING btree (empresa, id_chamado, tipo);


--
-- Name: eventos_pend; Type: INDEX; Schema: ixc; Owner: -
--

CREATE INDEX eventos_pend ON ixc.eventos USING btree (status) WHERE (status = 'falha'::text);


--
-- Name: eventos_ts; Type: INDEX; Schema: ixc; Owner: -
--

CREATE INDEX eventos_ts ON ixc.eventos USING btree (ts);


--
-- Name: feriados_uk; Type: INDEX; Schema: ixc; Owner: -
--

CREATE UNIQUE INDEX feriados_uk ON ixc.feriados USING btree (data, COALESCE(empresa, ''::text), COALESCE(id_condominio, ''::text));


--
-- Name: escala_base escala_base_empresa_id_condominio_fkey; Type: FK CONSTRAINT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.escala_base
    ADD CONSTRAINT escala_base_empresa_id_condominio_fkey FOREIGN KEY (empresa, id_condominio) REFERENCES ixc.locais(empresa, id_condominio);


--
-- Name: feriados feriados_empresa_fkey; Type: FK CONSTRAINT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.feriados
    ADD CONSTRAINT feriados_empresa_fkey FOREIGN KEY (empresa) REFERENCES ixc.empresas(id);


--
-- Name: funcionarios funcionarios_empresa_fkey; Type: FK CONSTRAINT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.funcionarios
    ADD CONSTRAINT funcionarios_empresa_fkey FOREIGN KEY (empresa) REFERENCES ixc.empresas(id);


--
-- Name: locais locais_empresa_fkey; Type: FK CONSTRAINT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.locais
    ADD CONSTRAINT locais_empresa_fkey FOREIGN KEY (empresa) REFERENCES ixc.empresas(id);


--
-- Name: tecnicos tecnicos_empresa_fkey; Type: FK CONSTRAINT; Schema: ixc; Owner: -
--

ALTER TABLE ONLY ixc.tecnicos
    ADD CONSTRAINT tecnicos_empresa_fkey FOREIGN KEY (empresa) REFERENCES ixc.empresas(id);


--
-- PostgreSQL database dump complete
--


