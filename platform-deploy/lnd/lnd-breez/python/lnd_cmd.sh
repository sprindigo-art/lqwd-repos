#!/bin/bash

echo "Uninstall protobuf"
pip3 uninstall --yes protobuf

echo "Install protobuf no binary "
pip3 install --no-binary=protobuf -U "protobuf<4.21.12"

echo "Working Environment ${WENV}"
echo " tor enable  ${TOR_ENABLE}"
#
#
echo $'[lnd]\npassword='"${LND_PASSWORD}"$'\npassphrase='"${LND_PASSPHRASE}"$'\nexternalip='"${LND_EXTERNALIP}"$'\nnode_alias='"${ALIAS}"$'\nbtc_alias='"${BTC_ALIAS}"$'\nalias='"${LND_ALIAS}"$'\nrpcpass='"${LND_RPCPASS}"$'\npodname='"${LND_PODNAME}"$'\nrpcuser='"${LND_RPCUSER}"$'\nlndnetwork='"${LND_NETWORK}"$'\nrpchost='"${LND_RPCHOST}"$'\nbitcoind='"${LND_BITCOIND}"$'\nwatchtower='"${WATCHTOWER}"$'\nowner='"${OWNER}"$'\nscenario='"${SCENARIO}"$'\nwenv='"${WENV}"$'\nuse_postgres='"${USE_POSTGRES}"$'\nkey_send_enabled='"${KEY_SEND_ENABLED}" >>/root/python/lnd.ini
#
#echo $'[monitor]\nschema_host='"${SCHEMA_HOST}"$'\nuser_kafka_pass='"${KAFKA_PASSWORD}"$'\nuser_kafka='"${KAFKA_USER}"$'\nkafka_host='"${KAFKA_HOST}"$'\nkafka_co_topic='"${KAFKA_CO_TOPIC}"$'\nkafka_pro_topic='"${KAFKA_PRO_TOPIC}"$'\nmonitor_node_name='"${LND_PODNAME}"$'\nmonitor_node_host=localhost\nmonitor_node_port=8080\nmonitor_node_network='"${LND_NETWORK}"$'\nmonitor_debug='"${DEBUG}"$'\nsasl_mechanism=PLAIN\nsecurity_protocol=SASL_PLAINTEXT\nlndnetwork='"${LND_NETWORK}"$'\nkafka_co_group_id=334\nkafka_offset_reset=earliest' >>/root/python/monitor.ini
#
#echo "lnd.ini and monitor.ini files created. Next step is create config file "

service cron status
service cron start
service cron status

env >> /root/.env

cd /root/python

python3 /root/python/lnd_config_create.py

if [ "$TOR_ENABLE" == "1" ];
then
  tor -f /root/python/torrc
fi

lnd -C /data/v3/${LND_PODNAME}/lnd.conf > /dev/null 2>&1 &
echo " lnd node stated "

echo "waiting for unlock or create wallet "
python3 /root/python/run_lnd.py


echo "Starting lnd monitor"
chmod +x /root/python/monitor.py
nohup python3 -u /root/python/monitor.py >> /proc/1/fd/1 &


tail -f /dev/null

echo "Sleep expired"
