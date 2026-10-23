FROM ubuntu:18.04

MAINTAINER Aziz Pulatov <aziz@lqwd.money>

RUN apt-get update
#install OPENJDK 8 
RUN apt-get -y install openjdk-8-jdk

MAINTAINER Aziz Pulatov <aziz@lqwd.money>

#Add Utility Nano and wget.
RUN apt-get update && apt-get -y install nano

RUN apt-get -y install wget

RUN apt-get install net-tools

#declare env
ENV SCALA_VERSION 2.12
ENV KAFKA_VERSION 0.11.0.2
ENV KAFKA_HOME /opt/zookeeper

ENV USERPASS userpass
ENV ADMINPASS testpass


#declare arguments
ARG VERSION=3.6.3
ARG user=kafka
ARG group=kafka
ARG uid=1000
ARG gid=1000

#create group and user kakfka
RUN groupadd -g ${gid} ${group} \
  && useradd -M  -g ${group} -u ${uid} -s /bin/nologin ${user}

# Install  Zookeeper and created zoo.cfg file from zoo_sample.cfg
RUN  wget -q  http://muug.ca/mirror/apache-dist/zookeeper/zookeeper-${VERSION}/apache-zookeeper-${VERSION}-bin.tar.gz
RUN tar -xzf apache-zookeeper-${VERSION}-bin.tar.gz -C /opt
#move to /opt/zookeeper folder
RUN mv /opt/apache-zookeeper-${VERSION}-bin /opt/zookeeper
RUN rm apache-zookeeper-${VERSION}-bin.tar.gz
    
#Add java_home param (for checking run " dirname $(dirname $(readlink -f $(which javac)))")
ENV JAVA_HOME /usr/lib/jvm/java-8-openjdk-amd6

# for run command on docker "docker run -d -p 2181:2181 -p 2888:2888 -p 3888:3888 localhost:5000/kafkaz:7"
EXPOSE 2181 2888 3888

#Working Direcotry
WORKDIR /data/opt/zookeeper

#setting Zookeeper config file
VOLUME ["/data"]

#copy entrypoing and init files
COPY zookeeper_init.sh /usr/local/bin/
COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/zookeeper_init.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["entrypoint.sh"]
CMD ["/usr/local/bin/zookeeper_init.sh", "$USERPASS", "$ADMINPASS"]

#run in backgroud 
#sudo docker run -d -p 2181:2818 -p 2888:2888 -p 3888:3888 localhost:5000/kafkaz:latest
