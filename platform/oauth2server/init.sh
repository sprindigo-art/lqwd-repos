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

if [ "$WENV" = "dev" ]; then
    DBHOST="jdbc:postgresql://192.168.123.252:5433/oauth2"
    MAILCONFIRM="http://192.168.123.252:8580"
elif [ "$WENV" = "stage" ]; then
    DBHOST="jdbc:postgresql://192.168.113.50:5433/oauth2"
    MAILCONFIRM="http://stage.lqwd.tech:30100"
elif [ "$WENV" = "production" ]; then
    DBHOST="jdbc:postgresql://oauth2.csvn42eedrmo.us-west-2.rds.amazonaws.com:5433/oauth2"
    MAILCONFIRM="https://lqwd.tech"
fi




# create application.propertis file
echo $'spring.profiles.active=dev,postgres
logging.level.org.springframework.security=DEBUG
server.port=8187

spring.resource.server.config.resource_id=resource-server-rest-api

# ==============================================================
#token secret key and validity time in second
# ==============================================================
jwt.secret=lqwd_1st_secret123
jwt.token.validity=18000
app.mail_confirmation_link='${MAILCONFIRM}'
# ==============================================================
# DB parameters
# ==============================================================

spring.datasource.url='${DBHOST}'

spring.datasource.username='${DBUSERNAME}'
spring.datasource.password='${DBPASSWORD}'

spring.datasource.hikari.connection-timeout=40000
  #maximum number of milliseconds that a client will wait for a connection
spring.datasource.hikari.minimum-idle=10
  #minimum number of idle connections maintained by HikariCP in a connection pool
spring.datasource.hikari.maximum-pool-size=40
   #maximum pool size
spring.datasource.hikari.idle-timeout=20000
  #maximum idle time for connection
spring.datasource.hikari.max-lifetime=2000
  # maximum lifetime in milliseconds of a connection in the pool after it is closed.
spring.datasource.hikari.auto-commit=true
  #default auto-commit behavior.


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

#logging.level.org.hibernate.SQL=DEBUG
#logging.level.org.hibernate.type.descriptor.sql.BasicBinder=TRACE
#logging.level.org.hibernate.type=trace

# ==============================================================
# = Spring Security / Queries for AuthenticationManagerBuilder
# ==============================================================
spring.queries.users-query=select user_name as email, password, enabled as active from user_ where user_name=?
spring.queries.email-query=select email, password, enabled as active from user_ where email=?
spring.queries.roles-query-user=select u.email as email, r.name as role from user_ u inner join user_role ur on(u.id=ur.user_id) inner join role_ r on(ur.role_id=r.id) where u.user_name=?
spring.queries.roles-query-email=select u.email as email, r.name as role from user_ u inner join user_role ur on(u.id=ur.user_id) inner join role_ r on(ur.role_id=r.id) where u.email=?

###### Email Properties ######
#smtp mail properties
spring.mail.host=email-smtp.us-west-2.amazonaws.com
spring.mail.port=587
spring.mail.username=AKIAXPMEYV6W7LFVOA4M
spring.mail.password=BBKhT4FygAljwcrIzW+nIQXiHNMXLaL3v8oru2eg2JOm
spring.mail.properties.mail.smtp.auth=true
spring.mail.properties.mail.smtp.starttls.enable=false
spring.mail.properties.mail.smtp.starttls.required=false

' >/app/config/application.properties

#start application with applicantion properties file in parameter
java -Dspring.config.location=config/application.properties -jar app.jar

#/bin/bash
#
tail -f /dev/null
#
#echo "Sleep expired"
