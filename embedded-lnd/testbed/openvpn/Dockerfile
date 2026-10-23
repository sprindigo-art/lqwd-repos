# Built here rather than pulled from Docker Hub: the widely-used OpenVPN images
# are unmaintained, and this is meant to be a security layer.
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends openvpn easy-rsa iproute2 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Debian ships easyrsa in /usr/share/easy-rsa and does not put it on PATH.
ENV PATH="/usr/share/easy-rsa:${PATH}"
ENV EASYRSA="/usr/share/easy-rsa"
WORKDIR /etc/openvpn

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
