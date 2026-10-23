#!/bin/bash

#input paramters 1-"$ZOO_CONNECT", 2-"$ADV_LISTENERS", 3-"$KAFKA_HOME",  4-"$USERPASS", 5-"$ADMINPASS"
PARAMS1=$1
PARAMS2=$2
PARAMS3=$3
PARAMS4=$4
PARAMS5=$5


DIR="/data/log"
if [ -d "$DIR" ]; then

  echo "Folder ${DIR} exists"
else
  ###  Control will jump here if $DIR does NOT exists ###
  echo "Creating: ${DIR}  "
  mkdir /data/log
   chown -R kafka:kafka /data/log
fi

DIR="/data/lib"
if [ -d "$DIR" ]; then

  echo "Folder ${DIR} exists"
else
  ###  Control will jump here if $DIR does NOT exists ###
  echo "Creating: ${DIR}  "
  mkdir /data/lib
   chown -R kafka:kafka /data/lib
fi

DIR="/data/log/kafka-logs"
if [ -d "$DIR" ]; then

  echo "Folder ${DIR} exists"
else
  ###  Control will jump here if $DIR does NOT exists ###
  echo "Creating: ${DIR}  "
  mkdir /data/log/kafka-logs
  chown -R kafka:kafka /data/log/kafka-logs
fi
DIR="/data/lib/kafka"
if [ -d "$DIR" ]; then

  echo "Folder ${DIR} exists"
else
  ###  Control will jump here if $DIR does NOT exists ###
  echo "Creating: ${DIR}  "
  mkdir /data/lib/kafka
   chown -R kafka:kafka /data/lib/kafka
fi

DIR="/data/config/"
if [ -d "$DIR" ]; then

  echo "Folder ${DIR} exists"
else
  ###  Control will jump here if $DIR does NOT exists ###
  echo "Creating: ${DIR}  "
  mkdir /data/config
   chown -R kafka:kafka /data/config
fi


FILE=/data/config/server.properties
if [ -f "$FILE" ]; then
    echo "Configuration file $FILE exists. Will start using old configuration"
else

# create server.propertis file for broker
echo $'############################## Server Basics #############################
# The id of the broker. This must be set to a unique integer for each broker.
broker.id=0
############################# Socket Server Settings #############################
# The address the socket server listens on. It will get the value returned from
# java.net.InetAddress.getCanonicalHostName() if not configured.
#   EXAMPLE:
#     listeners = PLAINTEXT://your.host.name:9092
# Maps listener names to security protocols, the default is for them to be the same. See the config documentation for more details
#listener.security.protocol.map=PLAINTEXT:PLAINTEXT,SSL:SSL,SASL_PLAINTEXT:SASL_PLAINTEXT,SASL_SSL:SASL_SSL

# FOR FUTURE SSL ConfigurationS : , SASL_PLAINTEXT://0.0.0.0:9093  AND FOR ADVERTISED.LISTNERS , SASL_PLAINTEXT://'${PARAMS2}':9093
listeners=SASL_PLAINTEXT://0.0.0.0:9092
advertised.listeners= SASL_PLAINTEXT://'${PARAMS2}':9092

security.inter.broker.protocol=SASL_PLAINTEXT
sasl.mechanism.inter.broker.protocol=PLAIN
sasl.enabled.mechanisms=PLAIN
ssl.keystore.location=/data/config/kafka.server.keystore.jks
ssl.keystore.password=password12
ssl.key.password=password12
ssl.truststore.location=/data/config/kafka.server.truststore.jks
ssl.truststore.password=password12
ssl.client.auth=required
ssl.keystore.type=JKS
ssl.truststore.type=JKS
#ssl.endpoint.identification.algorithm=
ssl.enabled.protocols=TLSv1.2
# without the next 2 lines kafka works fine but with no ACL
#authorizer.class.name=kafka.security.auth.SimpleAclAuthorizer
#super.users=User:admin
#allow.everyone.if.no.acl.found=false


# The number of threads that the server uses for receiving requests from the network and sending responses to the network
num.network.threads=3

