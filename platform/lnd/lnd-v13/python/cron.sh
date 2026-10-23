#!/bin/bash

for pid in $(pidof -x cron.sh); do
    if [ $pid != $$ ]; then
        echo "[$(date)] : cron.sh : Process is already running with PID $pid"
        exit 1
    fi
done


export $(xargs < /root/.env)

cd /root/python

python3 /root/python/cron.py