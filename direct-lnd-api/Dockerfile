### BUILD image
FROM ubuntu:18.04 as builder

MAINTAINER Aziz Pulatov <aziz@lqwd.money>

RUN apt-get update
#install OPENJDK 8
RUN apt-get -y install openjdk-8-jdk
#install wget
RUN apt-get -y install wget

RUN apt-get -y install nano

RUN apt-get install net-tools

#install maven
RUN apt-get update -y && apt-get install maven -y

# create app folder for sources
RUN mkdir -p /build
WORKDIR /build
COPY pom.xml /build
#Download all required dependencies into one layer
RUN mvn -B dependency:resolve dependency:resolve-plugins
#Copy source code
COPY src /build/src
# Build application
RUN mvn clean package


### RUN image
FROM ubuntu:18.04 as final

MAINTAINER Aziz Pulatov <aziz@lqwd.money>

RUN apt-get update
#install OPENJDK 8
RUN apt-get -y install openjdk-8-jdk
#install wget
RUN apt-get -y install wget

RUN apt-get -y install nano

RUN apt-get install net-tools
EXPOSE 8690
#Set app home folder
ENV APP_HOME /app

#Possibility to set JVM options
ENV JAVA_OPTS=""


#Create base app folder
RUN mkdir $APP_HOME

RUN mkdir $APP_HOME/config
RUN mkdir $APP_HOME/logs
WORKDIR $APP_HOME

#Copy executable jar file from the builder image
COPY --from=builder /build/target/*.jar app.jar

#copy entrypoing and init files
COPY init.sh /usr/local/bin/init.sh
COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/init.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
COPY secret.json $APP_HOME/config/secret.json
COPY src/main/resources/server.truststore $APP_HOME/config/server.truststore


ENV KUSERPASS 1
ENV KADMINPASS 2
ENV APPUSERNAME 3
ENV APPPASSWORD 4
ENV DBUSERNAME 5
ENV DBPASSWORD 6
ENV KSSLKEY 7
ENV WENV 8
ENV KBTOKEN 9
ENV KBCET 10
ENV AWSSECRET 11
ENV AWSACCESS 12


ENTRYPOINT ["entrypoint.sh"]


CMD ["/usr/local/bin/init.sh", "$KUSERPASS", "$KADMINPASS", "$APPUSERNAME", "$APPPASSWORD", "$DBUSERNAME", "$DBPASSWORD", "$KSSLKEY", "$WENV", "$KBTOKEN", "$KBCET", "$AWSSECRET", "$AWSACCESS"]

#ENTRYPOINT ["java","-jar","app.jar"]