# Created by Joshua Jackson
# Date: 2021-08-23
# File: lnd_monitor.py
# Project: lnd-monitor
# Version: 0.0.1
#
# Class to Monitor LND Node
# Currently Uses BackEndReply schema for values and TmessageKey schema for key for Sending to Kafka

import asyncio
import json

import requests

from confluent_kafka import avro
import config as config
from confluent_kafka.avro import AvroProducer
from lnd_monitor import LndMonitor
from confluent_kafka.schema_registry import SchemaRegistryClient, Schema


class RunLndMonitor:
    def __init__(self, producer, lnd_name, host, network, port, debug):
        self.lndMonitor = LndMonitor(lnd_name, host, port, network, producer, debug)
        self.loop = asyncio.get_event_loop()
        self.actions = [
            ["/v1/invoices/subscribe", "lnd-invoice-monitor"],
            ["/v1/channels/subscribe", "lnd-channel-monitor"],
            ["/v1/transactions/subscribe", "lnd-transaction-monitor"],
            ["/v1/state/subscribe", "lnd-state-monitor"],
            ["/v2/router/htlcevents", "lnd-htlc-event-monitor"]
        ]

    def run_async_program(self):
        self.loop.run_until_complete(self.get_subscribe_calls())
        return self.lndMonitor.is_lnd_node_active()

    async def get_subscribe_calls(self):
        async with self.lndMonitor as lm:
            return await asyncio.gather(*[lm.create_rpc_call(action[0], action[1]) for action in self.actions])


def create_avro_schema_key_and_value(schema_host):
    sr = SchemaRegistryClient({"url": schema_host})
    value_schema = avro.load("avro/lnd-transaction-schema.avsc")
    key_schema = avro.load("avro/transaction-key-schema.avsc")

    status_code, _ = get_schema(schema_host + "/subjects/reply-value/versions/latest")

    if status_code == 404:
        avro_schema = Schema(json.dumps(value_schema.to_json()), 'AVRO')
        sr.register_schema("reply-value", avro_schema)

    status_code, _ = get_schema(schema_host + "/subjects/info-key/versions/latest")

    if status_code == 404:
        avro_schema = Schema(json.dumps(key_schema.to_json()), 'AVRO')
        sr.register_schema("info-key", avro_schema)

    return value_schema, key_schema


def main():
    monitor_config = config.read_config('monitor.ini', 'monitor')

    lnd_monitor_value_schema, lnd_monitor_key_schema = create_avro_schema_key_and_value(monitor_config['schema_host'])

    producer_config = {'bootstrap.servers': monitor_config['kafka_host'],
                       'schema.registry.url': monitor_config['schema_host'],
                       'sasl.username': monitor_config['user_kafka'],
                       'sasl.mechanism': monitor_config['sasl_mechanism'],
                       'sasl.password': monitor_config['user_kafka_pass'],
                       'security.protocol': monitor_config['security_protocol']}

    # exponential backoff and retry when node is not active
    retry_counter = 0
    active = True

    producer = AvroProducer(producer_config, default_key_schema=lnd_monitor_key_schema,
                            default_value_schema=lnd_monitor_value_schema)

    while active:

        monitor = RunLndMonitor(producer, monitor_config['monitor_node_name'], monitor_config['monitor_node_host'],
                                monitor_config['monitor_node_network'], monitor_config['monitor_node_port'],
                                monitor_config['monitor_debug'])

        if monitor.lndMonitor.is_lnd_node_active() is False:
            print("Oops appears lnd is not active")

        monitor.run_async_program()

        print(f"Reconnecting... {retry_counter}")

        retry_counter += 1

        producer.flush()


def get_schema(url):
    response = requests.get(url)
    if response.status_code != 200:
        return response.status_code, None

    schema_string = response.json()['schema']
    avro_schema = avro.loads(schema_string)

    return response.status_code, avro_schema


if __name__ == '__main__':
    main()
