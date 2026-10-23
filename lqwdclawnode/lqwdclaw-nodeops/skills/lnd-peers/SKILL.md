---
name: lnd-peers
description: List connected Lightning Network peers with connection details
---

# LND Peers

## List All Peers
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/peers \
  -d '{}' | jq .
```

Returns an array of peers, each with:
- `pub_key` — peer's public key
- `address` — IP:port of peer
- `bytes_sent` / `bytes_recv` — total bytes transferred
- `sat_sent` / `sat_recv` — total sats transferred
- `inbound` — whether the peer connected to us (true) or we connected to them (false)
- `ping_time` — latency in microseconds

## How to Present
Use a table:

```
| Peer (short) | Address | Sent | Received | Ping (ms) | Direction |
|---|---|---|---|---|---|
| 03peer1...44 | 1.2.3.4:9735 | 1,200,000 sats | 800,000 sats | 25 | outbound |
```

- Convert ping_time from microseconds to milliseconds for readability
- Flag peers with ping > 500ms as "high latency"
- Show total peer count and inbound/outbound breakdown
