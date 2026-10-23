-- Table: public.lnd_main_v2

-- DROP TABLE public.lnd_main_v2;

CREATE TABLE IF NOT EXISTS public.lnd_main_v2
(
    id integer NOT NULL DEFAULT nextval('lnd_main_id_v2_seq'::regclass),
    file_name character varying(256) COLLATE pg_catalog."default",
    node_name character varying(256) COLLATE pg_catalog."default",
    network character varying(32) COLLATE pg_catalog."default",
    file_type character varying(32) COLLATE pg_catalog."default",
    created_at timestamp with time zone NOT NULL DEFAULT '2021-06-16 17:53:34.8246+00'::timestamp with time zone,
    updated_at timestamp with time zone NOT NULL DEFAULT '2021-06-16 17:52:42.336919+00'::timestamp with time zone,
    domain character varying(32) COLLATE pg_catalog."default",
    sfile bytea NOT NULL,
    pubkey character varying(255) COLLATE pg_catalog."default",
    watchtower character varying(50) COLLATE pg_catalog."default" NOT NULL,
    rpchost character varying(200) COLLATE pg_catalog."default",
    rpcpass character varying(200) COLLATE pg_catalog."default",
    rpcuser character varying(200) COLLATE pg_catalog."default",
    status character varying(50) COLLATE pg_catalog."default",
    key character varying(255) COLLATE pg_catalog."default"
)

TABLESPACE pg_default;

ALTER TABLE public.lnd_main_v2
    OWNER to postgres;


-- Table: public.lnd_interaction

-- DROP TABLE public.lnd_interaction;

CREATE TABLE IF NOT EXISTS public.lnd_interaction
(
    id bigint NOT NULL,
    action character varying(255) COLLATE pg_catalog."default" NOT NULL,
    date_created timestamp without time zone,
    date_modified timestamp without time zone,
    node_name character varying(255) COLLATE pg_catalog."default",
    request text COLLATE pg_catalog."default" NOT NULL,
    response text COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT lnd_interaction_pkey PRIMARY KEY (id)
)

TABLESPACE pg_default;

ALTER TABLE public.lnd_interaction
    OWNER to postgres;



-- Table: public.lnd_address

-- DROP TABLE public.lnd_address;

CREATE TABLE IF NOT EXISTS public.lnd_address
(
    id bigint NOT NULL DEFAULT nextval('lnd_address_id_seq'::regclass),
    address text COLLATE pg_catalog."default",
    date_created timestamp without time zone,
    date_modified timestamp without time zone,
    node_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    user_id character varying(255) COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT lnd_address_pkey PRIMARY KEY (id)
)

TABLESPACE pg_default;

ALTER TABLE public.lnd_address
    OWNER to postgres;


