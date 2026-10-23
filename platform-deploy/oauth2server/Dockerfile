### BUILD image
FROM ubuntu as builder

MAINTAINER Aziz Pulatov <aziz@lqwd.money>

RUN apt-get update
#install OPENJDK 8
RUN apt-get -y install openjdk-8-jdk
#install wget
RUN apt-get -y install wget

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
RUN mvn clean package -Dmaven.test.skip=true


### RUN image
FROM ubuntu as final

MAINTAINER Aziz Pulatov <aziz@lqwd.money>

RUN apt-get update -y

#install OPENJDK 8
RUN apt-get -y install openjdk-8-jdk

RUN apt-get -y install nano

EXPOSE 8180
#Set app home folder
ENV APP_HOME /app

#Possibility to set JVM options
ENV JAVA_OPTS=""


#Create base app folder
RUN mkdir $APP_HOME

RUN mkdir $APP_HOME/config

WORKDIR $APP_HOME

#Copy executable jar file from the builder image
COPY --from=builder /build/target/*.jar app.jar


#ENTRYPOINT ["java","-jar","app.jar"]
CMD ["java","-jar","app.jar","--debug"]
