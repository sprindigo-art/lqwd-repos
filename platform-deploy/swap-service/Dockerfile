FROM ubuntu:23.04

MAINTAINER Aziz Pulatov <aziz@lqwd.money>

# Add build tools.
RUN apt-get update && apt-get -y install nano && apt-get install net-tools \
    && apt-get -y install wget\
    && apt-get -y install nodejs \
    && apt-get -y install npm

RUN mkdir "swap-service"

COPY index.js /swap-service
COPY index.html /swap-service
COPY config.js /swap-service
COPY start.js /swap-service

WORKDIR /swap-service
RUN whereis npm

RUN npm init -y

RUN npm i websocket browserify-cipher noble-secp256k1 axios bitcoinjs-lib varuint-bitcoin request ecpair tiny-secp256k1 bolt11
RUN npm i http

ENV INVOICEMAC ADFA
ENV ADMINMAC BBBBB
ENV LNDENDPOINT HTTP://127.O.O.1:8080
ENV MINAMOUNT 100
ENV MAXAMOUNT 5000
ENV FEETYPE persentege
ENV FEE 2

COPY start_js.sh /usr/local/bin
RUN chmod +x /usr/local/bin/start_js.sh
CMD ["/usr/local/bin/start_js.sh"]


