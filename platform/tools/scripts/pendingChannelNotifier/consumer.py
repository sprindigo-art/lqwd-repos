import codecs
import json
import socket
from datetime import datetime
from random import randint
import os

from confluent_kafka.avro import AvroConsumer
from python_lnd_grpc import python_lnd_grpc

import cipher_api_handler
from client_utils import make_api_call
from config_client import ConfigServerClient


class Consumer:

    def __init__(self, debug, reset, avro_key_schema, producer, grpc, macaroon, timeout, insecure):
        self.debug = debug
        self.reset = reset
        self.avro_key_schema = avro_key_schema
        self.producer = producer
        self.macaroon = macaroon
        self.grpc = grpc
        self.timeout = timeout
        self.insecure = insecure
        self.config = ConfigServerClient.get_instance()
        self.kafka_co_group_id = self.config.kafka_co_group_id
        self.ip = socket.gethostbyname(socket.gethostname())
        self.cipher_handler = cipher_api_handler.CipherAPIHandler()

        self.coCounter = 0
        self.poll_interval = 1
        self.consumer_config = {'bootstrap.servers': self.config.kafka_pro_host,
                                'group.id': self.config.kafka_co_group_id,
                                'auto.offset.reset': self.config.kafka_offset_reset,
                                'schema.registry.url': self.config.schema_host,
                                'sasl.username': self.config.user_kafka,
                                'sasl.mechanism': self.config.sasl_mechanism,
                                'sasl.password': self.config.user_kafka_pass,
                                'security.protocol': self.config.security_protocol}

        self.avro_consumer = AvroConsumer(self.consumer_config)

        self.error1 = {"error": "No response from LND"}

        self.poll_interval = 1

    def on_assign(self, c, ps):
        for p in ps:
            p.offset = -2
        c.assign(ps)

    def get_macaroon_and_tls_cert(self, service_address):

        admin_macaroon = self.cipher_handler.decrypt(service_address, "admin.macaroon")
        tls_cert = self.cipher_handler.decrypt(service_address, "tls.cert")

        if admin_macaroon is not None:
            self.create_macaroon_or_tls_file("admin.macaroon", admin_macaroon)

        if tls_cert is not None:
            self.create_macaroon_or_tls_file("tls.cert", tls_cert)

        return admin_macaroon, tls_cert

    def create_macaroon_or_tls_file(self, filename, data):
        file = open(filename, "wb")
        file.write(data)
        file.close()

    def subscribe_to_topic(self):

        if "192.168.1." in self.ip:
            self.kafka_co_group_id = 171

        if self.debug:
            print("IP: ", self.ip, "\nKafka Group ID: ", self.kafka_co_group_id)
        if self.reset:
            self.avro_consumer.subscribe([self.config.kafka_co_topic], on_assign=self.on_assign)
        else:
            self.avro_consumer.subscribe([self.config.kafka_co_topic])

        if self.debug:
            print(self.config.info_value_schema_url)

    def listen_for_messages(self):
        rpc = True
        if self.grpc:
            rpc = False

        while True:
            message = self.avro_consumer.poll(self.poll_interval)

            if message is None:
                continue

            if message.error():
                print("Consumer error: {}".format(message.error()))
                continue

            self.coCounter += 1

            if self.debug:
                print("\n ==== MSG COUNTER: ", self.coCounter, " ==== "
                                                               f"Kafka topic: {message.topic()}, partition: {message.partition()}, offset: {message.offset()}\n"
                                                               f"\tmessage key: {message.key()} \n\tmessage value: {message.value()}")
            self.avro_consumer.commit()
            self.process_message(message, rpc)

    def process_message(self, message, rpc):
        error = False
        error_text = None
        reply_msg = None
        try:
            # try and catch to splice if message polled is empty
            mid = message.value()['id']
            node_id = message.value()['node_id']
            username = message.value()['username']
            action = None
            action_field = 'requested_action'

            rpc_url = 'https://{nodeId}.lqwd-lnd:{nodePort}/'.format(nodeId=node_id, nodePort=self.config.lnd_rpc_port)
            macaroon, tls = self.get_macaroon_and_tls_cert(node_id)
            if macaroon is None or tls is None:
                raise Exception("Macaroon Details Not Found")

            headers = {'Grpc-Metadata-macaroon': codecs.encode(macaroon, 'hex')}

            grpc_obj = python_lnd_grpc.LNDMethods(
                tls_file_path="",
                tls_file_name="tls.cert",
                macaroon_filename="admin.macaroon",
                macaroon_path="",
                grpc_host=node_id,
                grpc_port=self.config.grpc_port,
                network="",
                output="json-none-included",
                macaroon_bytes=macaroon
            )

        except Exception as e:
            print(f"EXCEPTION: {e}")

        else:
            if self.debug:
                print("requested action: ", message.value()[action_field])

            action, url = self.determine_action_and_rest_endpoint(action, action_field, message, rpc_url)

            if action:
                write = True
                make_call = True
            else:
                action = message.value()[action_field]
                if self.debug: print("Do not understand action: ", action)
                write = True
                make_call = False
                error = True
                error_text = "Do not understand action: " + action

            if self.debug:
                print("ACTION: ", action)
            # =========================================================================#
            # EXECUTE MESSAGE ACTION

            if make_call:
                response = None
                exc = False
                if rpc:
                    response = make_api_call(url, headers, self.debug, self.insecure, self.timeout,
                                             os.getcwd() + "/tls.cert")
                if self.grpc:
                    try:
                        response = self.make_grpc_request(action, grpc_obj, response)
                    except Exception as e:
                        if self.debug:
                            print(f"EXCEPTION:  {e}")
                        exc = True
                if response:
                    if rpc:
                        data = json.loads(response.text)
                    if self.grpc:
                        data = str(response)
                    reply_msg = json.dumps(data)
                    print(reply_msg)

                else:
                    action = message.value()[action_field]
                    if self.debug:
                        print("Do not understand action: ", action)
                    write = True
                    error = True
                    error_text = "Do not understand action: " + action

                if self.debug:
                    print("ACTION: ", action)
                if exc:
                    error_text = "Exception thrown while trying to sumbit request " + action

            # =========================================================================#
            # SEND MESSAGE BACK TO KAFKA

            self.send_kafka_reply(action, error, error_text, mid, node_id, reply_msg, username, write)

    def send_kafka_reply(self, action, error, error_text, mid, node_id, reply_msg, username, write):
        description = "kafkaCoGroup_id: " + str(self.kafka_co_group_id)
        if write:
            timestamp = int(datetime.utcnow().timestamp())
            this_mid = randint(0, 10e8)
            if self.debug: print("WRITING TO KAFKA")
            key = ({"id": this_mid, "tactionName": action})
            value = ({"id": this_mid, "reply_id": mid, "timestamp": timestamp, "username": username,
                      "requested_action": action, "description": description, "reply_node_id": node_id,
                      "reply_message": reply_msg, "error": error, "error_desc": json.dumps(error_text)})

            kafka_producer = self.producer.connect()
            try:
                kafka_producer.produce(topic=self.config.kafka_pro_topic, key=key, value=value)
                kafka_producer.flush()
                if self.debug:
                    print("MSG SENT to ", self.config.kafka_pro_topic, "topic")
            except Exception as e:
                print("An error occurred when sending reply to kafka ".e)

    def make_grpc_request(self, action, grpc_obj, response):
        if action == "getinfo":
            response = grpc_obj.getinfo()
        elif action == "peers":
            response = grpc_obj.listpeers()
        elif action == "channels":
            response = grpc_obj.listchannels()
        elif action == "fees":
            response = grpc_obj.feereport()
        elif action == "getrecoveryinfo":
            response = grpc_obj.getrecoveryinfo()
        elif action == "graphinfo":
            response = grpc_obj.describegraph(True)
        elif action == "listpermissions":
            response = grpc_obj.listpermissions()
        elif action == "walletbalance":
            response = grpc_obj.walletbalance()
        elif action == "channelbalance":
            response = grpc_obj.channelbalance()
        return response

    def determine_action_and_rest_endpoint(self, action, action_field, message, rpc_url):
        if message.value()[action_field] == "getinfo" or message.value()[action_field] == "getInfo":
            action = "getinfo"
            url = rpc_url + "v1/getinfo"

        elif message.value()[action_field] == "peers":
            action = "peers"
            url = rpc_url + "v1/peers"

        elif message.value()[action_field] == "channels":
            action = "channels"
            url = rpc_url + "v1/channels"

        elif message.value()[action_field] == "fees":
            action = "fees"
            url = rpc_url + "v1/fees"

        elif message.value()[action_field] == "getrecoveryinfo" or message.value()[
            action_field] == "getRecoveryInfo":
            action = "getrecoveryinfo"
            url = rpc_url + "v1/getrecoveryinfo"

        elif message.value()[action_field] == "graphinfo" or message.value()[
            action_field] == "graphInfo":
            action = "graphinfo"
            url = rpc_url + "v1/graph/info"

        elif message.value()[action_field] == "listpermissions" or message.value()[
            action_field] == "listPermissions":
            action = "listpermissions"
            url = rpc_url + "v1/macaroon/permissions"

        elif message.value()[action_field] == "walletbalance" or message.value()[
            action_field] == 'walletBalance':
            action = "walletbalance"
            url = rpc_url + "v1/balance/blockchain"

        elif message.value()[action_field] == "channelbalance" or message.value()[
            action_field] == 'channelBalance':
            action = "channelbalance"
            url = rpc_url + "v1/balance/channels"

        elif message.value()[action_field] == "peers":
            action = "peers"
            url = rpc_url + "v1/peers"

        elif message.value()[action_field] == "channels":
            action = "channels"
            url = rpc_url + "v1/channels"

        elif message.value()[action_field] == "fees":
            action = "fees"
            url = rpc_url + "v1/fees"

        elif message.value()[action_field] == "getrecoveryinfo" or message.value()[
            action_field] == "getRecoveryInfo":
            action = "getrecoveryinfo"
            url = rpc_url + "v1/getrecoveryinfo"

        elif message.value()[action_field] == "graphinfo" or message.value()[
            action_field] == "graphInfo":
            action = "graphinfo"
            url = rpc_url + "v1/graph/info"

        elif message.value()[action_field] == "listpermissions" or message.value()[
            action_field] == "listPermissions":
            action = "listpermissions"
            url = rpc_url + "v1/macaroon/permissions"

        elif message.value()[action_field] == "walletbalance" or message.value()[
            action_field] == 'walletBalance':
            action = "walletbalance"
            url = rpc_url + "v1/balance/blockchain"

        elif message.value()[action_field] == "channelbalance" or message.value()[
            action_field] == 'channelBalance':
            action = "channelbalance"
            url = rpc_url + "v1/balance/channels"
        return action, url
