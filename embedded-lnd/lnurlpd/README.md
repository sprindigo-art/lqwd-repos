# lnurlpd

LNURL-pay for the appliance. About 400 lines of Go, standard library only.

- **LUD-06** `payRequest` — the amount range, the metadata, the callback
- **LUD-16** lightning addresses — `/.well-known/lnurlp/<name>`
- **LUD-12** comments — which become the invoice memo
- **LUD-21** `verify` — did this invoice settle, for whoever holds the hash
- **LUD-01** the bech32 `LNURL1…` string, for a QR code

It talks to lnd over REST on loopback with the **invoice** macaroon. REST
rather than gRPC keeps the dependency list empty — no protobuf, no generated
stubs, nothing to regenerate when lnd's protos move — and the two calls it
makes are the whole of its business with lnd.

Why it binds the VPN address and advertises somebody else's URL, and what it
deliberately cannot do: [../docs/LNURL.md](../docs/LNURL.md).

## Running it

```sh
lnurlpd \
    -listen=10.99.0.10:8090 \
    -base-url=https://pay.example.com \
    -name=merchant \
    -lnd-rest=https://127.0.0.1:8080 \
    -lnd-tls-cert=/data/lnurlpd/tls.cert \
    -lnd-macaroon=/data/lnurlpd/invoice.macaroon
```

`-base-url` is the **public** URL the gateway serves and proxies to this
daemon. It is what wallets call back to, so it is the gateway's name and not
this device's address.

`lnurlpd -print-lnurl -base-url=… -name=…` prints the lightning address and
the QR payload and exits, without touching lnd.

Every flag has an `LNURLPD_`-prefixed environment variable behind it; on the
device they come from `/etc/default/lnurlpd`, substituted at bake time from
the merchant's provisioning input.

## Tests

```sh
go test ./...
```

They cover the parts a wallet checks and the device never sees fail: the
bech32 encoding against the LUD-01 vector, the exact metadata string and its
sha256, what the callback asks lnd for, and that `verify` does not hand out
the preimage of an invoice nobody has paid.
