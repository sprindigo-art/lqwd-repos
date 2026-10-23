import os

import requests
import json
import codecs


class PeerConnect:

    def __init__(self, lnd_config):
        print("Starting peer connect")
        self.lnd_config = lnd_config

    def connect_to_top_nodes(self):

        if self.lnd_config["lndnetwork"] == 'regtest':
            return

        directory = f"/data/v3/{self.lnd_config['podname']}/data/chain/bitcoin/{self.lnd_config['lndnetwork']}/admin" \
                    f".macaroon"

        if os.path.exists(directory) is False:
            return

        file = open(directory, "rb")
        admin_content = file.read()
        file.close()

        response = requests.get('https://yalls.org/v0/graph/list/' + self.lnd_config["lndnetwork"], timeout=5)
        headers = {'Grpc-Metadata-macaroon': codecs.encode(admin_content, 'hex').decode("utf-8")}

        data = response.json()
        nodes = data["nodes"]
        node_count = len(nodes)
        if node_count >= 10:
            node_count = 10
        for x in range(0, node_count):
            node_adr = nodes[x]["address"].split("@")
            address = {"pubkey": node_adr[0], "host": node_adr[1]}
            self.connect_node_to_peers(headers, address)

    def connect_node_to_peers(self, header, address):
        data = json.dumps({"addr": address, "perm": False, "timeout": "5"})
        s = requests.Session()
        s.cert = 'tls.cert'
        response = requests.post("https://localhost:8080/v1/peers", verify=False, headers=header, data=data)
        print(response.text)
