from datetime import time

from confluent_kafka.avro import AvroProducer

from client_utils import get_schema
from config_client import ConfigServerClient


class Producer:

    def __init__(self, debug):
        self.debug = debug
        # ============= Create a producer to send replies  ==================#
        self.config = ConfigServerClient.get_instance()
        self.producer_config = {'bootstrap.servers': self.config.kafka_pro_host,
                                'schema.registry.url': self.config.schema_host,
                                'sasl.username': self.config.user_kafka,
                                'sasl.mechanism': self.config.sasl_mechanism,
                                'sasl.password': self.config.user_kafka_pass,
                                'security.protocol': self.config.security_protocol}

    def connect(self):

        connected = False
        connected_avs = connected_aks = connected_rvs = connected_revs = False
        sleep_pause = 1

        while not connected:

            avro_value_schema = get_schema(self.config.info_value_schema_url, self.debug)
            if not avro_value_schema:
                connected_avs = False
                if self.debug:
                    print("Value Schema at not found!")
            else:
                connected_avs = True
                print("connected_avs")
            avro_key_schema = get_schema(self.config.info_key_schema_url)
            if not avro_key_schema:
                connected_aks = False
                if self.debug:
                    print("Key Schema at not found!")
            else:
                connected_aks = True
                print("connected_aks")

            request_value_schema = get_schema(self.config.request_value_schema_url)
            if not request_value_schema:
                connected_rvs = False
                if self.debug:
                    print(f"Schema at %s not found!" % self.config.request_value_schema_url)
            else:
                connected_rvs = True
                print("connected_rvs")

            reply_value_schema = get_schema(self.config.reply_value_schema_url)
            if not reply_value_schema:
                connected_revs = False
                if self.debug:
                    print(f"Schema at %s not found!" % self.config.reply_value_schema_url)
            else:
                connected_revs = True
                print("connected_revs")

            connected = connected_avs and connected_aks and connected_rvs and connected_revs
            if not connected:
                if self.debug:
                    print(f"Sleeping for %s seconds" % sleep_pause)
                time.sleep(sleep_pause)
                sleep_pause += 2
        if self.debug:
            print("Schemas OK")

        return AvroProducer(self.producer_config, default_key_schema=avro_key_schema,
                            default_value_schema=reply_value_schema)
