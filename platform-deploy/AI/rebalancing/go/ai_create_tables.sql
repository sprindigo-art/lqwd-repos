DROP TABLE IF EXISTS ai_results;
DROP TABLE IF EXISTS ai_payment_hop;
DROP TABLE IF EXISTS ai_payments;
DROP TABLE IF EXISTS ai_query_hop;
DROP TABLE IF EXISTS ai_queried_routes;
DROP TABLE IF EXISTS ai_rebalance_channels;
DROP TABLE IF EXISTS ai_reasons;


CREATE TABLE ai_rebalance_channels (
    rebalance_id SERIAL PRIMARY KEY,
    lnd_node VARCHAR(255) NOT NULL,
    channel_id BIGINT NOT NULL,
    channel_point VARCHAR(255) NOT NULL,
    amount_to_balance BIGINT NOT NULL,
    max_fee BIGINT NOT NULL,
    balanced BOOLEAN NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ai_queried_routes (
    route_id SERIAL PRIMARY KEY,
    rebalance_id INTEGER NOT NULL,
    total_time_lock BIGINT NOT NULL,
    total_fees DECIMAL NOT NULL,
    total_amt DECIMAL NOT NULL,
    total_fees_msat BIGINT NOT NULL,
    total_amt_msat BIGINT NOT NULL,
    success_prob DECIMAL NOT NULL,
    FOREIGN KEY (rebalance_id) REFERENCES ai_rebalance_channels (rebalance_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ai_query_hop (
    hop_id SERIAL PRIMARY KEY,
    route_id INTEGER NOT NULL,
    chan_id BIGINT NOT NULL,
    chan_capacity BIGINT NOT NULL,
    amt_to_forward BIGINT NOT NULL,
    fee BIGINT NOT NULL,
    expiry BIGINT NOT NULL,
    amt_to_forward_msat BIGINT NOT NULL,
    fee_msat BIGINT NOT NULL,
    pub_key VARCHAR(255) NOT NULL,
    tlv_payload BOOLEAN NOT NULL,
    FOREIGN KEY (route_id) REFERENCES ai_queried_routes (route_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ai_payments (
    payment_id SERIAL PRIMARY KEY,
    payment_error TEXT,
    payment_preimage TEXT,
    payment_route_total_time_lock INTEGER,
    payment_route_total_fees TEXT,
    payment_route_total_amt TEXT,
    payment_route_total_fees_msat TEXT,
    payment_route_total_amt_msat TEXT,
    payment_hash TEXT,
    rebalance_id INTEGER REFERENCES ai_rebalance_channels(rebalance_id),
    queried_route_id INTEGER REFERENCES ai_queried_routes(route_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ai_payment_hop (
    hop_id SERIAL PRIMARY KEY,
    payment_id INTEGER NOT NULL,
    chan_id BIGINT NOT NULL,
    chan_capacity BIGINT NOT NULL,
    amt_to_forward BIGINT NOT NULL,
    fee BIGINT NOT NULL,
    expiry BIGINT NOT NULL,
    amt_to_forward_msat BIGINT NOT NULL,
    fee_msat BIGINT NOT NULL,
    pub_key VARCHAR(255) NOT NULL,
    tlv_payload BOOLEAN NOT NULL,
    FOREIGN KEY (payment_id) REFERENCES ai_payments (payment_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ai_reasons (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ai_results (
    id SERIAL PRIMARY KEY,
    success BOOLEAN NOT NULL,
    rebalance_id INTEGER REFERENCES ai_rebalance_channels(rebalance_id),
    payment_id INTEGER REFERENCES ai_payments(payment_id),
    reason_id INTEGER REFERENCES ai_reasons(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
