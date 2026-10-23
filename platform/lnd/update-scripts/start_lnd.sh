#!/bin/bash
echo " Tor Status - ${TOR_ENABLE}" 
if [ "$TOR_ENABLE" == "1" ];
then
  tor -f torrc
fi

lnd -C /data/v3/${LND_PODNAME}/lnd.conf > /dev/null 2>&1 &
echo " lnd node stated "

