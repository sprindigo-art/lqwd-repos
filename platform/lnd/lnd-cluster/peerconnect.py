import requests
import psycopg2
import json
import codecs

import cipherservice
import config

db_config = config.read_config('database.ini', 'postgresql')
# read lnd configuration paramters
lnd_config = config.read_config('lnd.ini', 'lnd')


class PeerConnect:

    def __init__(self):
        print("Starting peer connect")
        self.connection = psycopg2.connect(user=db_config["user"], password=db_config["password"],
                                           host=db_config["host"], port=db_config["port"],
                                           database=db_config["database"])
        self.cipher_service = cipherservice.CipherService(lnd_config, True)

    def get_node_list_from_db(self):
        print("getting node list")
        try:
            sql = "SELECT DISTINCT externalip FROM lnd_main"
            # get connection and create cursor
            cursor = self.connection.cursor()

            cursor.execute(sql)
            rows = cursor.fetchall()

            # self.connection.close()
            return rows

        except Exception as e:
            print("Exception {}".format(e))
            print("Retrying in 5 Seconds")

    def close_connection(self):
        self.connection.close()

    def create_macaroon_or_tls_file(self, filename, data):
        file = open(filename, "wb")
        file.write(data)
        file.close()

    def connect_to_our_nodes(self):

        db_nodes = peer.get_node_list_from_db()
        for node in db_nodes:
            try:
                node_id = node[0]

                print(f"connecting to {node_id}..")

                # skip so you don't try to connect to yourself
                if node_id == lnd_config["podname"]:
                    continue

                macaroon, tls = self.cipher_service.get_macaroon_and_tls_cert(node_id)

                if macaroon is not None:
                    s = requests.Session()
                    s.cert = 'tls.cert'
                    headers = {'Grpc-Metadata-macaroon': codecs.encode(macaroon, 'hex')}
                    try:
                        response = requests.get(f'https://{node_id}:8080/v1/getinfo', verify=False, headers=headers,
                                                timeout=5)
                        print(response.status_code)
                        if response.status_code == 200:
                            print(f"proceeding to connect {node_id}")
                            address = {"pubkey": response.json()["identity_pubkey"], "host": node_id + ':9735'}
                            macaroon, tls = self.cipher_service.get_macaroon_and_tls_cert(lnd_config["podname"])
                            headers = {'Grpc-Metadata-macaroon': codecs.encode(macaroon, 'hex')}
                            self.connect_node_to_peers(headers, address)

                    except requests.exceptions.RequestException as e:
                        print("Exception {}".format(e))

            except Exception as e:
                print("Exception {}".format(e))
                print("Retrying in 5 Seconds")

    def connect_to_top_nodes(self):
        response = requests.get('https://yalls.org/v0/graph/list/' + lnd_config["lndnetwork"], timeout=5)
        # get macaroon from db
        macaroon, tls = self.cipher_service.get_macaroon_and_tls_cert(lnd_config["podname"])
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
        response = requests.post("https://localhost:8080/v1/peers", verify=False, headers=header, data=data)
        print(response.text)


if __name__ == "__main__":
    peer = PeerConnect()
    if lnd_config["lndnetwork"] != 'regtest':
        peer.connect_to_top_nodes()
    else:
        peer.connect_to_our_nodes()
    peer.close_connection()
    print("Completed peering ............")
