FROM ubuntu:18.04

MAINTAINER Aziz Pulatov <aziz@lqwd.money>

RUN apt-get update
#install OPENJDK 8 
RUN apt-get -y install openjdk-8-jdk
#install wget
RUN apt-get -y install wget
#install nano editor
RUN apt-get install nano

#install git
RUN apt-get -y install git

#install maven
RUN apt-get -y install maven

#clone repository
RUN git clone https://github.com/confluentinc/schema-registry
#change woring folder
WORKDIR /schema-registry
#checkout last version
RUN git checkout 5.4.1-post
#fix pom.xml error
RUN sed -i.bak 's/${confluent.maven.repo}/https:\/\/packages.confluent.io\/maven\//' pom.xml
#generate jar files
RUN mvn clean package -Dmaven.test.skip=true
#move jar file to correct folder
RUN mv package-schema-registry/target/kafka-schema-registry-package-5.4.1-package/share share

EXPOSE 8081
EXPOSE 2181

ENV ZOO_CONNECT zookeeper.kafka-v1
ENV USERPASS 123456
ENV ADMINPASS 654321



COPY schemaregistry_init.sh /usr/local/bin/
COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/schemaregistry_init.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["entrypoint.sh"]
CMD ["/usr/local/bin/schemaregistry_init.sh", "$ZOO_CONNECT",  "$USERPASS", "$ADMINPASS"]



#build sudo docker build -t localhost:5000/schemareg:latest .
#test : sudo docker run -it localhost:5000/schemareg:latest /bin/bash

