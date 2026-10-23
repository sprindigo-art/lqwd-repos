---
name: lnd-wallet
description: Query on-chain wallet balance and Lightning channel balance
---

# LND Wallet Balance

## On-Chain Balance
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/wallet/balance \
  -d '{}' | jq .
```

Returns:
- `total_balance` — all on-chain funds (confirmed + unconfirmed)
- `confirmed_balance` — spendable on-chain funds
- `unconfirmed_balance` — pending incoming on-chain transactions

## Channel Balance
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/wallet/channel-balance \
  -d '{}' | jq .
```

Returns:
- `local_balance` — total outbound liquidity across all channels
- `remote_balance` — total inbound liquidity across all channels
- `pending_open_local_balance` — funds in channels being opened
- `pending_open_remote_balance` — remote funds in channels being opened

## How to Present
Always show both balances together:

```
On-Chain: 4,500,000 sats (0.045 BTC) confirmed, 500,000 sats pending
Lightning: 15,000,000 sats local (outbound), 10,000,000 sats remote (inbound)
Total: 20,000,000 sats (0.2 BTC)
```

## Important Notes
- On-chain balance is separate from Lightning balance
- "Local balance" = how much YOU can send via Lightning
- "Remote balance" = how much you can RECEIVE via Lightning
- The sum of local + remote does not equal total funds (there are also on-chain funds and pending channels)
