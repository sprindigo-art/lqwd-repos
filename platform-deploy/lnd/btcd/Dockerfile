
FROM ubuntu:latest as builder
ENV ARCH=x86_64

RUN apt update \
    && apt install -y --no-install-recommends \
    ca-certificates \
    wget \
    gnupg \
    && apt clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

ARG VERSION=23.0
ARG BITCOIN_CORE_SIGNATURE=71A3B16735405025D447E8F274810B012346C9A6

WORKDIR /bitcoin

RUN  gpg --keyserver hkp://keyserver.ubuntu.com --recv-keys ${BITCOIN_CORE_SIGNATURE} \
    && wget https://bitcoincore.org/bin/bitcoin-core-${VERSION}/SHA256SUMS.asc \
    https://bitcoincore.org/bin/bitcoin-core-${VERSION}/SHA256SUMS \
    https://bitcoincore.org/bin/bitcoin-core-${VERSION}/bitcoin-${VERSION}-${ARCH}-linux-gnu.tar.gz \
    && gpg --verify --status-fd 1 --verify SHA256SUMS.asc SHA256SUMS 2>/dev/null | grep "^\[GNUPG:\] VALIDSIG.*${BITCOIN_CORE_SIGNATURE}\$" \
    && sha256sum --ignore-missing --check SHA256SUMS \
    && tar -xvf bitcoin-${VERSION}-x86_64-linux-gnu.tar.gz \
    && /bitcoin/bitcoin-${VERSION}/bin/test_bitcoin --show_progress \
    && rm -v /bitcoin/bitcoin-${VERSION}/bin/test_bitcoin /bitcoin/bitcoin-${VERSION}/bin/bitcoin-qt

FROM ubuntu:latest
LABEL maintainer="Aziz Pulatov"

ARG VERSION=23.0
ENV ARCH=x86_64
ARG BITCOIN_CORE_SIGNATURE=71A3B16735405025D447E8F274810B012346C9A6
# Add build tools.
RUN apt-get update && apt-get -y install nano && apt-get install net-tools \
 #   && apt-get -y install wget\
    && apt-get -y install python3
#    && apt-get -y install python3-pip\
#    && pip3 install --no-cache-dir pexpect \
#    && pip3 install --no-cache-dir python-lnd-grpc\
#    && pip3 install --no-cache-dir requests
#    && pip3 install --no-cache-dir psycopg2\
#    && pip3 install --no-cache-dir grpcio grpcio-tools googleapis-common-protos\
#    && pip3 install --no-cache-dir avro-python3 aiohttp confluent-kafka protobuf retrying

WORKDIR /bitcoin

COPY --from=builder /bitcoin/bitcoin-23.0/bin/* /bitcoin/

RUN install -m 0755 -o root -t /usr/local/bin /bitcoin/*

# Create a volume to house btcd data
VOLUME ["/data"]

# Expose p2p port
EXPOSE 853
#for external lncli connection
EXPOSE 29088
# Expose grpc port
EXPOSE 29099

# Expose neutrino ports
EXPOSE 18333
EXPOSE 8333

# rpc host user and password
ENV LND_RPCUSER rpcuser
ENV LND_RPCPASS rpcpass
ENV LND_RPCHOST rpchost
# if podname = none lnd pod will not start

ENV LND_NETWORK testnet
# if bitcoind = false bitcoind will nor start
ENV LND_BITCOIND false
ENV WATCHTOWER false
ENV WENV development
ENV SCENARIO regtest


WORKDIR /root/python

COPY python/ .




COPY python/lnd_cmd.sh /usr/local/bin/
COPY python/entrypoint.sh /usr/local/bin/

RUN chmod +x /usr/local/bin/lnd_cmd.sh

RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/usr/local/bin/lnd_cmd.sh", "$LND_RPCUSER", "$LND_RPCPASS", "$LND_RPCHOST", "$LND_PODNAME", "$LND_NETWORK", "$LND_BITCOIND", "$WENV", "$WATCHTOWER", "$SCENARIO"]
