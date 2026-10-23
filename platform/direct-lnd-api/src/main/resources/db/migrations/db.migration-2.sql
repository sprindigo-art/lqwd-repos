CREATE SEQUENCE IF NOT EXISTS public.lnd_node_configs_seq;

CREATE TABLE IF NOT EXISTS public.lnd_node_configs
(
    id integer NOT NULL DEFAULT nextval('lnd_node_configs_seq'::regclass),
    lnd_node_name text COLLATE pg_catalog."default" NOT NULL,
    status text COLLATE pg_catalog."default" NOT NULL,
    version text COLLATE pg_catalog."default" NOT NULL,
    config_param text COLLATE pg_catalog."default",
    created timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT lnd_node_configs_pkey PRIMARY KEY (id)
    )
    TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.lnd_node_configs
    OWNER to postgres;

GRANT ALL ON TABLE public.lnd_node_configs TO lnd_user WITH GRANT OPTION;

GRANT ALL ON TABLE public.lnd_node_configs TO postgres;
