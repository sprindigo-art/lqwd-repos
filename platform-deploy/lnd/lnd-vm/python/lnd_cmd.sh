#!/bin/bash

echo "Uninstall protobuf"
sudo pip3 uninstall --yes protobuf

echo "Install protobuf no binary "
sudo pip3 install --no-binary=protobuf protobuf

echo "Working Environment ${WENV}"

backup=false
rm /home/ubuntu/python/lnd.ini
rm /home/ubuntu/python/monitor.ini

secret=$(aws secretsmanager get-secret-value  --region us-east-2 --secret-id  lnd_vm_secret | jq -r ."SecretString")

export LND_PASSWORD=$(echo $secret | jq -r ."LND_PASSWORD")
export LND_PASSPHRASE=$(echo $secret | jq -r ."LND_PASSPHRASE")
export LND_RPCUSER=$(echo $secret | jq -r ."LND_RPCUSER")
export LND_RPCPASS=$(echo $secret | jq -r ."LND_RPCPASS")
export CLIENT_SECRET=$(echo $secret | jq -r ."CLIENT_SECRET")
export CLIENT_ID=$(echo $secret | jq -r ."CLIENT_ID")
export LND_KAFKA_PASSWORD=$(echo $secret | jq -r ."LND_KAFKA_PASSWORD")
export LND_KAFKA_USER=$(echo $secret | jq -r ."LND_KAFKA_USER")
export LND_DB_USER=$(echo $secret | jq -r ."LND_DB_USER")
export LIT_UI_PASSWORD=$(echo $secret | jq -r ."LIT_UI_PASSWORD")
export LND_DB_PASS=$(echo $secret | jq -r ."LND_DB_PASS")
export REDIS_CRED=$(echo $secret | jq -r ."REDIS_CRED")

echo '[lnd]\npassword='"${LND_PASSWORD}"'\nclient_id='"${CLIENT_ID}"'\nclient_secret='"${CLIENT_SECRET}"'\nredis_cred='"${REDIS_CRED}"'\ndb_user='"${LND_DB_USER}"'\ndb_password='"${LND_DB_PASS}"'\npassphrase='"${LND_PASSPHRASE}"'\nexternalip='"${LND_EXTERNAL_IP}"'\nnode_alias='"${ALIAS}"'\nalias='"${LND_ALIAS}"'\nrpcpass='"${LND_RPCPASS}"'\npodname='"${LND_POD_NAME}"'\nrpcuser='"${LND_RPCUSER}"'\nlndnetwork='"${LND_NETWORK}"'\nrpchost='"${LND_RPC_HOST}"'\nbitcoind='"${LND_BITCOIND}"'\nwatchtower='"${WATCHTOWER}"'\nowner='"${OWNER}"'\nscenario='"${SCENARIO}"'\nwenv='"${WENV}"'\nuse_postgres='"${USE_POSTGRES}" >>/home/ubuntu/python/lnd.ini

echo '[monitor]\nschema_host='"${SCHEMA_HOST}"'\nuser_kafka_pass='"${LND_KAFKA_PASSWORD}"'\nuser_kafka='"${LND_KAFKA_USER}"'\nkafka_host='"${KAFKA_HOST}"'\nkafka_co_topic='"${KAFKA_CO_TOPIC}"'\nkafka_pro_topic='"${KAFKA_PRO_TOPIC}"'\nmonitor_node_name='"${LND_POD_NAME}"'\nmonitor_node_host=localhost\nmonitor_node_port=8080\nmonitor_node_network='"${LND_NETWORK}"'\nmonitor_debug='"${DEBUG}"'\nsasl_mechanism=PLAIN\nsecurity_protocol=SASL_PLAINTEXT\nlndnetwork='"${LND_NETWORK}"'\nkafka_co_group_id=334\nkafka_offset_reset=earliest' >>/home/ubuntu/python/monitor.ini

echo "lnd.ini and monitor.ini files created. Next step is create config file "

cd /home/ubuntu/python

python3 /home/ubuntu/python/lnd_config_create.py

echo "starting lnd"
lnd -C /home/ubuntu/data/v3/${LND_POD_NAME}/lnd.conf > /dev/null 2>&1 &
backup=true
sleep 30


echo "starting lnd..."
python3 /home/ubuntu/python/run_lnd.py


echo "Peering with other nodes..."
chmod +x /home/ubuntu/python/peerconnect.py
nohup python3 -u /home/ubuntu/python/peerconnect.py >> /home/ubuntu/python/peer.log &

echo "Starting lnd monitor"
chmod +x /home/ubuntu/python/monitor.py
nohup python3 -u /home/ubuntu/python/monitor.py >> /home/ubuntu/python/monitor.log &

check_interval=3 # check every 5 minutes
file_size=0
file_date=0

#create backup folders if not exist
#mkdir -p /data/v3/backup/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/
#
#while [ ${backup} ];
#do
##  echo "start 1"
#  if [ -f /data/v3/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/channel.backup ]
#  then
#
#
#        file_size_new=$(stat --format="%s" /data/v3/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/channel.backup)
##        echo ${file_size_new}
#        file_date_new=$(date -r /data/v3/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/channel.backup +%s)
##        echo ${file_date_new}
#        if [ "$file_size" -ne "$file_size_new" ] | [ "$file_date" != "$file_date_new" ]
#        then
#           file_size=${file_size_new}
##           echo ${file_size}
#           file_date=${file_date_new}
##           echo ${file_date_new}
#
#           nowdatetime=$(date '+%Y_%m_%d_%H_%M_%S')
#           echo ${nowdatetime}
#           cp /data/v3/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/channel.backup /data/v3/backup/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/channel_${nowdatetime}.backup
#           total_files=$(ls -1 /data/v3/backup/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/ | wc -l)
#
#           if [ "$total_files" -gt 100 ]
#           then
#             removing_file="$(ls -t /data/v3/backup/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/| tail -1)"
#             rm /data/v3/backup/${LND_PODNAME}/data/chain/bitcoin/${LND_NETWORK}/${removing_file}
#           fi
#           echo "Backup copy for file channel backup done"
#    fi
#
#  fi
#  sleep ${check_interval}
#done
#tail -f /dev/null
#
#echo "Sleep expired"

