#!/bin/bash

#input paramters "
POSTGRES_PASSWORD=$1
POSTGRES_USER=$2
POSTGRES_DB=$3
POSTGRES_PORT=$4

## And add ``listen_addresses`` to ``/etc/postgresql/9.3/main/postgresql.conf``
#echo "port = $POSTGRES_PORT" >> /data/db-files/postgresql.conf
# then create a database `docker` owned by the ``docker`` role.
# Note: here we use ``&&\`` to run commands one after the other - the ``\``
#       allows the RUN command to span multiple lines.

#pg_createcluster --start-conf=auto -p=$POSTGRES_PORT 13 main
#
#echo "host all  all    0.0.0.0/0  md5" >> /data/newdb/pg_hba.conf
#
#pg_ctlcluster /data/db-file/newdb/13 main start
##
##
##
#/etc/init.d/postgresql start
##
##psql --command "CREATE USER $POSTGRES_USER WITH SUPERUSER PASSWORD '$POSTGRES_PASSWORD';"
##
##createdb -O  $POSTGRES_USER $POSTGRES_DB
#
##
tail -f /dev/null
##
##echo "Sleep expired"
#pg_ctl -D "/data/db-files"   -o "-c listen_addresses='' -p '5432'"  -w start