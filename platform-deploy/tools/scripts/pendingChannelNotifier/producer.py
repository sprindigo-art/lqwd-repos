import os
from datetime import time

from confluent_kafka.avro import AvroProducer

from client_utils import get_schema


class Producer:

    def __init__(self, debug):
        self.debug = debug
        # ============= Create a producer to send replies  ==================#
        self.config = dict({
            'kafka_host': os.getenv("KAFKA_HOST"),
            'schema_host': os.getenv("SCHEMA_HOST"),
            'user_kafka': os.getenv("KAFKA_USER"),
            'sasl_mechanism': "PLAIN",
            'user_kafka_pass': os.getenv("KAFKA_PASS"),
            'security_protocol': "SASL_PLAINTEXT",
            'kafka_co_group_id': "334",
            'kafka_offset_reset': "earliest",
            'request_value_schema_url': os.getenv("SCHEMA_HOST")+"/subjects/send-email-value/versions/latest",
            'reply_value_schema_url': os.getenv("SCHEMA_HOST")+"/subjects/reply-key/versions/latest"
        })
        
        print(self.config)
        
        self.producer_config = {'bootstrap.servers': self.config['kafka_host'],
                                'schema.registry.url': self.config['schema_host'],
                                'sasl.username': self.config['user_kafka'],
                                'sasl.mechanism': self.config['sasl_mechanism'],
                                'sasl.password': self.config['user_kafka_pass'],
                                'security.protocol': self.config['security_protocol']}
    
    def connect(self):

        connected = False
        connected_avs = connected_aks = False
        sleep_pause = 1

        while not connected:

            avro_value_schema = get_schema(self.config["request_value_schema_url"], self.debug)
            if not avro_value_schema:
                connected_avs = False
                if self.debug:
                    print("Value Schema at not found!")
            else:
                connected_avs = True
                print("connected_avs")
            avro_key_schema = get_schema(self.config["reply_value_schema_url"])
            if not avro_key_schema:
                connected_aks = False
                if self.debug:
                    print("Key Schema at not found!")
            else:
                connected_aks = True
                print("connected_aks")

            connected = connected_avs and connected_aks
            if not connected:
                if self.debug:
                    print(f"Sleeping for %s seconds" % sleep_pause)
                time.sleep(sleep_pause)
                sleep_pause += 2
        if self.debug:
            print("Schemas OK")
            
        print(avro_value_schema)
        # print(avro_key_schema)
        
        return AvroProducer(self.producer_config,
                            default_key_schema=avro_key_schema,
                            default_value_schema=avro_value_schema)
