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

-- Table: public.node_script_keys

-- DROP TABLE public.node_script_keys;

CREATE TABLE IF NOT EXISTS public.node_script_keys
(
    id integer NOT NULL,
    cipher_seed_mnemonic character varying(255) COLLATE pg_catalog."default",
    wallet_password character varying(255) COLLATE pg_catalog."default",
    CONSTRAINT node_script_keys_pkey PRIMARY KEY (id)
)

TABLESPACE pg_default;

ALTER TABLE public.node_script_keys
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

-- Table: public.lnd_config

-- DROP TABLE public.lnd_config;

CREATE TABLE IF NOT EXISTS public.lnd_config
(
    id bigint NOT NULL,
    date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    image character varying(150) COLLATE pg_catalog."default",
    label character varying(50) COLLATE pg_catalog."default",
    lndalias character varying(50) COLLATE pg_catalog."default",
    lndexternalip character varying(50) COLLATE pg_catalog."default",
    lndpassphrase character varying(50) COLLATE pg_catalog."default",
    lndpassword character varying(50) COLLATE pg_catalog."default",
    lndrpchost character varying(50) COLLATE pg_catalog."default",
    lndrpcpass character varying(50) COLLATE pg_catalog."default",
    lndrpcuser character varying(50) COLLATE pg_catalog."default",
    namespace character varying(50) COLLATE pg_catalog."default",
    nodetype character varying(50) COLLATE pg_catalog."default",
    port10009 character varying(50) COLLATE pg_catalog."default",
    port29088 character varying(50) COLLATE pg_catalog."default",
    port29099 character varying(50) COLLATE pg_catalog."default",
    port8080 character varying(50) COLLATE pg_catalog."default",
    port835 character varying(50) COLLATE pg_catalog."default",
    port9735 character varying(50) COLLATE pg_catalog."default",
    serviceexternalip character varying(50) COLLATE pg_catalog."default",
    status character varying(50) COLLATE pg_catalog."default",
    volumename character varying(50) COLLATE pg_catalog."default",
    volumepath character varying(50) COLLATE pg_catalog."default",
    CONSTRAINT lnd_config_pkey PRIMARY KEY (id)
)

TABLESPACE pg_default;

ALTER TABLE public.lnd_config
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

-- Table: public.lnd_access_uer

-- DROP TABLE public.lnd_access_uer;

CREATE TABLE IF NOT EXISTS public.lnd_access_uer
(
    id bigint NOT NULL,
    count integer,
    last_date bigint,
    apikey character varying(255) COLLATE pg_catalog."default" DEFAULT 'NULL::character varying'::character varying,
    pubkey character varying(255) COLLATE pg_catalog."default",
    CONSTRAINT lnd_access_uer_pkey PRIMARY KEY (id)
)

TABLESPACE pg_default;

ALTER TABLE public.lnd_access_uer
    OWNER to postgres;

-- Table: public.command_history

-- DROP TABLE public.command_history;

CREATE TABLE IF NOT EXISTS public.command_history
(
    id bigint NOT NULL,
    command character varying(2000) COLLATE pg_catalog."default" DEFAULT NULL::character varying,
    apikey character varying(1024) COLLATE pg_catalog."default" DEFAULT 'NULL::character varying'::character varying,
    date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    pubkey character varying(1024) COLLATE pg_catalog."default",
    CONSTRAINT command_history_pkey PRIMARY KEY (id)
)

TABLESPACE pg_default;

ALTER TABLE public.command_history
    OWNER to postgres;


