CREATE SEQUENCE IF NOT EXISTS public.lnd_node_status_seq;

CREATE TABLE IF NOT EXISTS public.lnd_node_status
(
    id integer NOT NULL DEFAULT nextval('lnd_node_status_seq'::regclass),
    pubkey text COLLATE pg_catalog."default",
    alias text COLLATE pg_catalog."default",
    lnd_node_name text COLLATE pg_catalog."default" NOT NULL,
    status text COLLATE pg_catalog."default" NOT NULL,
    config_param text COLLATE pg_catalog."default",
    result_updated text COLLATE pg_catalog."default",
    created timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT lnd_node_status_pkey PRIMARY KEY (id)
    )
    TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.lnd_node_status
    OWNER to postgres;

GRANT ALL ON TABLE public.lnd_node_status TO lnd_user WITH GRANT OPTION;

GRANT ALL ON TABLE public.lnd_node_status TO postgres;
