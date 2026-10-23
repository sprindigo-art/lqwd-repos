FROM ubuntu:20.04 as builder
MAINTAINER Aziz Pulatov <aziz@lqwd.money>
# Add build tools.
RUN apt-get update && apt-get -y install wget

RUN apt-get update \
    && apt-get install git -y

RUN apt-get install make -y

RUN wget -c https://dl.google.com/go/go1.20.2.linux-amd64.tar.gz -O - | tar -xz -C /usr/local

# Force Go to use the cgo based DNS resolver. This is required to ensure DNS
# queries required to connect to linked containers succeed.
ENV PATH "$PATH:/usr/local/go/bin"

ENV GODEBUG netdns=cgo

WORKDIR /breez

ARG BREEZ_BRANCH=breez-node-v0.15.4+warning

RUN git clone --recursive https://github.com/breez/lnd.git

WORKDIR /breez/lnd
RUN git checkout  $BREEZ_BRANCH
RUN git branch

ENV GOPATH /breez

RUN make install

#RUN /usr/local/go/bin/go mod download

#RUN /usr/local/go/bin/go build .

#RUN make install -v ./..
#RUN make install
#RUN make install tags="experimental,invoicesrpc,signrpc,autopilotrpc,experimental,submarineswaprpc,chanreservedynamic,routerrpc,walletrpc,chainrpc"
#RUN make install tags="experimental,invoicesrpc,signrpc,autopilotrpc,experimental,submarineswaprpc,chanreservedynamic,routerrpc,walletrpc,chainrpc"

# Start a new, final image to reduce size.
FROM ubuntu:20.04 as final

# Copy the binaries and entrypoint from the builder image.
COPY --from=builder /breez/bin/lncli /usr/local/bin/
COPY --from=builder /breez/bin/lnd /usr/local/bin/



RUN apt-get update && apt-get -y install nano && apt-get install net-tools \
        && apt-get -y install wget\
        && apt-get -y install python3\
        && apt-get -y install python3-pip\
        && apt-get -y install python3-psycopg2\
        && pip3 install --no-cache-dir pexpect \
        && pip3 install --no-cache-dir python-lnd-grpc\
        && pip3 install --no-cache-dir requests\
        && pip3 install --no-cache-dir psycopg2\
        && pip3 install --no-cache-dir redis\
        && pip3 install --no-cache-dir psutil\
        && pip3 install --no-cache-dir grpcio grpcio-tools googleapis-common-protos\
        && pip3 install --no-cache-dir avro-python3 aiohttp confluent-kafka retrying \
        && pip3 install --no-binary=protobuf -U "protobuf<4.21.12"


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

ENV LND_PASSPHRASE passprhase
ENV LND_PASSWORD password
ENV LND_EXTERNALIP externalip
# use also as namespace for domains in kubernetes
ENV LND_ALIAS lqwd-lnd
ENV BTC_RPCUSER default_rpcuser
ENV BTC_RPCPASS default_rpcpass
ENV BTC_RPCHOST btcd.regtest
# if podname = none lnd pod will not start
ENV LND_PODNAME tlnd3
# bitcoind and lnd network. testnet by default
ENV LND_NETWORK testnet
# if bitcoind = false bitcoind will nor start
ENV LND_BITCOIND false
ENV WATCHTOWER false
ENV WENV development
ENV SCENARIO regtest
ENV SCHEMA_HOST 19
ENV KAFKA_PASSWORD 20
ENV KAFKA_USER 21
ENV KAFKA_HOST 22
ENV KAFKA_CO_TOPIC 23
ENV KAFKA_CO_GROUP_ID 24
ENV KAFKA_PRO_TOPIC 25
ENV DEBUG 26
ENV RESTORATION_NODE NONE
ENV NOTIFICATION_EMAILS NONE
ENV OWNER NONE
ENV REDIS_HOST NONE
ENV REDIS_PORT NONE
ENV REDIS_CRED NONE
ENV USE_POSTGRES 1
ENV KEY_SEND_ENABLED 0
ENV FORCE_UPDATE_CONFIG 0
ENV LND_PUBLIC_PORT 0
ENV TOR_ENABLE 1

WORKDIR /root/python

COPY python/ .

COPY python/lnd_cmd.sh /usr/local/bin
#COPY python/entrypoint.sh /usr/local/bin/

RUN chmod +x /usr/local/bin/lnd_cmd.sh
RUN chmod +x /root/python/cron.sh

CMD ["/usr/local/bin/lnd_cmd.sh"]
