#!/bin/bash


echo "Uninstall protobuf"
pip3 uninstall --yes protobuf

echo "Install protobuf no binary "
pip3 install --no-binary=protobuf protobuf

echo " Working Environment"
echo ${WENV}

backup=false
rm /root/python/lnd.ini

echo $'[lnd]\npassword='${LND_PASSWORD}$'\npassphrase='${LND_PASSPHRASE}$'\nexternalip='${LND_EXTERNALIP}$'\nnode_alias='${ALIAS}$'\nalias='${LND_ALIAS}$'\nrpcpass='${LND_RPCPASS}$'\npodname='${LND_PODNAME}$'\nrpcuser='${LND_RPCUSER}$'\nlndnetwork='${LND_NETWORK}$'\nrpchost='${LND_RPCHOST}$'\nbitcoind='${LND_BITCOIND}$'\nwatchtower='${WATCHTOWER}$'\nscenario='${SCENARIO}$'\nwenv='${WENV} >>/root/python/lnd.ini

echo "lnd.ini file created. Next step is create config file "

cd /root/python

echo " scenario is "$SCENARIO

if [ "$SCENARIO" = "lnd" ]; then

  python3 /root/python/lnd_config_create.py
  echo "Lnd config file created. Next step run lnd"

  lnd -C /data/v3/${LND_PODNAME}/lnd.conf > /dev/null 2>&1 &
  backup=true
  sleep 30

fi
if [ "$SCENARIO" = "breezlnd" ]; then

  python3 /root/python/lnd_config_create.py
  echo "Breez Lnd config file created. Next step run breez lnd"

  /lndbreez/lnd/lnd -C /data/v3/${LND_PODNAME}/lnd.conf > /dev/null 2>&1 &
  backup=true
  sleep 30

fi
#run check health status
python3 /root/python/run_lnd.py
echo "lnd/btcd/breezlnd started"


if [ "$IS_ROUTING_NODE" = "true" ]; then
  #creating lit conf
  lnd_data_dir='/data/v3/'${LND_PODNAME}'/data/chain/bitcoin/'${LND_NETWORK}
  lnd_tls_dir='/data/v3/'${LND_PODNAME}
  lit_dir='/data/v3/'${LND_PODNAME}'/lit'
  mkdir -p ${lit_dir}
  printf 'remote.lnd.rpcserver=localhost:10009\nremote.lnd.macaroonpath='${lnd_data_dir}'/admin.macaroon\nremote.lnd.tlscertpath='${lnd_tls_dir}'/tls.cert' >  $lit_dir/lit.conf

  litd --uipassword=${LIT_UI_PASSWORD}  --network=${LND_NETWORK} --lit-dir=${lit_dir}  > /dev/null 2>&1 &
fi

#echo "Peering with other nodes..."
#python3 /root/python/peer_connect.py >> /root/python/peer.log

#echo "Starting lnd monitor"
#python3 -u /root/python/monitor.py >> /root/python/monitor.log

#echo "Peering complete"
check_interval=3 # check every 5 minutes
# shellcheck disable=SC1073

echo "Peering complete"
check_interval=3 # check every 5 minutes

file_size=0
file_date=0
#create backup folders if not exist
mkdir -p /data/v3/backup/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/

while [ ${backup} ];
do
#  echo "start 1"
  if [ -f /data/v3/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/channel.backup ]
  then


        file_size_new=$(stat --format="%s" /data/v3/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/channel.backup)
#        echo ${file_size_new}
        file_date_new=$(date -r /data/v3/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/channel.backup +%s)
#        echo ${file_date_new}
        if [ "$file_size" -ne "$file_size_new" ] | [ "$file_date" != "$file_date_new" ]
        then
           file_size=${file_size_new}
#           echo ${file_size}
           file_date=${file_date_new}
#           echo ${file_date_new}

           nowdatetime=$(date '+%Y_%m_%d_%H_%M_%S')
           echo ${nowdatetime}
           cp /data/v3/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/channel.backup /data/v3/backup/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/channel_${nowdatetime}.backup
           total_files=$(ls -1 /data/v3/backup/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/ | wc -l)

           if [ "$total_files" -gt 100 ]
           then
             removing_file="$(ls -t /data/v3/backup/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/| tail -1)"
             rm /data/v3/backup/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/${removing_file}
           fi
           echo "Backup copy for file channel backup done"
    fi

  fi
  sleep ${check_interval}
done
tail -f /dev/null

echo "Sleep expired"

