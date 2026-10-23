# Python Script to import Channel Info of a Give LND Node
# Author: Joshua Jackson
# Date: Jan 5 202
# Version: 0.0.1
# !/usr/local/bin/python3
import sys, os
sys.path.insert(0, os.path.abspath(os.path.join('../../scripts/', '.')))


import requests, codecs
from datetime import datetime, timedelta
from reportTools.dbHandler import DbHandler


class importChannelInfo:

    def __init__(self, host, port, network, debug=True):
        try:
            self.host = host
            self.port = port
            self.network = network
            self.debug = debug
            self.tls_cert_path = "tls.cert"
            self.db = DbHandler()

        except Exception as e:
            print(f"Exception in __init__: {e}")

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

    def handle_closed_channel_info_json(self, rpc_json, lnd_node_id):
        try:
            channel_info_list = list()
            channel_info = dict()

            for data in rpc_json["channels"]:
                channel_info = {
                    "channel_id": data['chan_id'],
                    "channel_capacity": data['capacity'],
                    "remote_pubkey": data['remote_pubkey'],
                    "channel_point": data['channel_point'],
                    "fee_per_kw": data['fee_per_kw'],
                    "timestamp_ns": None,
                    "closing_tx_hash": data['closing_tx_hash'],
                    "lnd_node": lnd_node_id
                }
                channel_info_list.append(channel_info)

            return channel_info_list
        except Exception as e:
            print(f"Exception in handle_closed_channel_info")

    def handle_channel_info_json(self, rpc_json, lnd_node_id):
        try:

            channel_info_list = list()
            channel_info = dict()
            for data in rpc_json["channels"]:
                channel_info = {
                    "channel_id": data['chan_id'],
                    "channel_capacity": data['capacity'],
                    "remote_pubkey": data['remote_pubkey'],
                    "channel_point": data['channel_point'],
                    "fee_per_kw": data['fee_per_kw'],
                    "timestamp_ns": round((datetime.now() - timedelta(seconds=int(data['lifetime']))).timestamp()),
                    "lnd_node": lnd_node_id
                }
                channel_info_list.append(channel_info)
            return channel_info_list
        except Exception as e:
            print(f"Exception in handle_channel_info_json: {e}")

    def insert_channel_info(self, channel_info_list):
        try:
            rowcount = 0

            con = self.db.connect_to_postgres()
            cursor = con.cursor()
            i = 0
            total_channel = len(channel_info_list)
            for channel_info in channel_info_list:
                sql_insert_channel_info = "INSERT INTO channel_info(chan_id, timestamp_ns, channel_capacity,\
																	remote_pubkey, local_node, channel_point, fee_per_kw)\
										   VALUES ({}, {}, {}, '{}', '{}', '{}', {}) ON CONFLICT(chan_id) DO UPDATE \
										   SET timestamp_ns = LEAST(channel_info.timestamp_ns, EXCLUDED.timestamp_ns)" \
                    .format(channel_info['channel_id'], channel_info['timestamp_ns'], channel_info['channel_capacity'], \
                            channel_info['remote_pubkey'], channel_info['lnd_node'], channel_info['channel_point'],
                            channel_info['fee_per_kw'])

                cursor.execute(sql_insert_channel_info)
                if self.debug:
                    i += 1
                    print(f"Inserting Channels {i}/{total_channel}", end="\r")

                rowcount += cursor.rowcount
            con.commit()
            if self.debug:
                if cursor.rowcount != -1:
                    print(f"Successfully Inserted {rowcount} Rows into DB")
                else:
                    print(f"Failed to Insert Rows into DB")

            cursor.close()
        except Exception as e:
            print("Exception {}".format(e))
