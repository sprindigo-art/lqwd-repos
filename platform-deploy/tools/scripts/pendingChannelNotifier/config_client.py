import os
import sys

from config.spring import ConfigClient


class ConfigServerClient:
    __instance = None

    @staticmethod
    def get_instance():
        """ Static access method. """
        if ConfigServerClient.__instance is None:
            ConfigServerClient()
        return ConfigServerClient.__instance

    def __init__(self):
        if ConfigServerClient.__instance is not None:
            raise Exception("This class is a singleton!")
        else:
            self.config_client = ConfigClient(
                url="{address}/{branch}/{app_name}-{profile}.json"
            )
            self.sasl_mechanism = 'PLAIN'
            self.security_protocol = 'SASL_PLAINTEXT'
            self.schema_host = ""
            self.lnd_rpc_port = ""
            self.user_kafka_pass = ""
            self.user_kafka = "kafka"
            self.grpc_port = ""
            self.kafka_co_host = ''
            self.kafka_co_topic = ''
            self.kafka_co_group_id = ''
            self.kafka_offset_reset = '';
            self.kafka_pro_host = ''
            self.kafka_pro_topic = ''
            self.info_value_schema_url = ''
            self.info_key_schema_url = ''
            self.request_value_schema_url = ''
            self.reply_value_schema_url = ''
            self.tmessage_value_schema_url = ''
            self.tmessage_key_schema_url = ''
            self.cipher_base_url = ""
            self.token_url = ""
            self.client_id = ""
            self.client_secret = ""
            ConfigServerClient.__instance = self

    def get_config(self):
        try:
            self.config_client.get_config()
        except ConnectionError as ex:
            print(f"An error occurred when getting config {ex}")
            sys.exit(1)

    def get_config_obj(self) -> dict:
        return self.config_client.config

    def get_config_value(self, value):
        if type(value) is not str:
            return value
        if "${" not in value:
            return value
        s = value[2: len(value) - 1]
        return os.getenv(s)

    def set_configurations(self):
        self.get_config()
        self.sasl_mechanism = self.get_config_value(self.get_config_obj()
                                                    .get("app")["sasl_mechanism"])
        self.security_protocol = self.get_config_value(self.get_config_obj()
                                                       .get("app")["security_protocol"])
        self.schema_host = self.get_config_value(self.get_config_obj()
                                                 .get("app")["schema_host"])
        self.lnd_rpc_port = self.get_config_value(self.get_config_obj()
                                                  .get("app")["lnd_rpc_port"])
        self.user_kafka_pass = self.get_config_value(self.get_config_obj()
                                                     .get("app")["user_kafka_pass"])
        self.user_kafka = self.get_config_value(self.get_config_obj()
                                                .get("app")["user_kafka"])
        self.grpc_port = self.get_config_value(self.get_config_obj()
                                               .get("app")["grpc_port"])
        self.kafka_co_host = self.get_config_value(self.get_config_obj()
                                                   .get("app")["kafka_co_host"])
        self.kafka_co_topic = self.get_config_value(self.get_config_obj()
                                                    .get("app")["kafka_co_topic"])
        self.kafka_co_group_id = self.get_config_value(self.get_config_obj()
                                                       .get("app")["kafka_co_group_id"])
        self.kafka_offset_reset = self.get_config_value(self.get_config_obj()
                                                        .get("app")["kafka_offset_reset"])
        self.kafka_pro_host = self.get_config_value(self.get_config_obj()
                                                    .get("app")["kafka_pro_host"])
        self.kafka_pro_topic = self.get_config_value(self.get_config_obj()
                                                     .get("app")["kafka_pro_topic"])
        self.info_value_schema_url = self.get_config_value(self.get_config_obj()
                                                           .get("app")["info_value_schema_url"])
        self.info_key_schema_url = self.get_config_value(self.get_config_obj()
                                                         .get("app")["info_key_schema_url"])
        self.request_value_schema_url = self.get_config_value(self.get_config_obj()
                                                              .get("app")["request_value_schema_url"])
        self.reply_value_schema_url = self.get_config_value(self.get_config_obj()
                                                            .get("app")["reply_value_schema_url"])
        self.tmessage_value_schema_url = self.get_config_value(self.get_config_obj()
                                                               .get("app")["tmessage_value_schema_url"])
        self.tmessage_key_schema_url = self.get_config_value(self.get_config_obj()
                                                             .get("app")["tmessage_key_schema_url"])
        self.cipher_base_url = self.get_config_value(self.get_config_obj()
                                                     .get("app")["cipher_base_url"])
        self.token_url = self.get_config_value(self.get_config_obj()
                                               .get("app")["token_url"])
        self.client_id = self.get_config_value(self.get_config_obj()
                                               .get("app")["client_id"])
        self.client_secret = self.get_config_value(self.get_config_obj()
                                                   .get("app")["client_secret"])
