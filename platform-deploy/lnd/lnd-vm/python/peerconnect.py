import requests
import json
import codecs

import cipherservice
import config
import os

lnd_config = config.read_config('lnd.ini', 'lnd')


class PeerConnect:

    def __init__(self):
        print("Starting peer connect")
        self.pod_name = os.getenv("LND_POD_NAME")
        self.lnd_network = os.getenv("LND_NETWORK")
        lnd_config['dir_name'] = self.root_dir() + "/" + self.pod_name
        self.cipher_service = cipherservice.CipherService(lnd_config, True)

    def create_macaroon_or_tls_file(self, filename, data):
        file = open(filename, "wb")
        file.write(data)
        file.close()

    def connect_to_top_nodes(self):
        response = requests.get('https://yalls.org/v0/graph/list/' + self.lnd_network, timeout=5)
        # get macaroon from db
        macaroon, tls = self.cipher_service.get_macaroon_and_tls_cert(self.pod_name)
        headers = {'Grpc-Metadata-macaroon': codecs.encode(macaroon, 'hex')}

        data = response.json()
        nodes = data["nodes"]
        for x in range(0, 10):
            node_adr = nodes[x]["address"].split("@")
            address = {"pubkey": node_adr[0], "host": node_adr[1]}
            self.connect_node_to_peers(headers, address)

    def connect_node_to_peers(self, header, address):
        data = json.dumps({"addr": address, "perm": False, "timeout": "5"})
        s = requests.Session()
        s.cert = 'tls.cert'
        response = requests.post("https://127.0.0.1:8080/v1/peers", verify=False, headers=header, data=data)
        print(response.text)

    def root_dir(self):
        if 'datadir' in lnd_config:
            return lnd_config['datadir']
        else:
            return "/data/v3"


if __name__ == "__main__":
    peer = PeerConnect()
    if os.getenv("LND_NETWORK") != 'regtest':
        peer.connect_to_top_nodes()
