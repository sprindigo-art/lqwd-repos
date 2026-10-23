CREATE MATERIALIZED VIEW all_transaction
AS
SELECT * FROM (SELECT node_name as node, transaction_hash as trx_id, created, amount, 'TRANSACTION' as type, 'PAID' as state, user_id FROM lsp_transaction
               UNION ALL
               SELECT node_name as node, pre_image as trx_id, created, CAST(value AS int) as amount, 'INVOICE' as type, state, user_id FROM lsp_monitor_invoice) tr ORDER BY tr.created DESC
WITH DATA;


CREATE INDEX unq_all_transactions_id ON all_transaction (trx_id);