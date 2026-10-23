#!/bin/bash

lnclioption=""
macaroonstring=""
while [[ "$#" -gt 0 ]]
  do
    if [ $1 != '-macaroonstring' ]; then
      lnclioption="${lnclioption} $1"
    else
      macaroonstring="$2"
      shift
    fi
  shift
done


mkdir -p /tmp
tmp_file=/tmp/admin.macaroon
echo $macaroonstring | base64 -d > $tmp_file
lncli --macaroonpath $tmp_file $lnclioption
rm $tmp_file