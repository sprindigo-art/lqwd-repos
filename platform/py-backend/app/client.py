############################################
#
# lnd communication client
# and kafka connector
from client_utils import get_schema
from consumer import Consumer
from producer import Producer
import argparse
from random import seed
from config_client import ConfigServerClient

version = "v0.0.8 latest Aug 2021"
#
# Albert Szmigielski albert@lqwd.money
#
#		&
#
# Joshua Jackson josh@lqwd.money
#
#
# LQwD Financial
#
#
#
###########################################


###########################################

# Flow Design
#
# connect to kafka
# check kafka for new message
#	process message
#	connect to appropriate LND
#	execute action on LND
#	send message back to kafka
#
###########################################


# ========== DEFAULTS ========================================== #
write = False
test = False
poll_interval = 1
timeout = 5

rpc = True

seed(73)

# ====================== Command line args ===================== #
parser = argparse.ArgumentParser(description='')
parser.add_argument('--debug', action='store_true', dest='debug', default=False, help="print debug info")
parser.add_argument('--write', action='store_true', dest='write', default=False, help="write response to kafka")
parser.add_argument('--reset', action='store_true', dest='reset', default=False, help="reset offset")
parser.add_argument('--insecure', action='store_true', dest='insecure', default=False,
                    help="ignore tls when making RPC call to LND")
parser.add_argument('--version', action='store_true', dest='version', default=False, help="print version ")
parser.add_argument('--grpc', action='store_true', dest='grpc', default=False,
                    help="use gRPC interface to talk to LND ")
parser.add_argument('--timeout', type=int, dest='timeout', default=10, help="time to wait for LND response ")
parser.add_argument('--macaroon', action='store_true', dest='macaroon', default=False, help="Write Macaroon to File")

args = parser.parse_args()

debug = args.debug
write = args.write
reset = args.reset
insecure = args.insecure
Version = args.version
timeout = args.timeout
grpc = args.grpc

if grpc:
    rpc = False
if debug:
    poll_interval = 1

if Version:
    print(version)
    exit()

# initialize configuration server

config = ConfigServerClient()
config.set_configurations()

avro_key_schema = get_schema(config.info_key_schema_url)
reply_value_schema = get_schema(config.reply_value_schema_url)
# ============= Create a consumer to listen for messages ==================#

producer = Producer(debug)
consumer = Consumer(debug, reset, avro_key_schema, producer, grpc, args.macaroon, timeout, insecure)
consumer.subscribe_to_topic()

consumer.listen_for_messages()
