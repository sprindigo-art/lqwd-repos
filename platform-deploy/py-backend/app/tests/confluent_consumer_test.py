
import argparse

#logging.basicConfig(filename='log_file.log')
#logging.basicConfig(level=logging.DEBUG)
from app.configuration.config import *
test=False
if test: 
	kafkaCoHost = 'localhost:9092'
	kafkaProHost = 'localhost:9092'

counter =0
gid = 12

from confluent_kafka.avro import AvroConsumer

kafkaCoTopic='tmessage-details'
kafkaCoTopic='test'
kafkaCoTopic='test-reply'

parser = argparse.ArgumentParser(description='')
parser.add_argument('--topic', type=str, dest='kafkaTopic', default='test', help='kafka topic to consume')
parser.add_argument('--debug', action='store_true', dest='debug', default=False)
parser.add_argument('--reset', action='store_true', dest='reset', default=False, help = "reset offset")
parser.add_argument('--gid', type=int, dest='gid', default=12, help = "specify group id for kafka consumer")

args= parser.parse_args()

kafkaCoTopic = args.kafkaTopic
debug = args.debug
reset = args.reset
gid = args.gid
#================================================
#resetting offsets
def on_assign (c, ps):
        for p in ps:
            p.offset=-2
        c.assign(ps)


if (kafkaCoTopic == "test"): gid = 6123
if (kafkaCoTopic == "test-reply"): gid = 51234
if (kafkaCoTopic == "request"): gid = 6124
if (kafkaCoTopic == "reply"): gid = 61235

consumer_config = {'bootstrap.servers':kafkaProHost,
					'group.id': gid,
					'auto.offset.reset':'earliest',
                    'schema.registry.url': 'http://192.168.123.252:8081',
                    'sasl.username': user_kafka,
                    'sasl.mechanism': 'PLAIN',
                    'sasl.password': user_kafkaPass,
                    'security.protocol':  'SASL_PLAINTEXT'}


consumer = AvroConsumer(consumer_config)
if (reset):
	consumer.subscribe([kafkaCoTopic], on_assign=on_assign) 
else: consumer.subscribe([kafkaCoTopic])

print ("Consumer created. GID: ",gid)

while True:
	try:
		message = consumer.poll(1)
	except Exception as e:
		print(f"Exception while trying to poll messages - {e}")
	else:
		if message:
			counter +=1
			print("==== MSG COUNTER: ==== ", counter,  f"\nKafka topic: {message.topic()}, partition: {message.partition()}, offset: {message.offset()}\n"
					  f"\tmessage key: {message.key()} \n\tmessage value: {message.value()}")
			consumer.commit()
		else:
			if debug: print("No new messages at this point. Try again later.")

consumer.close()



