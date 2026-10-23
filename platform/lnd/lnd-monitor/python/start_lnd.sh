#!/bin/bash

lnd -C /data/v3/${LND_PODNAME}/lnd.conf > /dev/null 2>&1 &
echo "LND_PODNAME ${LND_PODNAME} -  started "
