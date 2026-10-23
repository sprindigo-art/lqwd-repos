#!/bin/bash

cd swap-service
nohup  node index.js &
nohup node start.js &


tail -f /dev/null

echo "Sleep expired"
