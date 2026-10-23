#!/bin/bash

#input parameter $ZOO_CONNECT,  "$USERPASS", "$ADMINPASS"
PARAMS1=$1
PARAMS2=$2
PARAMS3=$3

#create schema registry configuration file
echo $'
# The address the socket server listens on.
#   FORMAT:
#     listeners = listener_name://host_name:port
#   EXAMPLE:
#     listeners = PLAINTEXT://your.host.name:9092

listeners=http://0.0.0.0:8081

# Zookeeper connection string for the Zookeeper cluster used by your Kafka cluster
# (see zookeeper docs for details).
# This is a comma separated host:port pairs, each corresponding to a zk
# server. e.g. "127.0.0.1:3000,127.0.0.1:3001,127.0.0.1:3002".
kafkastore.connection.url='$PARAMS1$':2181
zookeeper.set.acl=true
kafkastore.sasl.mechanism = PLAIN
kafkastore.security.protocol = SASL_PLAINTEXT
sasl.enabled.mechanisms=PLAIN

security.inter.broker.protocol=SASL_PLAINTEXT
sasl.mechanism.inter.broker.protocol=PLAIN
sasl.enabled.mechanisms=PLAIN

# Alternatively, Schema Registry can now operate without Zookeeper, handling all coordination via
# Kafka brokers. Use this setting to specify the bootstrap servers for your Kafka cluster and it
# will be used both for selecting the master schema registry instance and for storing the data for
# registered schemas.
# (Note that you cannot mix the two modes; use this mode only on new deployments or by shutting down
# all instances, switching to the new configuration, and then starting the schema registry
# instances again.)
#kafkastore.bootstrap.servers=PLAINTEXT://localhost:9092

# The name of the topic to store schemas in
kafkastore.topic=schemas_registry

# If true, API requests that fail will include extra debugging information, including stack traces
debug=false

' > /schema-registry/config/schema-registry.properties

#create security access config file
echo $'
KafkaClient {
  org.apache.zookeeper.server.auth.DigestLoginModule required
  username="admin"
  password="'${PARAMS3}'$"
  user_admin="'${PARAMS3}'$"
  user_kafka="'${PARAMS2}'$";
};

KafkaServer {
  org.apache.kafka.common.security.plain.PlainLoginModule required
  username="admin"
  password="'${PARAMS3}'$"
  user_admin="'${PARAMS3}'$"
  user_kafka="'${PARAMS2}'$";
};
' >> /schema-registry/config/jaas.conf

#add security to system enviroment
export SCHEMA_REGISTRY_OPTS="-Dzookeeper.sasl.client=true -Dzookeeper.sasl.clientconfig=KafkaClient -Dzookeeper.sasl.client.username=kafka -Djava.security.auth.login.config=/schema-registry/config/jaas.conf"

#start schema registry
/schema-registry/bin/schema-registry-start /schema-registry/config/schema-registry.properties

echo " Error starting bin bash "


/bin/bash

tail -f /dev/null

echo "Sleep expired"