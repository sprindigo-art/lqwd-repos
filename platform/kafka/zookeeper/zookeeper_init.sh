#!/bin/bash

#get params userpass ($1), adminpass ($2)
PARAMS1=$1
PARAMS2=$2

DIR="/data/opt/"
if [ -d "$DIR" ]; then

  echo "Folder ${DIR} exists"
else
  ###  Control will jump here if $DIR does NOT exists ###
  echo "Creating: ${DIR}  "
  mkdir /data/opt
fi

DIR="/data/opt/zookeeper"
if [ -d "$DIR" ]; then

  echo "Folder ${DIR} exists"
else
  ###  Control will jump here if $DIR does NOT exists ###
  echo "Creating: ${DIR}  "
  mkdir /data/opt/zookeeper
  chown -R kafka:kafka /data/opt/zookeeper/
fi

DIR="/data/opt/zookeeper/conf"
if [ -d "$DIR" ]; then

  echo "Folder ${DIR} exists"
else
  ###  Control will jump here if $DIR does NOT exists ###
  echo "Creating: ${DIR}  "
  mkdir /data/opt/zookeeper/conf
fi


FILE=/data/opt/zookeeper/conf/zoo.cfg
if [ -f "$FILE" ]; then
    echo "Configuration file $FILE exists. Will start using old configuration"
else
  # create zoo.cfg file
  echo $'# The number of milliseconds of each tick
  tickTime=2000
  # The number of ticks that the initial
  # synchronization phase can take
  initLimit=10
  # The number of ticks that can pass between
  # sending a request and getting an acknowledgement
  syncLimit=5
  # the directory where the snapshot is stored.
  # do not use /tmp for storage, /tmp here is just
  # example sakes.
  dataDir=/data/zookeeper
  dataLogDir=/data/opt/zookeeper/logs
  # the port at which the clients will connect
  clientPort=2181
  admin.serverPort=9876
  # the maximum number of client connections.
  # increase this if you need to handle more clients
  #maxClientCnxns=60
  #
  # The number of snapshots to retain in dataDir
  autopurge.snapRetainCount=3

  authProvider.1=org.apache.zookeeper.server.auth.SASLAuthenticationProvider
  requireClientAuthScheme=sasl
  jaasLoginRenew=3600000

  ' > /data/opt/zookeeper/conf/zoo.cfg
fi

FILE=/data/opt/zookeeper/conf/jaas.conf
if [ -f "$FILE" ]; then
    echo "Jaas file $FILE exists. Will start using old Jaas "
else
  #create secure file users and auth class
  echo $'Server{
    org.apache.zookeeper.server.auth.DigestLoginModule required
    username="admin"
    password="'${PARAMS2}'$"
    user_admin="'${PARAMS2}'$"
    user_kafka="'${PARAMS1}'$";
  };
  ' > /data/opt/zookeeper/conf/jaas.conf
fi
# update permissins
#change permission for logs folder to kakfka user
DIR="/data/opt/zookeeper/logs"
if [ -d "$DIR" ]; then

  echo "Folder ${DIR} exists"
else
  ###  Control will jump here if $DIR does NOT exists ###
  echo "Creating: ${DIR}  "
  mkdir /data/opt/zookeeper/logs
  chown -R kafka:kafka /data/opt/zookeeper/logs
fi





chmod 640 /data/opt/zookeeper/conf/jaas.conf
chown -R kafka:kafka /data/opt/zookeeper/conf/jaas.conf

chmod 640 /data/opt/zookeeper/conf/zoo.cfg
chown -R kafka:kafka /data/opt/zookeeper/conf/zoo.cfg

#add kafka options to system paramters
export KAFKA_OPTS="-Djava.security.auth.login.config=/data/opt/zookeeper/conf/jaas.conf"
echo ${KAFKA_OPTS}
export JVMFLAGS="-Djava.security.auth.login.config=/data/opt/zookeeper/conf/jaas.conf -Dzookeeper.allowSaslFailedClients=false"
echo ${JVMFLAGS}
export SERVER_JVMFLAGS="-Djava.security.auth.login.config=/data/opt/zookeeper/conf/jaas.conf"
echo ${SERVER_JVMFLAGS}

echo "Start zookeeper"
#start zookeeper wiht confing file and start-foreground paramter
/opt/zookeeper/bin/zkServer.sh --config /data/opt/zookeeper/conf start-foreground


#/bin/bash
#
tail -f /dev/null

#echo "Sleep expired"

