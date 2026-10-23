# Bitcoin Core has no official Docker image, so fetch the signed release
# tarball and verify its checksum rather than trusting a third-party image.
FROM debian:bookworm-slim

ARG BITCOIN_VERSION=31.1
ARG BITCOIN_SHA256=b80d9c3e04da78fb6f0569685673418cf686fadba9042d926d13fb87ff503f9e

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates iproute2 jq \
 && rm -rf /var/lib/apt/lists/* \
 && curl -sSLo /tmp/bitcoin.tar.gz \
      "https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_VERSION}/bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz" \
 && echo "${BITCOIN_SHA256}  /tmp/bitcoin.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/bitcoin.tar.gz -C /tmp \
 && install -m 0755 /tmp/bitcoin-${BITCOIN_VERSION}/bin/bitcoind    /usr/local/bin/bitcoind \
 && install -m 0755 /tmp/bitcoin-${BITCOIN_VERSION}/bin/bitcoin-cli /usr/local/bin/bitcoin-cli \
 && rm -rf /tmp/bitcoin*

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY miner.sh      /usr/local/bin/miner.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/miner.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
