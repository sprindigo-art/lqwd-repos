#!/bin/bash

echo " Working Environment"
echo ${WENV}

rm /root/python/lnd.ini

echo $'[lnd]\nalias='${LND_ALIAS}$'\nrpcpass='${LND_RPCPASS}$'\nrpcuser='${LND_RPCUSER}$'\nlndnetwork='${LND_NETWORK}$'\nrpchost='${LND_RPCHOST}$'\nwenv='${WENV} >>/root/python/lnd.ini


echo "lnd.ini file created. Next step is create config file "


python3 /root/python/run_lnd.py

echo "Config file created successfully"

bitcoind -datadir=/data/bitcoind -conf=/data/bitcoind/bitcoin.conf

tail -f /dev/null

echo "Sleep expired"

