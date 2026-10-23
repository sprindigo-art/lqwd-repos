# lnurl-gateway

nginx, standing in for the public side of the payment gateway.

The appliance takes no inbound connections from the internet, so it cannot
host the URL an LNURL-pay wallet has to fetch. This does it instead, and
proxies to the device over the management VPN — the tunnel the device dialled
out to. See [nginx.conf](nginx.conf) and [../LNURL-DEMO.md](../LNURL-DEMO.md).

In this testbed it listens on `127.0.0.1:8088` inside the VPN container's
network namespace, with no TLS: it is reachable with `docker exec`, and from
nowhere else. A real deployment terminates TLS here and serves a real name.
