---
name: lnd-info
description: Get LND node identity, sync status, version, and network info
---

# LND Node Info

## Get Node Info
Returns node pubkey, alias, active/inactive channel count, peer count, block height, sync status, and version.

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/info \
  -d '{}' | jq .
```

## How to Present
- Show pubkey (first 12 chars + "...")
- Show alias
- Show sync status: "Synced to chain: yes/no, Synced to graph: yes/no"
- Show block height
- Show channel summary: "X active, Y inactive, Z pending"
- Show peer count
- Show LND version

## Error Handling
- If `synced_to_chain` is false, warn the operator that the node is still syncing and operations may be unreliable.
- If `synced_to_graph` is false, note that routing decisions may be based on incomplete data.
