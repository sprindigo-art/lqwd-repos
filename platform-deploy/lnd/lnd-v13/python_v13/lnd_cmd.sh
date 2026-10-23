#!/bin/bash

echo "Uninstall protobuf"
pip3 uninstall --yes protobuf

echo "Install protobuf no binary "
pip3 install --no-binary=protobuf protobuf

echo "Working Environment ${WENV}"

backup=false
rm /root/python/lnd.ini
rm /root/python/monitor.ini


echo $'[lnd]\npassword='"${LND_PASSWORD}"$'\npassphrase='"${LND_PASSPHRASE}"$'\nexternalip='"${LND_EXTERNALIP}"$'\nnode_alias='"${ALIAS}"$'\nalias='"${LND_ALIAS}"$'\nrpcpass='"${LND_RPCPASS}"$'\npodname='"${LND_PODNAME}"$'\nrpcuser='"${LND_RPCUSER}"$'\nlndnetwork='"${LND_NETWORK}"$'\nrpchost='"${LND_RPCHOST}"$'\nbitcoind='"${LND_BITCOIND}"$'\nwatchtower='"${WATCHTOWER}"$'\nowner='"${OWNER}"$'\nscenario='"${SCENARIO}"$'\nwenv='"${WENV}"$'\nuse_postgres='"${USE_POSTGRES}" >>/root/python/lnd.ini

echo $'[monitor]\nschema_host='"${SCHEMA_HOST}"$'\nuser_kafka_pass='"${KAFKA_PASSWORD}"$'\nuser_kafka='"${KAFKA_USER}"$'\nkafka_host='"${KAFKA_HOST}"$'\nkafka_co_topic='"${KAFKA_CO_TOPIC}"$'\nkafka_pro_topic='"${KAFKA_PRO_TOPIC}"$'\nmonitor_node_name='"${LND_PODNAME}"$'\nmonitor_node_host=localhost\nmonitor_node_port=8080\nmonitor_node_network='"${LND_NETWORK}"$'\nmonitor_debug='"${DEBUG}"$'\nsasl_mechanism=PLAIN\nsecurity_protocol=SASL_PLAINTEXT\nlndnetwork='"${LND_NETWORK}"$'\nkafka_co_group_id=334\nkafka_offset_reset=earliest' >>/root/python/monitor.ini

echo "lnd.ini and monitor.ini files created. Next step is create config file "

cd /root/python

python3 /root/python/lnd_config_create.py

lnd -C /data/v3/${LND_PODNAME}/lnd.conf > /dev/null 2>&1 &
backup=true
sleep 30


echo "starting lnd..."
python3 /root/python/run_lnd.py


echo "Peering with other nodes..."
chmod +x /root/python/peerconnect.py
nohup python3 -u /root/python/peerconnect.py >> /root/python/peer.log &

echo "Starting lnd monitor"
chmod +x /root/python/monitor.py
nohup python3 -u /root/python/monitor.py >> /root/python/monitor.log &

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