# The number of threads that the server uses for processing requests, which may include disk I/O
num.io.threads=8

# The send buffer (SO_SNDBUF) used by the socket server
socket.send.buffer.bytes=102400

# The receive buffer (SO_RCVBUF) used by the socket server org.apache.kafka.common.network.InvalidReceiveException: Invalid receive (size = 369296128 larger than 524288)
socket.receive.buffer.bytes=102400

# The maximum size of a request that the socket server will accept (protection against OOM)
socket.request.max.bytes=104857600


############################# Log Basics #############################

# A comma separated list of directories under which to store log files
log.dirs=/data/log/kafka-logs

# The default number of log partitions per topic. More partitions allow greater
# parallelism for consumption, but this will also result in more files across
# the brokers.
num.partitions=2

# The number of threads per data directory to be used for log recovery at startup and flushing at shutdown.
# This value is recommended to be increased for installations with data dirs located in RAID array.
num.recovery.threads.per.data.dir=1

############################# Internal Topic Settings  #############################
# The replication factor for the group metadata internal topics "__consumer_offsets" and "__transaction_state"
# For anything other than development testing, a value greater than 1 is recommended to ensure availability such as 3.
offsets.topic.replication.factor=1
transaction.state.log.replication.factor=1
transaction.state.log.min.isr=1

############################# Log Retention Policy #############################

# The minimum age of a log file to be eligible for deletion due to age
log.retention.hours=168

# A size-based retention policy for logs. Segments are pruned from the log unless the remaining
# segments drop below log.retention.bytes. Functions independently of log.retention.hours.
#log.retention.bytes=1073741824

# The maximum size of a log segment file. When this size is reached a new log segment will be created.
log.segment.bytes=1073741824

# The interval at which log segments are checked to see if they can be deleted according
# to the retention policies
log.retention.check.interval.ms=300000
#############################Log level and file########################
log4j.rootLogger=TRACE, traceFile, stdout

log4j.appender.traceFile=org.apache.log4j.DailyRollingFileAppender
log4j.appender.traceFile.DatePattern='.'yyyy-MM-dd-HH
log4j.appender.traceFile.File=/data/log/kafka-logs/connect-worker-trace.log
log4j.appender.traceFile.layout=org.apache.log4j.PatternLayout
log4j.appender.traceFile.layout.ConversionPattern=[%d] %p %m (%c)%n

log4j.appender.stdout=org.apache.log4j.ConsoleAppender
log4j.appender.stdout.Threshold=INFO
log4j.appender.stdout.layout=org.apache.log4j.PatternLayout
log4j.appender.stdout.layout.ConversionPattern=[%d] %p %m (%c:%L)%n

#log4j.logger.org.apache.zookeeper=ERROR
#log4j.logger.org.I0Itec.zkclient=ERROR
#log4j.logger.org.reflections=ERROR
############################# Zookeeper #############################

# Zookeeper connection string (see zookeeper docs for details).
# This is a comma separated host:port pairs, each corresponding to a zk
# server. e.g. "127.0.0.1:3000,127.0.0.1:3001,127.0.0.1:3002".
# You can also append an optional chroot string to the urls to specify the
# root directory for all kafka znodes.
zookeeper.connect='${PARAMS1}':2181
# Timeout in ms for connecting to zookeeper
zookeeper.connection.timeout.ms=6000
zookeeper.set.acl=true

############################# Group Coordinator Settings #############################

# The following configuration specifies the time, in milliseconds, that the GroupCoordinator will delay the initial consumer rebalance.
# The rebalance will be further delayed by the value of group.initial.rebalance.delay.ms as new members join the group, up to a maximum of max.poll.interval.ms.
# The default value for this is 3 seconds.
# We override this to 0 here as it makes for a better out-of-the-box experience for development and testing.
# However, in production environments the default value of 3 seconds is more suitable as this will help to avoid unnecessary, and potentially expensive, rebalances during application startup.
group.initial.rebalance.delay.ms=0

auto.create.topics.enable=true
' > /data/config/server.properties

