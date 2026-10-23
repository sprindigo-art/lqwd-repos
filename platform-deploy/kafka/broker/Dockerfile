FROM ubuntu:18.04 as final

MAINTAINER Aziz Pulatov <aziz@lqwd.money>

RUN apt-get update
#install OPENJDK 8
RUN apt-get -y install openjdk-8-jdk
#install wget
RUN apt-get -y install wget

RUN apt-get -y install nano

RUN apt-get install net-tools

#declare env
ENV SCALA_VERSION 2.13
ENV KAFKA_VERSION 2.4.0
ENV KAFKA_HOME /opt/kafka_"$SCALA_VERSION"-"$KAFKA_VERSION"
ENV KAFKA_DOWNLOAD_URL https://archive.apache.org/dist/kafka/"$KAFKA_VERSION"/kafka_"$SCALA_VERSION"-"$KAFKA_VERSION".tgz
ENV KAFKA_HOME /opt/kafka


#install kafka broker
RUN wget -q $KAFKA_DOWNLOAD_URL -O /tmp/kafka_"$SCALA_VERSION"-"$KAFKA_VERSION".tgz
RUN tar xfz /tmp/kafka_"$SCALA_VERSION"-"$KAFKA_VERSION".tgz -C /opt && rm /tmp/kafka_"$SCALA_VERSION"-"$KAFKA_VERSION".tgz
RUN mv /opt/kafka_"$SCALA_VERSION"-"$KAFKA_VERSION" /opt/kafka



RUN chown -R root:root $KAFKA_HOME

#declare arguments
ARG user=kafka
ARG group=kafka
ARG uid=1000
ARG gid=1000

#create user
RUN groupadd -g ${gid} ${group} \
  && useradd -M  -g ${group} -u ${uid} -s /bin/nologin ${user}


EXPOSE 9092
EXPOSE 9093


# declare zookeeper connections
ENV ADV_LISTENERS 192.168.123.252
ENV ZOO_CONNECT zookeeper.kafka-v1
ENV USERPASS 123456
ENV ADMINPASS 654321

#data folder
VOLUME ["/data"]

#sertificates for SSL
COPY ca-cert /opt/kafka/config/
COPY ca-key /opt/kafka/config/
COPY kafka.server.truststore.jks /opt/kafka/config/
COPY kafka.server.keystore.jks /opt/kafka/config/
COPY ca-request-broker0 /opt/kafka/config/
COPY ca-signed-broker0 /opt/kafka/config/
COPY ca-cert.srl /opt/kafka/config/
COPY cert.pem /opt/kafka/config/

COPY client.properties /opt/kafka/config/
#copy entry point and init run
COPY entrypoint.sh /usr/local/bin/
COPY broker_init.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/broker_init.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

#confert init file to unix coding
RUN sed -i -e 's/\r$//' /usr/local/bin/broker_init.sh


ENTRYPOINT ["entrypoint.sh"]

CMD ["/usr/local/bin/broker_init.sh", "$ZOO_CONNECT", "$ADV_LISTENERS", "$KAFKA_HOME",  "$USERPASS", "$ADMINPASS"]

#ENTRYPOINT ["/opt/kafka/bin/kafka-server-start.sh", "/opt/kafka/config/server.properties"]

#CMD ["bin/bash"]
