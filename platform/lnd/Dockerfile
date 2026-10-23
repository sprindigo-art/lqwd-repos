# Builder image
FROM ubuntu:20.10 as builder
MAINTAINER Aziz Pulatov <aziz@lqwd.money>
# Add build tools.
RUN apt-get update && apt-get -y install wget

RUN apt-get update \
    && apt-get install git -y

WORKDIR /lndbreez
##install go
RUN wget -c https://dl.google.com/go/go1.14.2.linux-amd64.tar.gz -O - | tar -xz -C /usr/local
ARG BREEZ_BRANCH=breez-node-v0.12.1-beta
#-- clone breez lnd --#
#FROM alpine:3.12 AS builder
#RUN apk update
#RUN apk add git go musl-dev make bash
#RUN git clone https://github.com/breez/lnd
#RUN cd lnd \
#    && git checkout breez-node-v0.12.1-beta
#RUN cd lnd \
#    && COMMIT=$(git describe --abbrev=40 --dirty)\
#    && COMMIT_HASH=$(git rev-parse HEAD) \
#    && PKG=github.com/lightningnetwork/lnd \
#    && export CGO_ENABLED=0 \
#    && go build -trimpath -ldflags "-X ${PKG}/build.Commit=${COMMIT} -X ${PKG}/build.CommitHash=${COMMIT_HASH}" -tags=submarineswaprpc,chanreservedynamic,routerrpc,walletrpc,chainrpc -o lnd-breez-node-staging ./cmd/lnd \
#    && go build -trimpath -ldflags "-X ${PKG}/build.Commit=${COMMIT} -X ${PKG}/build.CommitHash=${COMMIT_HASH}" -tags=submarineswaprpc,chanreservedynamic,routerrpc,walletrpc,chainrpc -o lncli-breez-node-staging ./cmd/lncli


RUN git clone https://github.com/breez/lnd
RUN cd lnd \
    && git checkout ${BREEZ_BRANCH}

RUN cd lnd \
#    && COMMIT=$(git describe --abbrev=40 --dirty)\
#    && COMMIT_HASH=$(git rev-parse HEAD) \
#    && PKG=github.com/lightningnetwork/lnd \
#    && export CGO_ENABLED=0 \
    && /usr/local/go/bin/go build -tags=experimental,invoicesrpc,signrpc,autopilotrpc,experimental,submarineswaprpc,chanreservedynamic,routerrpc,walletrpc,chainrpc,signrpc ./cmd/lnd/ \
    && /usr/local/go/bin/go build -tags=experimental,invoicesrpc,signrpc,autopilotrpc,experimental,submarineswaprpc,chanreservedynamic,routerrpc,walletrpc,chainrpc,signrpc ./cmd/lncli/

#setup lit tools



#RUN rm /lndbreez/lnd/go.mod
#COPY go.mod /lndbreez/lnd/go.mod
#RUN rm /lndbreez/lnd/cmd/lnd/main.go
#COPY main.go /lndbreez/lnd/cmd/lnd/main.go
##install go
#RUN wget -c https://dl.google.com/go/go1.14.2.linux-amd64.tar.gz -O - | tar -xz -C /usr/local
##compile breez lnd
#RUN cd lnd \
#
##    && cat go.mod\
#    && cat ./cmd/lnd/main.go\
#    && /usr/local/go/bin/go build -tags=experimental,invoicesrpc,signrpc,autopilotrpc,experimental,submarineswaprpc,chanreservedynamic,routerrpc,walletrpc,chainrpc ./cmd/lnd/ \
#    && /usr/local/go/bin/go build -tags=experimental,invoicesrpc,signrpc,autopilotrpc,experimental,submarineswaprpc,chanreservedynamic,routerrpc,walletrpc,chainrpc ./cmd/lncli/
#--End breez lnd --#

FROM ubuntu:20.10 as final
MAINTAINER Aziz Pulatov <aziz@lqwd.money>
# Add build tools.
RUN apt-get update && apt-get -y install nano && apt-get install net-tools \
    && apt-get -y install wget\
    && apt-get -y install python3\
    && apt-get -y install python3-pip\
    && pip3 install --no-cache-dir pexpect \
    && pip3 install --no-cache-dir python-lnd-grpc\
    && pip3 install --no-cache-dir requests\
#    && pip3 install --no-cache-dir psycopg2\
    && pip3 install --no-cache-dir grpcio grpcio-tools googleapis-common-protos\
    && pip3 install --no-cache-dir avro-python3 aiohttp confluent-kafka protobuf retrying
#    && apt-get -y install curl gnupg
WORKDIR /lndcore
# Latest stable version: https://github.com/lightningnetwork/lnd/releases
ARG LNDVERSION=0.13.3-beta
#get LND source
RUN wget  https://github.com/lightningnetwork/lnd/releases/download/v${LNDVERSION}/lnd-linux-amd64-v${LNDVERSION}.tar.gz \
    && wget https://github.com/lightningnetwork/lnd/releases/download/v${LNDVERSION}/manifest-v${LNDVERSION}.txt \
    && tar -xvf lnd-linux-amd64-v${LNDVERSION}.tar.gz \
    && install -m 0755 -o root -g root -t /usr/local/bin lnd-linux-amd64-v${LNDVERSION}/* \
    && rm -r -f /lndcore/*

WORKDIR /btccore
# Latest stabe version: https://bitcoincore.org/bin
ARG VERSION=0.21.0
#get Bitcoin core and install
RUN wget https://bitcoincore.org/bin/bitcoin-core-${VERSION}/bitcoin-${VERSION}-x86_64-linux-gnu.tar.gz \
    && tar -xvf bitcoin-${VERSION}-x86_64-linux-gnu.tar.gz \
    && install -m 0755 -o root -t /usr/local/bin bitcoin-${VERSION}/bin/* \
    && rm -r -f /btccore/*

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

#COPY --from=builder /usr/ /usr/

#COPY --from=builder /btccore/ /btccore/
#COPY --from=builder /lndcore/ /lndcore/
COPY --from=builder /lndbreez/ /lndbreez/
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
#ENV LIT_UI_PASSWORD 26
#ENV IS_ROUTING_NODE false
WORKDIR /root/python

COPY python/ .
#COPY googleapis/ googleapis/.

COPY backup/ backup/.

COPY python/lnd_cmd.sh /usr/local/bin/
COPY python/entrypoint.sh /usr/local/bin/

RUN chmod +x /usr/local/bin/lnd_cmd.sh

RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/usr/local/bin/lnd_cmd.sh", "$LND_PASSWORD", "$LND_PASSPHRASE", "$LND_EXTERNALIP", "$LND_ALIAS", "$LND_RPCUSER", "$LND_RPCPASS", "$LND_RPCHOST", "$LND_PODNAME", "$LND_NETWORK", "$LND_BITCOIND", "$WENV", "$WATCHTOWER", "$SCENARIO","$SCHEMA_HOST","$KAFKA_PASSWORD","$KAFKA_USER","$KAFKA_HOST","$KAFKA_CO_TOPIC","$KAFKA_CO_GROUP_ID","$KAFKA_OFFSET_RESET","$KAFKA_PRO_TOPIC","$DEBUG","$RESTORATION_NODE"]

