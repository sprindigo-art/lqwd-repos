CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


ALTER TABLE btc_payment_address ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_btc_payment_address BEFORE UPDATE ON btc_payment_address FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE cipher_method ADD created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
ALTER TABLE cipher_method ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_cipher_method BEFORE UPDATE ON cipher_method FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE command_history ADD created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
ALTER TABLE command_history ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_command_history BEFORE UPDATE ON command_history FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE default_cipher_method ADD created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
ALTER TABLE default_cipher_method ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_default_cipher_method BEFORE UPDATE ON default_cipher_method FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE lnd_access_uer ADD created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
ALTER TABLE lnd_access_uer ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_lnd_access_uer BEFORE UPDATE ON lnd_access_uer FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE lnd_config ADD created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
ALTER TABLE lnd_config ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_lnd_config BEFORE UPDATE ON lnd_config FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE lnd_creation_status_log ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_lnd_creation_status_log BEFORE UPDATE ON lnd_creation_status_log FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE lnd_invoice ADD created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
ALTER TABLE lnd_invoice ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_lnd_invoice BEFORE UPDATE ON lnd_invoice FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE lnd_main ADD created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
ALTER TABLE lnd_main ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_lnd_main BEFORE UPDATE ON lnd_main FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE lnd_main_v2 ADD created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
ALTER TABLE lnd_main_v2 ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_lnd_main_v2 BEFORE UPDATE ON lnd_main_v2 FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE lsp_monitor_channel_point ADD created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
ALTER TABLE lsp_monitor_channel_point ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_lsp_monitor_channel_point BEFORE UPDATE ON lsp_monitor_channel_point FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE lsp_monitor_close_channel ADD created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
ALTER TABLE lsp_monitor_close_channel ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_lsp_monitor_close_channel BEFORE UPDATE ON lsp_monitor_close_channel FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE lsp_monitor_open_channel ADD created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
ALTER TABLE lsp_monitor_open_channel ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_lsp_monitor_open_channel BEFORE UPDATE ON lsp_monitor_open_channel FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE lsp_monitor_pending_update ADD created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
ALTER TABLE lsp_monitor_pending_update ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_lsp_monitor_pending_update BEFORE UPDATE ON lsp_monitor_pending_update FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE lsp_staking_days ADD created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
ALTER TABLE lsp_staking_days ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_lsp_staking_days BEFORE UPDATE ON lsp_staking_days FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE lsp_transaction_address ADD created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
ALTER TABLE lsp_transaction_address ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_lsp_transaction_address BEFORE UPDATE ON lsp_transaction_address FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE secret_key_change_log ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_secret_key_change_log BEFORE UPDATE ON secret_key_change_log FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE shedlock ADD created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
ALTER TABLE shedlock ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_shedlock BEFORE UPDATE ON shedlock FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE signup_confirmation_token ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_signup_confirmation_token BEFORE UPDATE ON signup_confirmation_token FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

ALTER TABLE user_activity ADD updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL;
CREATE TRIGGER set_timestamp_user_activity BEFORE UPDATE ON user_activity FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

