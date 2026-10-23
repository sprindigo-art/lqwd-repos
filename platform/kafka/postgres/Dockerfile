FROM postgres:13-beta1

MAINTAINER Aziz Pulatov <aziz@lqwd.money>

# Add Utility.
RUN apt-get update && apt-get -y install nano

#Add Python
RUN apt-get update && apt-get -y install python3
#Add Pip
RUN apt-get -y install python3-pip
#Add pexpect lib
RUN pip3 install pexpect
#Add psycopg2 lib
#RUN pip3 install psycopg2-binary
RUN apt-get install net-tools
##
VOLUME ["/data"]

ENV PGDATA=/data/db-files/newdb2
ENV POSTGRES_PASSWORD=postgresdocker#
ENV POSTGRES_USER=postgres
ENV POSTGRES_DB=demo1
ENV POSTGRES_PORT=5432

EXPOSE 5432

## Run the rest of the commands as the ``postgres``
#USER postgres
#
##COPY restore_database.sh /tmp/restore_database.sh
##COPY database.ini /tmp/database.ini
##COPY connect_db.py /tmp/connect_db.py
##COPY configdb.py /tmp/configdb.py
##COPY checkdb.py /tmp/checkdb.py
#
##COPY restore_database.sh /docker-entrypoint-initdb.d/restore_database.sh
#

COPY entrypoint.sh /usr/local/bin/
COPY init.sh /usr/local/bin/

ENTRYPOINT ["entrypoint.sh"]


CMD ["/usr/local/bin/init.sh", "$POSTGRES_PASSWORD", "$POSTGRES_USER", "$POSTGRES_DB", "$POSTGRES_PORT"]