fi

chown root:kafka /data/config/server.properties
chown 640 /data/config/server.properties

FILE=/data/config/jaas.conf
if [ -f "$FILE" ]; then
    echo "Configuration file $FILE exists. Will start using old configuration"
else
echo $'
ZkClient {
  org.apache.zookeeper.server.auth.DigestLoginModule required
  serviceName="zookeeper"
  username="admin"
  password="'${PARAMS5}'$"
  user_admin="'${PARAMS5}'$"
  user_kafka="'${PARAMS4}'$";
};

KafkaServer {
  org.apache.kafka.common.security.plain.PlainLoginModule required
  username="admin"
  password="'${PARAMS5}'$"
  user_admin="'${PARAMS5}'$"
  user_kafka="'${PARAMS4}'$";
};
' >> /data/config/jaas.conf

chown root:kafka /data/config/jaas.conf
chown 640 /data/config/jaas.conf
fi

#sertificates for SSL
mv  /opt/kafka/config/ca-cert /data/config/ca-cert
mv  /opt/kafka/config/ca-key /data/config/ca-key
mv  /opt/kafka/config/kafka.server.truststore.jks /data/config/kafka.server.truststore.jks
mv  /opt/kafka/config/kafka.server.keystore.jks /data/config/kafka.server.keystore.jks
mv  /opt/kafka/config/ca-request-broker0 /data/config/ca-request-broker0
mv  /opt/kafka/config/ca-signed-broker0 /data/config/ca-signed-broker0
mv  /opt/kafka/config/ca-cert.srl /data/config/ca-cert.srl
mv  /opt/kafka/config/cert.pem /data/config/cert.pem

mv  /opt/kafka/config/client.properties /data/config/client.properties



#add security paramters to system
#export KAFKA_JVM_PERFORMANCE_OPTS="-Dzookeeper.sasl.client=true -Dzookeeper.sasl.clientconfig=ZkClient -Dzookeeper.sasl.client.username=kafka -Djava.security.auth.login.config=/opt/kafka/config/jaas.conf"
export KAFKA_OPTS="-Dzookeeper.sasl.client=true -Dzookeeper.sasl.clientconfig=ZkClient -Dzookeeper.sasl.client.username=kafka -Djava.security.auth.login.config=/data/config/jaas.conf"
echo ${KAFKA_OPTS}


#apply certificates to java with keystore tools
#cd /opt/kafka/config
#
#keytool -keystore kafka.server.truststore.jks -alias CA -import -file ca-cert -storepass password12 -trustcacerts -noprompt
#echo "step 1 done "
#keytool -keystore kafka.server.keystore.jks -alias localhost -validity 3650 -genkey -keyalg RSA -ext SAN=dns:kafka-broker0.localhost -storepass password12 -dname "cn=aziz, ou=dev, o=lqwd, c=ca" -keypass password12
#echo "step 2 done "
#keytool -keystore kafka.server.keystore.jks -alias localhost -certreq -file ca-request-broker0 -storepass password12
#echo "step 3 done "
#keytool -importkeystore -srckeystore kafka.server.keystore.jks -destkeystore kafka.server.keystore.jks -deststoretype pkcs12 -srcstorepass password12
#echo "step 4 done "
#openssl x509 -req -CA ca-cert -CAkey ca-key -in ca-request-broker0 -out ca-signed-broker0 -days 3650 -CAcreateserial -passin pass:password12
#echo "step 5 done "
#keytool -keystore kafka.server.keystore.jks -alias CA -import -file ca-cert -storepass password12 -trustcacerts -noprompt
#echo "step 6 done "
#keytool -keystore kafka.server.keystore.jks -alias localhost -import -file ca-signed-broker0 -storepass password12 -trustcacerts -noprompt
#echo "step 7 done "
#cd ..

#start broker
/opt/kafka/bin/kafka-server-start.sh /data/config/server.properties

#echo " Error starting bin bash "


#/bin/bash
#
tail -f /dev/null
#
#echo "Sleep expired"
