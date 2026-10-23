#!/bin/bash

echo "LND_PODNAME ${LND_PODNAME} - ${LND_NETWORK} stop command done "

if test -f "/data/v3/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/admin.macaroon"; then
    echo "admin.macarron exists."
    lncli --tlscertpath /data/v3/${LND_PODNAME}/tls.cert --macaroonpath /data/v3/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/admin.macaroon stop
    sleep 15
    rm admin.macaroon
fi

ps -ef | grep lnd | grep -v grep | awk '{print $2}' | xargs kill
sleep 10





