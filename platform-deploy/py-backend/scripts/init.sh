#!/bin/bash

APP_NAME=$1
BRANCH=$2
PROFILE=$3
CONFIG_FAIL_FAST=$4
CLIENT_ID=$5
CLIENT_SECRET=$6
KUSERPASS=$7
CONFIGSERVER_ADDRESS=$8


#start application with applicantion properties file in parameter
. /opt/venv/bin/activate && python3 -u client.py --debug

#
tail -f /dev/null
