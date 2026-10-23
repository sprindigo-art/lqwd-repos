FROM ubuntu:20.04
RUN apt-get update && apt-get -y install nano && apt-get install net-tools \
        && apt-get -y install jq\
        && apt-get -y install wget\
        && apt-get -y install python3\
        && apt-get -y install python3-pip\
        && apt-get -y install python3-psycopg2\
        && pip3 install --no-cache-dir pexpect \
        && pip3 install --no-cache-dir python-lnd-grpc\
        && pip3 install --no-cache-dir requests\
        && pip3 install --no-cache-dir psycopg2\
        && pip3 install --no-cache-dir redis\
        && pip3 install --no-cache-dir grpcio grpcio-tools googleapis-common-protos\
        && pip3 install --no-cache-dir avro-python3 aiohttp confluent-kafka  retrying\
        && pip3 install --no-cache-dir --no-binary=protobuf protobuf

RUN apt-get install -y  git

ENTRYPOINT ["tail", "-f", "/dev/null"]