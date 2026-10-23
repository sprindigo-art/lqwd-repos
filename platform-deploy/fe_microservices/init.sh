#!/bin/bash

#input paramters 1-"$ZOO_CONNECT", 2-"$ADV_LISTENERS", 3-"$KAFKA_HOME",  4-"$USERPASS", 5-"$ADMINPASS"
KUSERPASS=$1
KADMINPASS=$2
APPUSERNAME=$3
APPPASSWORD=$4
DBUSERNAME=$5
DBPASSWORD=$6
KSSLKEY=$7
WENV=$8

echo " Working Environment"
echo ${WENV}


DOMAIN="oauth2.oauth2"

DBHOST="jdbc:postgresql://192.168.123.252:5435/lnd"

if [ "$WENV" = "stage" ]; then
    DBHOST="jdbc:postgresql://192.168.113.50:5433/lnd"
elif [ "$WENV" = "production" ]; then
    DBHOST="jdbc:postgresql://lnd.csvn42eedrmo.us-west-2.rds.amazonaws.com:5433/lnd"
fi


echo ${DBHOST}
echo "Db ip address"


# create application.propertis file
echo $'spring.profiles.active=dev
spring.application.name=lnd-advance-process
server.port=8590



app.auth_post_url='${DOMAIN}'


app.auth_post_port=8187
app.auth_user_name='${APPUSERNAME}'
app.auth_password='${APPPASSWORD}'
app.auth_grand_type=password


# postgres  ${DATABASE_URL}
spring.datasource.url='${DBHOST}'
spring.datasource.username='${DBUSERNAME}'
spring.datasource.password='${DBPASSWORD}'
spring.jpa.generate-ddl=true
spring.jpa.properties.hibernate.jdbc.lob.non_contextual_creation=true
spring.jpa.show-sql=true

#kafka spring.kafka.bootstrap-servers=localhost:9092,localhost:9093,localhost:9094
spring.kafka.bootstrap-servers=broker.kafka-v1:9092

spring.kafka.enable.auto.commit=true
spring.kafka.auto.commit.interval.ms=10000
spring.kafka.session.timeout.ms=30000
spring.kafka.consumer.timeout.ms=120000

spring.kafka.jaas.enabled=true
spring.kafka.properties.security.protocol=SASL_PLAINTEXT
spring.kafka.properties.sasl.mechanism=PLAIN
spring.kafka.properties.sasl.jaas.config=org.apache.kafka.common.security.plain.PlainLoginModule required username="admin" password="'${KADMINPASS}'" user_admin="'${KADMINPASS}'" user_kafka="'${KUSERPASS}'";

spring.kafka.admin.ssl.key-password='${KSSLKEY}'
spring.kafka.admin.ssl.key-store-location= file:src/main/resources/kafka.server.keystore.jks
spring.kafka.admin.ssl.key-store-password= '${KSSLKEY}'
spring.kafka.admin.ssl.trust-store-location= file:src/main/resources/kafka.server.truststore.jks
spring.kafka.admin.ssl.trust-store-password= '${KSSLKEY}'


spring.cloud.stream.default.producer.useNativeEncoding=true
spring.cloud.stream.default.consumer.useNativeEncoding=true
spring.cloud.stream.bindings.input.destination=tmessage-details
spring.cloud.stream.bindings.input.content-type=application/*+avro
spring.cloud.stream.bindings.input.group=group-1
spring.cloud.stream.bindings.input.concurrency=3
spring.cloud.stream.bindings.output.destination=tmessage-details
spring.cloud.stream.bindings.output.content-type=application/*+avro
spring.cloud.stream.kafka.binder.producer-properties.key.serializer=io.confluent.kafka.serializers.KafkaAvroSerializer
spring.cloud.stream.kafka.binder.producer-properties.value.serializer=io.confluent.kafka.serializers.KafkaAvroSerializer

spring.cloud.stream.kafka.binder.producer-properties.schema.registry.url=http://schemaregistry.kafka-v1:8081
spring.cloud.stream.kafka.binder.consumer-properties.key.deserializer=io.confluent.kafka.serializers.KafkaAvroDeserializer
spring.cloud.stream.kafka.binder.consumer-properties.value.deserializer=io.confluent.kafka.serializers.KafkaAvroDeserializer
spring.cloud.stream.kafka.binder.consumer-properties.schema.registry.url=http://schemaregistry.kafka-v1:8081

spring.cloud.stream.kafka.binder.consumer-properties.specific.avro.reader=true


' >/app/config/application.properties

#start application with applicantion properties file in parameter
java -Dspring.config.location=config/application.properties -jar app.jar

#/bin/bash
#
tail -f /dev/null
#
#echo "Sleep expired"
