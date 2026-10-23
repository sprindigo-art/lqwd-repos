# Python Script to import Forwading History of Routing Node
# Author: Joshua Jackson
# Date: Jan 5 202
# Version: 0.0.1
# !/usr/local/bin/python3
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join('../../scripts/', '.')))

from datetime import datetime
import codecs
import requests
from reportTools.dbHandler import DbHandler


class ImportForwardingHistory:

    def __init__(self, host, port, network, debug):
        try:
            self.host = host
            self.port = port
            self.network = network
            self.debug = debug
            self.tls_cert_path = "tls.cert"
            self.db = DbHandler()
        except Exception as e:
            print(f"Exception in __init__: {e}")

    # get all lnd routing nodes from db
    def get_lnd_routing_nodes(self):
        try:

            sql = "SELECT lndnodename FROM lndnodeinfo WHERE is_routing_node=true;"

            # get connection and create cursor
            con = self.db.connect_to_postgres("oauth2")
            cursor = con.cursor()

            cursor.execute(sql)
            rows = cursor.fetchall()

            if self.debug:
                print(f"Getting LND Routing Node List - Row: {len(rows)}")

            return rows
        except Exception as e:
            print(f"get_lnd_routing_nodes: {e}")

    # create RPC call
    def create_rpc_call(self, lnd_node, action):
        try:
            macaroon, tls = self.db.get_macaroon_and_tls_cert(lnd_node)
            if macaroon is None or tls is None:
                raise Exception("Macaroon Details Not Found")

            headers = {'Grpc-Metadata-macaroon': codecs.encode(macaroon, 'hex')}
            url = f'https://{lnd_node}.{self.host}:{self.port}{action}'

            if self.debug:
                print(f"Request\n Headers: {headers}\nURL: {url}")

            r = requests.post(url, headers=headers, verify=self.tls_cert_path)
            print(r, r.json())

            return r.json()
        except Exception as e:
            print(f"Exception in createRPCCall: {e}")

    def handle_forwarding_history_json(self, rpc_json, lnd_node_id):
        try:
            forwarding_history = list()
            for data in rpc_json["forwarding_events"]:
                tmp_tuple = ()
                for key, val in data.items():
                    if key == "timestamp":
                        local_time = datetime.utcfromtimestamp(int(val))
                        tmp_tuple += (local_time.strftime("%Y-%m-%d %H:%M:%S"),)
                    else:
                        tmp_tuple += (val,)
                tmp_tuple += (lnd_node_id,)
                forwarding_history.append(tmp_tuple)

            return forwarding_history
        except Exception as e:
            print(f"Exception in handle_forwarding_history_json {e}")

    def insert_forwarding_history(self, forwarding_history):
        try:
            con = self.db.connect_to_postgres()
            cursor = con.cursor()
            lnd_node = None

            i = 0
            total_forwards = len(forwarding_history)
            for history in forwarding_history:
                lnd_node = history[-1]
                sql_insert = "INSERT INTO forwarding_events(event_timestamp, chan_id_in, chan_id_out, amt_in, amt_out, fee, fee_msat, amt_in_msat, amt_out_msat, timestamp_ns, lnd_node) \
							  VALUES {} \
							  ON CONFLICT ON CONSTRAINT \
							  forwarding_events_chan_id_in_timestamp_ns_key \
							  DO NOTHING".format(history)
                cursor.execute(sql_insert)
                if self.debug:
                    i += 1
                    print(f"Inserting Forwards {i}/{total_forwards}", end="\r")

            con.commit()
            cursor.close()
        except Exception as e:
            print("Exception {}".format(e))
