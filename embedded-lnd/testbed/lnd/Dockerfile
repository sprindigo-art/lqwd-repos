# One image for everything that runs alongside a test node: lnd itself, lndk
# (BOLT 12) and lnurlpd (LNURL-pay). All three are the SAME builds that go into
# the Raspberry Pi image, just for x86_64, so both ends of the test channel run
# identical code.
#
# lnd and lnurlpd are static Go binaries; lndk is built against musl for this
# image. The base therefore only needs a shell, and curl and jq for the scripts
# that drive it.
#
# The build context is the testbed directory, not lnd/, because the entrypoints
# for the other two daemons live beside their own configuration.
FROM alpine:3.20

RUN apk add --no-cache ca-certificates bash curl jq

# Populated by scripts/60-sync-testbed.sh from /vm/yocto/artifacts.
COPY lnd/bin/lnd      /usr/local/bin/lnd
COPY lnd/bin/lncli    /usr/local/bin/lncli
COPY lnd/bin/lndk     /usr/local/bin/lndk
COPY lnd/bin/lndk-cli /usr/local/bin/lndk-cli
COPY lnd/bin/lnurlpd  /usr/local/bin/lnurlpd
RUN chmod +x /usr/local/bin/lnd /usr/local/bin/lncli /usr/local/bin/lndk \
             /usr/local/bin/lndk-cli /usr/local/bin/lnurlpd

# One entrypoint per daemon; docker-compose picks which one a service runs.
COPY lnd/entrypoint.sh     /usr/local/bin/entrypoint.sh
COPY lndk/entrypoint.sh    /usr/local/bin/lndk-entrypoint.sh
COPY lnurlpd/entrypoint.sh /usr/local/bin/lnurlpd-entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/lndk-entrypoint.sh \
             /usr/local/bin/lnurlpd-entrypoint.sh

# Both lnd configs ship in the image; LND_CONF picks one at run time. lnd.conf
# is the gateway, lnd-merchant.conf the hardened appliance stand-in.
COPY lnd/lnd.conf          /etc/lnd/lnd.conf
COPY lnd/lnd-merchant.conf /etc/lnd/lnd-merchant.conf

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
