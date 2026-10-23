#!/bin/bash
if command -v lncli &>/dev/null; then
  #lnd exist going to stop it first
  echo "Stop current lnd"
  lncli --tlscertpath "${LND_DIR}/tls.cert" stop
fi
LNDVERSION=0.14.2-beta
wget  https://github.com/lightningnetwork/lnd/releases/download/v${LNDVERSION}/lnd-linux-amd64-v${LNDVERSION}.tar.gz \
    && wget https://github.com/lightningnetwork/lnd/releases/download/v${LNDVERSION}/manifest-v${LNDVERSION}.txt \
    && tar -xvf lnd-linux-amd64-v${LNDVERSION}.tar.gz \
    && sudo install -m 0755 -o root -g root -t /usr/local/bin lnd-linux-amd64-v${LNDVERSION}/* \
    && rm -r -f /lndcore/*
rm -r lnd-linux-amd64-v${LNDVERSION}**
rm manifest-v${LNDVERSION}.txt


