apt-get update && apt-get -y install nano && apt-get install net-tools \
    && apt-get -y install jq\
    && apt-get -y install wget\
    && apt-get -y install python3\
    && apt-get -y install git\
    && apt-get -y install python3-pip\
    && apt-get -y install python3-psycopg2\
    && apt-get -y install awscli\
    && pip3 install --no-cache-dir pexpect \
    && pip3 install --no-cache-dir python-lnd-grpc\
    && pip3 install --no-cache-dir requests\
    && pip3 install --no-cache-dir psycopg2\
    && pip3 install --no-cache-dir redis\
    && pip3 install boto3\
    && pip3 install --no-cache-dir grpcio grpcio-tools googleapis-common-protos\
    && pip3 install --no-cache-dir avro-python3 aiohttp confluent-kafka retrying\
    && pip3 install --no-cache-dir --no-binary=protobuf protobuf\
    && pip3 install awsebcli --upgrade