# Builder image
FROM ubuntu:20.04 as builder
MAINTAINER Aziz Pulatov <aziz@lqwd.money>
# Add build tools.
RUN apt-get update && apt-get -y install wget

RUN apt-get update \
    && apt-get install git -y

RUN apt-get update


#RUN apt-get -y install git
RUN apt-get -y install autoconf automake libtool
RUN apt-get -y install g++
RUN apt-get -y install vim

RUN apt-get -y install  build-essential libtool autotools-dev
RUN apt-get -y install automake
RUN DEBIAN_FRONTEND=noninteractive TZ=Etc/UTC apt-get -y install tzdata
RUN apt-get -y install pkg-config
RUN apt-get -y install libssl-dev libevent-dev libzmq3-dev
RUN apt-get update
RUN apt-get -y install libboost-system-dev libboost-filesystem-dev libboost-chrono-dev libboost-program-options-dev libboost-test-dev libboost-thread-dev
RUN apt-get -y install libboost-all-dev
RUN apt-get -y install software-properties-common

RUN apt-get -y install libsqlite3-dev
#(only needed when legacy wallet enabled)


RUN apt-get install -y bsdmainutils #hexdump is in this pkg


ARG THREADS=4

# RUN git clone https://github.com/bitcoin/bitcoin.git

# COPY  chainparams.cpp bitcoin/src/chainparams.cpp

#checkout (v0.21.2)
RUN mkdir bitcoin && cd bitcoin \
    && git init . \
    && git remote add origin https://github.com/bitcoin/bitcoin.git \
    && git fetch \
    && git checkout af591f2068d0363c92d9756ca39c43db85e5804c \
    && cd ..

COPY  23.2.patch .
RUN cd bitcoin && git apply ../v0.21.2.patch && cd ..

RUN cd bitcoin \
    && ./autogen.sh \
    && ./configure --disable-tests --disable-wallet \
      CFLAGS='-w' CXXFLAGS='-w' \
    && make -j ${THREADS} && cd ..


FROM ubuntu:20.04 as final
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

WORKDIR /btccore
# Latest stabe version: https://bitcoincore.org/bin
ARG VERSION=21.0
#get Bitcoin core and install
RUN wget https://bitcoincore.org/bin/bitcoin-core-${VERSION}/bitcoin-${VERSION}-x86_64-linux-gnu.tar.gz \
    && tar -xvf bitcoin-${VERSION}-x86_64-linux-gnu.tar.gz \
    && install -m 0755 -o root -t /usr/local/bin bitcoin-${VERSION}/bin/* \
    && rm -r -f /btccore/*
RUN apt-get update
RUN apt-get -y install libboost-system-dev libboost-filesystem-dev libboost-chrono-dev libboost-program-options-dev libboost-test-dev libboost-thread-dev
RUN DEBIAN_FRONTEND=noninteractive TZ=Etc/UTC apt-get -y install tzdata
RUN apt-get -y install libzmq3-dev
RUN apt-get -y install libboost-all-dev

COPY --from=builder /bitcoin/ /btcregtest/

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
#COPY googleapis/ googleapis/.



COPY python/lnd_cmd.sh /usr/local/bin/
COPY python/entrypoint.sh /usr/local/bin/

RUN chmod +x /usr/local/bin/lnd_cmd.sh

RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/usr/local/bin/lnd_cmd.sh", "$LND_RPCUSER", "$LND_RPCPASS", "$LND_RPCHOST", "$LND_PODNAME", "$LND_NETWORK", "$LND_BITCOIND", "$WENV", "$WATCHTOWER", "$SCENARIO"]

