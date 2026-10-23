#!/bin/sh

WENV=$1

STATS_DB_USER=$2
STATS_DB_PSSWD=$3

COINMARKETCAPAPI=$4

LND_DB_USER=$5
LND_DB_PSSWD=$6

CLIENT_ID=$7
CLIENT_SECRET=$8

echo "Working Environment"
echo ${WENV}

if [ "$WENV" = "dev" ]; then
    DBHOST="192.168.113.250"
    DBPORT="5433"
    DBNAME="stats"
    LND_DBNAME="lnd"
    LND_DBHOST="192.168.113.250"
    TOKEN_URL="http://oauth2.oauth2:8187/oauth/token"
    CIPHER_URL="http://cipher-service.microservice:8790"

elif [ "$WENV" = "stage" ]; then
    DBHOST="frontend.csxgoms2cude.us-east-2.rds.amazonaws.com"
    DBPORT="5433"
    DBNAME="stats"
    LND_DBNAME="lnd"
    LND_DBHOST="lnd.csxgoms2cude.us-east-2.rds.amazonaws.com"
    TOKEN_URL="http://oauth2.oauth2:8187/oauth/token"
    CIPHER_URL="http://cipher-service.microservice:8790"

elif [ "$WENV" = "production" ]; then
    DBHOST="frontend.csvn42eedrmo.us-west-2.rds.amazonaws.com"
    DBPORT="5433"
    DBNAME="stats"
fi

# create config file
# echo '#Config File for Tools
# class Config:
#     dbname = "'${STAT_DB}'"
#     dbuser = "'${STATS_USER}'"
#     dbpassword = "'${STATS_PASS}'"
#     dbhost = "'${STAT_HOST}'"
#     dbport = "'${STAT_PORT}'"
#     coinmarket_cap_api = "'${COINMARKETCAPAPI}'"

# class ConfigLND:
#     dbname = "'${ROUTING_DB}'"
#     dbuser = "'${ROUTING_USER}'"
#     dbpassword = "'${ROUTING_PASS}'"
#     dbhost = "'${ROUTING_HOST}'"
#     dbport = "'${ROUTING_PORT}'"
#     tokenURL = "'${TOKEN_URL}'"
#     clientId = "'${CLIENT_ID}'"
#     clientSecret = "'${CLIENT_SECRET}'"
#     cipherServiceURL = "'${CIPHER_URL}'"

# ' > /tools/scripts/config/config.py

#!/bin/bash
#
service cron status
service cron start & tail -f /var/log/cron.log
# tail -f /dev/null
#
#echo "Sleep expired"
