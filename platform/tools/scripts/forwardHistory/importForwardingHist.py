# Python Script to import Forwading History of Routing Node
# Author: Joshua Jackson
# Date: Jan 5 202
# Version: 0.0.1
# !/usr/local/bin/python3
import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join('../../scripts/', '.')))

from datetime import datetime
import base64
import codecs
import psycopg2
import requests
from config.config import ConfigLND as Config
from forwardHistory.cipher_api_handler import CipherAPIHandler
from retrying import retry


class importForwardingHistory:

    def __init__(self, host, port, network, debug):
        try:
            self.host = host
            self.port = port
            self.network = network
            self.debug = debug
            self.tls_cert_path = "tls.cert"
        except Exception as e:
            print(f"Exception in __init__: {e}")

    # connect to Postgres DB
    def connect_to_postgres(self, database=None):
        try:

            # connect to DB and return connection
            if database is None:
                connection = psycopg2.connect(user=Config.dbuser, password=Config.dbpassword, host=Config.dbhost,
                                              port=Config.dbport, database=Config.dbname)
            else:
                connection = psycopg2.connect(user=Config.dbuser, password=Config.dbpassword, host=Config.dbhost,
                                              port=Config.dbport, database=database)

            return connection
        except Exception as e:
            print("Exception {}".format(e))

    # get macaroon file for node
    def create_macaroon_or_tls_file(self, filename, data):
        file = open(filename, "wb")
        file.write(data)
        file.close()

    # get macaroon data from db
    @retry(wait_fixed=10000)
    def get_macaroon_and_tls_cert(self, service_address, macaroon=True):
        try:
            cipher_api_handler = CipherAPIHandler()
            admin_macaroon = None
            tls_cert = None
            print(service_address)
            # set sql stmnt
            sql = "SELECT DISTINCT file_name, sfile, id FROM lnd_main_v2 WHERE node_name='{}' AND file_name LIKE " \
                  "'%admin.macaroon' OR node_name='{}' AND file_name LIKE '%tls.cert' LIMIT 2;".format(service_address,
                                                                                                       service_address,
                                                                                                       service_address)

            # get connection and create cursor
            con = self.connect_to_postgres()
            cursor = con.cursor()

            cursor.execute(sql)
            rows = cursor.fetchall()

            if self.debug:
                print(f"Getting Macroon File and TLS Cert - Row: {len(rows)}")

            # get admin macaroon file
            for row in rows:
                if 'admin.macaroon' in str(row[0]):
                    decrypted_data = cipher_api_handler.decrypt_macaroon(row[2])
                    print(decrypted_data)
                    admin_macaroon = base64.b64decode(decrypted_data)
                    if macaroon:
                        if self.debug: print("Creating Admin Macaroon File")
                        self.create_macaroon_or_tls_file("admin.macaroon", admin_macaroon)
                        if self.debug: print("Finished Admin Macaroon File")

                # get tls file
                if 'tls.cert' in str(row[0]):
                    tls_cert = row[1]
                    if self.debug: print("Creating TLS File")
                    self.create_macaroon_or_tls_file("tls.cert", tls_cert)
                    if self.debug: print("Finished TLS File")

            con.close()
            return admin_macaroon, tls_cert

        except Exception as e:
            print("Exception get_macaroon_and_tls_cert {}".format(e))
            print("Retrying in 10 Seconds")

    # get all lnd routing nodes from db
    def getLndRoutingNodes(self):
        try:

            sql = "SELECT lndnodename FROM lndnodeinfo WHERE is_routing_node=true;"

            # get connection and create cursor
            con = self.connect_to_postgres("oauth2")
            cursor = con.cursor()

            cursor.execute(sql)
            rows = cursor.fetchall()

            if self.debug:
                print(f"Getting LND Routing Node List - Row: {len(rows)}")

            return rows
        except Exception as e:
            print(f"getLndRoutingNodes: {e}")

    # create RPC call
    def create_rpc_call(self, lnd_node, action):
        try:
            macaroon, tls = self.get_macaroon_and_tls_cert(lnd_node)
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
            con = self.connect_to_postgres()
            for history in forwarding_history:
                sql_insert = "INSERT INTO forwarding_events(event_timestamp, chan_id_in, chan_id_out, amt_in, amt_out, fee, fee_msat, amt_in_msat, amt_out_msat, timestamp_ns, lnd_node) \
							  VALUES {} \
							  ON CONFLICT ON CONSTRAINT \
							  forwarding_events_chan_id_in_timestamp_ns_key \
							  DO NOTHING".format(history)

                sql_insert_chan_age_in = "INSERT INTO channel_info(chan_id, timestamp_ns) \
									   VALUES ({}, {}) \
									   ON CONFLICT(chan_id) \
									   DO UPDATE \
									   SET timestamp_ns = LEAST(channel_info.timestamp_ns, EXCLUDED.timestamp_ns)".format(
                    history[2], history[9])

                sql_insert_chan_age_out = "INSERT INTO channel_info(chan_id, timestamp_ns) \
						   VALUES ({}, {}) \
						   ON CONFLICT(chan_id) \
						   DO UPDATE \
						   SET timestamp_ns = LEAST(channel_info.timestamp_ns, EXCLUDED.timestamp_ns)".format(
                    history[1], history[9])

                cursor = con.cursor()
                cursor.execute(sql_insert)
                cursor.execute(sql_insert_chan_age_in)
                cursor.execute(sql_insert_chan_age_out)

            con.commit()
            cursor.close()
        except Exception as e:
            print("Exception {}".format(e))
