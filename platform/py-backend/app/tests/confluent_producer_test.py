import os, sys
currentdir = os.path.dirname(os.path.realpath(__file__))
print(currentdir+" ==============")
parentdir = os.path.dirname(currentdir)
print(parentdir+" ==============")
sys.path.append(parentdir)

import argparse
import logging
# logging.basicConfig(filename='log_file.log')
from app.configuration.config import *

logging.basicConfig(level=logging.DEBUG)

test = False

from confluent_kafka import avro
from confluent_kafka.avro import AvroProducer
from datetime import datetime
import requests
from random import seed, randint


# ------------------------------------------------------------------------------#
# get avro schema
def get_schema(url, debug=False):
    avro_schema = None
    schema = None
    try:
        schema = requests.get(url)
    except Exception as e:
        if (debug):
            print(f"EXCEPTION:  {e}")

    if (schema and schema.json()['schema']):
        schema_string = schema.json()['schema']
        avro_schema = avro.loads(schema_string)
    else:
        print(f"ERROR: Schema at %s NOT FOUND!" % url)
    return avro_schema


parser = argparse.ArgumentParser(description='')
parser.add_argument('--debug', action='store_true', dest='debug', default=False)
parser.add_argument('--write', action='store_true', dest='write', default=False)
parser.add_argument('--topic', type=str, dest='kafkaTopic', default='test', help='kafka topic to consume')
parser.add_argument('--action', type=str, dest='action', default='getinfo', help='action to implement')

args = parser.parse_args()

debug = args.debug
write = args.write
kafkaProTopic = args.kafkaTopic
action = args.action

# avro_value_schema = SchemaRegistryClient("http://192.168.123.252:8081").get_by_id(schema_id=42)
# avro_key_schema = SchemaRegistryClient("http://192.168.123.252:8081").get_by_id(schema_id=41)


avro_value_schema = get_schema(info_value_schema_url)
avro_key_schema = get_schema(info_key_schema_url)

if (debug): print("request_value_schema_url: ", request_value_schema_url)

request_value_schema = get_schema(request_value_schema_url)
if not request_value_schema: exit("Schema at %s not found!", request_value_schema_url)
reply_value_schema = get_schema(reply_value_schema_url)
if not reply_value_schema: exit("Schema at %s not found!", reply_value_schema_url)

schema_registry_url = 'http://localhost:8081'

producer_config = {'bootstrap.servers': kafkaProHost,
                   'schema.registry.url': schema_host,
                   'sasl.username': user_kafka,
                   'sasl.mechanism': sasl_mechanism,
                   'sasl.password': user_kafkaPass,
                   'security.protocol': security_protocol}
print(producer_config)
producer = AvroProducer(producer_config, default_key_schema=avro_key_schema, default_value_schema=request_value_schema)

print("Producer created")
date = datetime.now()
dateStr = date.strftime("%d-%b-%Y.%H-%M-%S")

# we are simulating a FE request here
mid = randint(0, 10e8)
timestamp = int(datetime.utcnow().timestamp())
seed(timestamp)
userid = randint(0, 10e6)
nodeid = str(randint(0, 10e2))

key = ({"id": mid, "tactionName": action})
value = (
	{"id": mid,
     "reply_id": mid,
     "timestamp": timestamp,
     "user_id": userid,
     "username": "example-user",
     "description": "description of msg",
	 "requested_action": action,
	 "node_id": "tlnd-1206"})

if debug:
    print("mid: ", mid, "\ntimestamp: ", timestamp, "\nuserid: ", userid, "\naction: ", action, "\nnodeid: ", nodeid,
          "type: ", type(nodeid))
    print(key)
    print(value)

producer.produce(topic=kafkaProTopic, key=key, value=value)

print("Sent")
"""
for x in range (23,27):
	key = 'testing_' + str(x)
	key_b=key.encode()
	value = 'value of this test is: ' + str(x)
	value_b=value.encode()
	producer.send (kafkaProTopic, key=key_b, value=value_b )
	print (x)
"""
producer.flush()
