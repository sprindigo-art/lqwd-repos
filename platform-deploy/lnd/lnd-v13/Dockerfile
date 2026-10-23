FROM ubuntu:20.04

MAINTAINER Aziz Pulatov <aziz@lqwd.money>

# Add build tools.
RUN apt-get update && apt-get -y install nano && apt-get install net-tools \
    && apt-get -y install jq\
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
    && pip3 install --no-cache-dir avro-python3 aiohttp confluent-kafka protobuf retrying



COPY tor.link  /etc/apt/sources.list.d/tor.list
RUN wget -qO- https://deb.torproject.org/torproject.org/A3C4F0F979CAA22CDBA8F512EE8CBC9E886DDD89.asc \
    | gpg --dearmor \
    | tee /usr/share/keyrings/tor-archive-keyring.gpg

RUN apt-get update && apt-get -y install apt-transport-https

RUN apt-get -y install tor

RUN apt-get -y install tor deb.torproject.org-keyring

COPY tor.default /etc/tor/torrc

EXPOSE 9050 9051 5353
#RUN apk add --no-cache tor
CMD tor -f /etc/tor/torrc

#RUN systemctl enable tor.service
#RUN systemctl start tor.service
#RUN systemctl status tor.service


WORKDIR /lndcore



# Latest stable version: https://github.com/lightningnetwork/lnd/releases
ARG LNDVERSION=0.15.4-beta

#get LND source
RUN wget  https://github.com/lightningnetwork/lnd/releases/download/v${LNDVERSION}/lnd-linux-amd64-v${LNDVERSION}.tar.gz \
    && wget https://github.com/lightningnetwork/lnd/releases/download/v${LNDVERSION}/manifest-v${LNDVERSION}.txt \
    && tar -xvf lnd-linux-amd64-v${LNDVERSION}.tar.gz \
    && install -m 0755 -o root -g root -t /usr/local/bin lnd-linux-amd64-v${LNDVERSION}/* \
    && rm -r -f /lndcore/*

RUN apt-get update && apt-get -y install cron

# Copy hello-cron file to the cron.d directory
COPY python/cron_file /etc/cron.d/cron_file

# Give execution rights on the cron job
RUN chmod 0644 /etc/cron.d/cron_file

# Apply cron job
RUN crontab /etc/cron.d/cron_file

# Create the log file to be able to run tail
#RUN touch /root/python/cron.log

# Run the command on container startup
#RUN service cron start
#RUN service cron status
#CMD cron && tail -f /root/python/cron.log

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

