# Created by Joshua Jackson
# Date: 2021-08-23
# File: lnd_monitor.py
# Project: lnd-monitor
# Version: 0.0.1
#
# Class to Monitor LND Node
# Currently Uses BackEndReply schema for values and TmessageKey schema for key for Sending to Kafka

import asyncio

import requests

from confluent_kafka import avro
import config as config
from confluent_kafka.avro import AvroProducer
from lnd_monitor import LndMonitor


class RunLndMonitor:
    def __init__(self, producer, lnd_name, host, network, port, debug):
        self.lndMonitor = LndMonitor(lnd_name, host, port, network, producer, debug)
        self.loop = asyncio.get_event_loop()
        self.actions = [
            ["/v1/invoices/subscribe", "lnd-invoice-monitor"],
            ["/v1/channels/subscribe", "lnd-channel-monitor"],
            ["/v1/transactions/subscribe", "lnd-transaction-monitor"],
            ["/v1/state/subscribe", "lnd-state-monitor"]
        ]

    def run_async_program(self):
        self.loop.run_until_complete(self.get_subscribe_calls())
        return self.lndMonitor.is_lnd_node_active()

    async def get_subscribe_calls(self):
        async with self.lndMonitor as lm:
            return await asyncio.gather(*[lm.create_rpc_call(action[0], action[1]) for action in self.actions])


def main():
    monitor_config = config.read_config('monitor.ini.example', 'monitor')
    lnd_monitor_value_schema = get_schema(monitor_config['schema_host'] + "subjects/reply-value/versions/latest")
    if not lnd_monitor_value_schema:
        exit("Schema at %s not found!", lnd_monitor_value_schema)

    lnd_monitor_key_schema = get_schema(monitor_config['schema_host'] + "subjects/info-key/versions/latest")
    if not lnd_monitor_key_schema:
        exit("Schema at %s not found!", lnd_monitor_key_schema)

    producer_config = {'bootstrap.servers': monitor_config['kafka_host'],
                       'schema.registry.url': monitor_config['schema_host'],
                       'sasl.username': monitor_config['user_kafka'],
                       'sasl.mechanism': monitor_config['sasl_mechanism'],
                       'sasl.password': monitor_config['user_kafka_pass'],
                       'security.protocol': monitor_config['security_protocol']}



    # exponential backoff and retry when node is not active
    retry_counter = 0
    active = True
    while active:

        producer = AvroProducer(producer_config, default_key_schema=lnd_monitor_key_schema,
                                default_value_schema=lnd_monitor_value_schema)

        monitor = RunLndMonitor(producer, monitor_config['monitor_node_name'], monitor_config['monitor_node_host'],
                                monitor_config['monitor_node_network'], monitor_config['monitor_node_port'],
                                monitor_config['monitor_debug'])

        if monitor.lndMonitor.is_lnd_node_active() is False:
            print("Oops appears lnd is not active")

        monitor.run_async_program()

        print(f"Reconnecting... {retry_counter}")

        retry_counter += 1

        producer.flush()


def get_schema(url, debug=False):
    avro_schema = None
    schema = None
    try:
        schema = requests.get(url)
    except Exception as e:
        if debug:
            print(f"EXCEPTION:  {e}")

    if schema and schema.json()['schema']:
        schema_string = schema.json()['schema']
        avro_schema = avro.loads(schema_string)
    else:
        print(f"ERROR: Schema at %s NOT FOUND!" % url)
        raise Exception(f"ERROR: Schema at %s NOT FOUND!" % url)

    return avro_schema


if __name__ == '__main__':
    main()
