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
KBTOKEN=$9
KBCET=${10}
AWSSECRET=${11}
AWSACCESS=${12}


echo " Working Environment"
echo ${WENV}

if [ "$WENV" = "development" ]; then
    DOMAIN="oauth2.oauth2"
    DBHOST="jdbc:postgresql://192.168.123.252:5435/lnd"
    IMAGE="localhost:32000/lnd"
    VOLUME="pv001-claim"
    LOGBACK="192.168.123.252"
elif [ "$WENV" = "stage" ]; then
    DOMAIN="oauth2.oauth2"
    DBHOST="jdbc:postgresql://192.168.113.50:5433/lnd"
    IMAGE="514063904685.dkr.ecr.us-west-2.amazonaws.com/lnd:sl.10"
    VOLUME="pv03-claim"
    LOGBACK="broker.kafka-v1"
elif [ "$WENV" = "production" ]; then
    DOMAIN="oauth2.oauth2"
    DBHOST="jdbc:postgresql://lnd.csvn42eedrmo.us-west-2.rds.amazonaws.com:5433/lnd"
    IMAGE="514063904685.dkr.ecr.us-west-2.amazonaws.com/lnd:pl.48"
    VOLUME="pv03-claim"
    LOGBACK="broker.kafka-v1"
fi

echo ${DBHOST}
echo "Db ip address"


# create application.propertis file
echo $'spring.profiles.active=dev
spring.application.name=direct-lnd-api
server.port=8690
logging.level.=DEBUG

logging.path=/app/logs/log.log

app.auth_post_url='${DOMAIN}'
app.auth_post_port=8187
app.auth_user_name='${APPUSERNAME}'
app.auth_password='${APPPASSWORD}'
app.auth_grand_type=password
app.encrypt_file=/app/config/secret.json

app.kubernetes.config.file=/app/config/config.kubernetes
#used for debug and access to kubernetes. For local=localhost, kubernetes = dev, stage, production
app.location=dev
grpc.client.target=tlnd3:8080
spring.tls.admin=/app/config/
app.truststore.password=aziz20
app.max_lnd_node=2
app.aws_region=us-west-2
app.aws_access_key='${AWSACCESS}'
app.aws_secret_key='${AWSSECRET}'
app.image_path='${IMAGE}'
app.volume.claim='${VOLUME}'
app.wenv='${WENV}'

app.logback.producer='${LOGBACK}'
app.logback.consumer='${LOGBACK}'
app.lnd_rpc_port=853

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

# ==============================================================
# DB parameters test
# ==============================================================

spring.datasource.url='${DBHOST}'
spring.datasource.username='${DBUSERNAME}'
spring.datasource.password='${DBPASSWORD}'


#maximum number of milliseconds that a client will wait for a connection
spring.datasource.hikari.connection-timeout=10000

#minimum number of idle connections maintained by HikariCP in a connection pool
spring.datasource.hikari.minimum-idle=10

#maximum pool size
spring.datasource.hikari.maximum-pool-size=50

#maximum idle time for connection
spring.datasource.hikari.idle-timeout=600000

# maximum lifetime in milliseconds of a connection in the pool after it is closed.
spring.datasource.hikari.max-lifetime=1800000

#default auto-commit behavior.
spring.datasource.hikari.auto-commit=true

spring.datasource.hikari.poolName=DLAJPAHikariCP
spring.datasource.hikari.testWhileIdle=true
spring.datasource.hikari.validationQuery=SELECT 1

logging.level.com.zaxxer.hikari=debug
spring.datasource.hikari.leak-detection-threshold=150000


# logs the SQL statements
hibernate.show_sql=true

# Logs the JDBC parameters passed to a query
log4j.logger.org.hibernate.type=trace


# ==============================================================
# = Hibernate ddl auto (create, create-drop, update)
# ==============================================================
spring.jpa.hibernate.ddl-auto = update

spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.PostgreSQL95Dialect
spring.jpa.properties.hibernate.format_sql=true
spring.jpa.properties.hibernate.id.new_generator_mappings=true
spring.jpa.properties.hibernate.jdbc.lob.non_contextual_creation=true

spring.datasource.initialization-mode=always

# logs the SQL statements
hibernate.show_sql=true

# Logs the JDBC parameters passed to a query
log4j.logger.org.hibernate.type=trace

logging.level.org.springframework.security.oauth2=debug
logging.level.org.springframework.web=DEBUG
logging.level.org.hibernate=ERROR
spring.http.log-request-details=true

logging.level.org.hibernate.SQL=debug
logging.level.org.hibernate.type.descriptor.sql=trace

twilio.account.sid=AC8a589f3871123cfb51b087b792f66e01
twilio.account.auth-token=463358ca9dd410fe2626c5336203ca89
twilio.verify.service-sid=VAba335b7bbb352a3ba5853c09f56db91a
' >/app/config/application.properties_delete


echo $'apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: '${KBCET}'
    server: https://kubernetes.default.svc:443
  name: microk8s-cluster
contexts:
- context:
    cluster: microk8s-cluster
    user: admin
  name: microk8s
current-context: microk8s
kind: Config
preferences: {}
users:
- name: admin
  user:
    token: '${KBTOKEN}'

' > /app/config/config.kubernetes

if [ "$WENV" = "stage" ]; then
   echo $'apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: '${KBCET}'
    server: https://kubernetes.default.svc:443
  name: lqwd-staging.local
contexts:
- context:
    cluster: lqwd-staging.local
    user: dla
  name: dla@lqwd-staging.local
current-context: dla@lqwd-staging.local
kind: Config
users:
- name: dla
  user:
    token: '${KBTOKEN}'

' > /app/config/config.kubernetes

elif [ "$WENV" = "production" ]; then
       echo $'apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: '${KBCET}'
    server: https://kubernetes.default.svc:443
  name: eks_lqwd-prod-eks-twDhBVwV
contexts:
- context:
    cluster: eks_lqwd-prod-eks-twDhBVwV
    user: dla
  name: dla@eks_lqwd-prod-eks-twDhBVwV
current-context: dla@eks_lqwd-prod-eks-twDhBVwV
kind: Config
users:
- name: dla
  user:
    token: '${KBTOKEN}'

' > /app/config/config.kubernetes

fi



#start application with applicantion properties file in parameter
java -Dspring.config.location=config/application.properties_delete -jar app.jar

#/bin/bash
#
tail -f /dev/null
#
#echo "Sleep expired"
