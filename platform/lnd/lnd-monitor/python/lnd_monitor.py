# Created by Joshua Jackson
# Date: 2021-09-09
# File: lnd_monitor.py
# Project: lnd-monitor
# Version: 0.0.1
#
# LND Monitor Class will run async calls listening to a given node

# import python packages
import codecs
import json
from random import randint, seed
import socket

import requests
from retrying import retry
import os
from datetime import datetime
from aiohttp import ClientSession
from requests import HTTPError


class LndMonitor:

    def __init__(self, node_id, host, port, network, producer, debug=False):
        self.node_id = node_id
        self.host = host
        self.port = port
        self.network = network
        self.debug = debug
        self.producer = producer
        self.session = None
        self.tls_cert_path = "tls.cert"
        self.user_id = os.getenv("LND_USER")
        directory = f"/data/v3/{self.node_id}/data/chain/bitcoin/{self.network}/readonly.macaroon"
        file = open(directory, "rb")
        self.readonly_content = file.read()
        file.close()

    # for client session currently unused
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args, **kwargs):
        return self

    def send_to_kafka(self, action, data, topic):
        try:
            # simulating lnd monitor request here
            mid = randint(0, 10e8)
            timestamp = int(datetime.utcnow().timestamp())
            seed(timestamp)
            userid = randint(0, 10e6)
            nodeid = self.node_id

            key = ({"id": mid, "tactionName": action})
            value = (
                {
                    "id": mid,
                    "reply_id": mid,
                    "timestamp": timestamp,
                    "username": self.user_id,
                    "description": f"Kafka Message for {action} from {userid}",
                    "requested_action": action,
                    "reply_message": json.dumps(data),
                    "reply_node_id": nodeid,
                    "error": False,
                    "error_desc": None
                }
            )

            if self.debug:
                print(key)
                print(value)
            self.producer.produce(topic=topic, key=key, value=value)
            if self.debug:
                print("Sent Message to Kafka")
        except Exception as e:
            print("Exception in sendToKafka: {}".format(e))

    def is_lnd_node_active(self):
        try:
            a_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            location = (self.host, int(self.port))
            check_open_port = a_socket.connect_ex(location)
            if check_open_port != 0:
                if self.debug:
                    print(f"{self.host}:{self.port} - Node Not Available/Disconnected")

                self.send_to_kafka("RPC Port Check", '{"message":"Node Not Available/Disconnected"}',
                                   'lnd-status-monitor')
                return False

            return True
        except Exception as e:
            print(f"Exception in checkNodeActive: {e}")
            return False

    async def get_rpc_response(self, url, headers):
        try:
            response = await self.session.request("GET", url, headers=headers, ssl=self.tls_cert_path)
            response.raise_for_status()
            if self.debug:
                print(f"Response status {url} : {response.status}")
        except HTTPError as http_err:
            print(f"HTTP error occurred: {http_err}")
        except Exception as e:
            print("Exception in getRPCResponse: {}".format(e))

        response_json = await response.json()
        return response_json

    @retry(wait_fixed=5000)
    async def create_rpc_call(self, subscribe_action, topic):
        try:
            headers = {'Grpc-Metadata-macaroon': codecs.encode(self.readonly_content, 'hex').decode("utf-8"),
                       'CONNECTION': 'keep-alive'}

            url = f'https://{self.host}:{self.port}{subscribe_action}'

            print(f"URL: {url}")

            async with ClientSession(headers=headers, raise_for_status=True) as session:
                async with session.get(url, ssl=False) as resp:
                    async for line in resp.content:
                        print(subscribe_action + " : subscript_action now !!!")
                        if subscribe_action != '/v1/state/subscribe':
                            print("Topic " + topic)
                            self.send_to_kafka(subscribe_action, json.loads(line), topic)
                        self.update_node_info(subscribe_action)

        except Exception as e:
            print(f"An exception occurred in create rpc call: {e}")

    def update_node_info(self, action):
        if action == '/v1/transactions/subscribe':
            self.get_node_balance()
        if action == '/v1/state/subscribe':
            self.send_node_info()

    def get_node_balance(self):
        headers = {'Grpc-Metadata-macaroon': codecs.encode(self.readonly_content, 'hex').decode("utf-8")}

        resp = requests.get(f'https://localhost:8080/v1/balance/blockchain', verify=False,
                            headers=headers,
                            timeout=5)

        if resp.status_code != 200:
            print("monitor node balance error")
            return

        self.send_to_kafka("Node balance", json.loads(resp.content),
                           'lnd-node-balance')

    def send_node_info(self):
        headers = {'Grpc-Metadata-macaroon': codecs.encode(self.readonly_content, 'hex').decode("utf-8")}

        resp = requests.get(f'https://localhost:8080/v1/getinfo', verify=False,
                            headers=headers,
                            timeout=5)

        if resp.status_code != 200:
            print("monitor node info error")
            return

        self.send_to_kafka("Node info", json.loads(resp.content),
                           'lnd-node-info')
