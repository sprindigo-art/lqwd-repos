# Builder image
FROM ubuntu:20.04 as builder
MAINTAINER Olufemi Thompson <olufemi@lqwd.money>
# Add build tools.
RUN apt-get update && apt-get install -y net-tools wget git build-essential

WORKDIR /lndcore

#get go version appropriate for building lnd
RUN wget -c https://dl.google.com/go/go1.16.linux-amd64.tar.gz -O - | tar -xz -C /usr/local
RUN ln -s /usr/local/go/bin/go /usr/local/bin/go && ln -s /usr/local/go/bin/gofmt /usr/local/bin/gofmt


# Latest stable version: https://github.com/lightningnetwork/lnd/releases
ARG LNDVERSION=0.14.1-beta

#get LND source and checkout to correct version and build lnd
RUN git clone https://github.com/lightningnetwork/lnd  \
    && cd lnd  \
    && git checkout v$LNDVERSION \
    && make tags="kvdb_etcd kvdb_postgres" install \
    && ls /usr/local/go/bin \
    && cp /root/go/bin/lnd /usr/local/bin/lnd \
    && cp /root/go/bin/lncli /usr/local/bin/lncli

# Final image
FROM ubuntu:20.04 as final
MAINTAINER Olufemi Thompson <olufemi@lqwd.money>

# Add build tools.
RUN apt-get update && apt-get -y install nano  net-tools \
    && apt-get -y install python3\
    && apt-get -y install python3-pip\
    && apt-get -y install build-essential\
    && apt-get -y install python3-psycopg2\
    && pip3 install --no-cache-dir pexpect \
    && pip3 install --no-cache-dir python-lnd-grpc\
    && pip3 install --no-cache-dir psycopg2\
    && pip3 install --no-cache-dir requests\
    && pip3 install --no-cache-dir grpcio grpcio-tools googleapis-common-protos\
    && pip3 install --no-cache-dir avro-python3 aiohttp confluent-kafka protobuf retrying

COPY --from=builder /usr/local/bin /usr/local/bin

ARG USER_ID
ARG GROUP_ID

ENV HOME /lnd

# add user with specified (or default) user/group ids
ENV USER_ID ${USER_ID:-1000}
ENV GROUP_ID ${GROUP_ID:-1000}

# add our user and group first to make sure their IDs get assigned consistently, regardless of whatever dependencies get added
RUN addgroup --gid ${GROUP_ID} --system lnd

RUN adduser --uid ${USER_ID} --ingroup lnd --disabled-password --gecos --shell --home /lnd lnd

USER root

RUN chmod -R a+rwx /lnd/

# Create a volume to house btcd data
VOLUME ["/data"]

# Expose p2p port ip 4
EXPOSE 9735

#for external lncli connection
EXPOSE 8080
# Expose grpc port
EXPOSE 10009
# Expose p2p port
EXPOSE 853
#for external lncli connection
EXPOSE 29088
# Expose grpc port
EXPOSE 29099

ENV LND_PASSPHRASE passprhase
ENV LND_PASSWORD password
ENV LND_EXTERNALIP externalip
# use also as namespace for domains in kubernetes
ENV LND_ALIAS lqwd-lnd
# rpc host user and password
ENV LND_RPCUSER rpcuser
ENV LND_RPCPASS rpcpass
ENV LND_RPCHOST rpchost
# if podname = none lnd pod will not start
ENV LND_PODNAME tlnd3
# bitcoind and lnd network. testnet by default
ENV LND_NETWORK testnet
# if bitcoind = false bitcoind will nor start
ENV LND_BITCOIND false
ENV WATCHTOWER false
ENV WENV development
ENV SCENARIO regtest
ENV KADMINUSER 7
ENV KADMINPASS 8
ENV SCHEMA_HOST 19
ENV KAFKA_PASSWORD 20
ENV KAFKA_USER 21
ENV KAFKA_HOST 22
ENV KAFKA_CO_TOPIC 23
ENV KAFKA_CO_GROUP_ID 24
ENV KAFKA_PRO_TOPIC 25
ENV DEBUG 26
ENV RESTORATION_NODE NONE
ENV LND_DB_USER 27
ENV LND_DB_PASS 28
ENV LND_DB_HOST 29
ENV LND_DB 30
ENV ETCD_NODE 31


WORKDIR /root/lnd-cluster

COPY / .

COPY backup/ backup/.

COPY lnd_cmd.sh /usr/local/bin/
COPY entrypoint.sh /usr/local/bin/

RUN chmod +x /usr/local/bin/lnd_cmd.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/usr/local/bin/lnd_cmd.sh"]