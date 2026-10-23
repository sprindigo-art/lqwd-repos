# TODO: make the process of building faster by resolving dependancies before final build
FROM gradle:7.4.2-jdk11-alpine AS build
RUN gradle --version && java -version
COPY --chown=gradle:gradle . /pushserver
WORKDIR /pushserver

RUN gradle -Dorg.gradle.jvmargs=-Xmx2048M build -i --no-daemon --stacktrace

FROM openjdk:11-jre-slim

EXPOSE 7001
EXPOSE 7008

RUN mkdir /app

COPY --from=build /pushserver/build/libs/*.jar /app/push-server.jar
COPY /src/main/groovy/com/lqwd/zuul/push/filters /app/filters/

ENTRYPOINT ["java", "-Djava.security.egd=file:/dev/./urandom","-jar","/app/push-server.jar"]
