FROM ubuntu:20.10 as builder
MAINTAINER Olufemi Thompson <olufemi@lqwd.money>

RUN apt-get update && apt-get -y install wget

ARG ETCD_VER=v3.5.1
ARG DOWNLOAD_URL=https://github.com/etcd-io/etcd/releases/download/v3.5.0/etcd-v3.5.0-linux-amd64.tar.gz

RUN wget -c ${DOWNLOAD_URL} -O - | tar -xz  -C /
RUN cd /etcd-v3.5.0-linux-amd64 && chmod +X etcd && chmod +X etcdctl && chmod +X etcdutl && mv ** /usr/local/bin

RUN mkdir -p /etcd/data/ && chmod g+rwX /etcd/data/

ENV ETCDCTL_API="3" \
    ETCD_ADVERTISE_CLIENT_URLS="http://0.0.0.0:2379" \
    ETCD_DATA_DIR="/etcd/data/" \
    ETCD_MAX_TXN_OPS="16384" \
    ETCD_LISTEN_CLIENT_URLS="http://0.0.0.0:2379"

EXPOSE 2379
EXPOSE 2380

COPY etcd.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/etcd.sh

CMD ["/usr/local/bin/etcd.sh"]
