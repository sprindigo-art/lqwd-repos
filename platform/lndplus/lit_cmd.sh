#!/bin/bash

lnd_data_dir='/data/v3/'${LND_PODNAME}'/data/chain/bitcoin/'${LND_NETWORK}
lnd_tls_dir='/data/v3/'${LND_PODNAME}
lit_dir='/data/v3/'${LND_PODNAME}'/lndplus'

#creating lndplus directory
mkdir -p ${lit_dir}

#create lit conf
echo -e 'remote.lnd.rpcserver='${LND_HOST}':10009\nremote.lnd.macaroonpath='${lnd_data_dir}'/admin.macaroon\nremote.lnd.tlscertpath='${lnd_tls_dir}'/tls.cert' > $lit_dir/lit.conf

#running lit
litd --uipassword=${LIT_UI_PASSWORD} --network=${LND_NETWORK} --lit-dir=${lit_dir} > /dev/null 2>&1 &
tail -f /dev/null