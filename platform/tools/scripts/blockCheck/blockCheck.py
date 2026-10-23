# Created by Joshua Jackson
# Date: 2022-09-01
# File: blockCheck.py 
# Project: scripts
# Version: 0.0.1
#
# script to compare the blocks in DB registered by LND monitor to see if any blocks have fallen behind the current BTC block

import os

import botocore
from twilio.rest import Client
import sys
from urllib.request import urlopen

from config import Config
import psycopg2
import json
from retrying import retry
import logging
import boto3
from botocore.exceptions import ClientError, WaiterError
from botocore.config import Config as botocoreConfig

from ses_identities import SesIdentity
from ses_destination import SesDestination

# from ses_templates import SesTemplate
from ses_generate_smtp_credentials import calculate_key

dbUser = Config.username
dbPass = Config.password
dbHost = Config.host
dbPort = Config.port
dbName = Config.dbname

logging.basicConfig(
	filename='blockCheck.log',
	encoding='utf-8',
	level=logging.DEBUG,
	format='%(filename)s:%(levelname)s:%(asctime)s %(message)s',
	filemode='a',
	datefmt='%m/%d/%Y %I:%M:%S %p'
)

# define a Handler which writes INFO messages or higher to the sys.stderr
console = logging.StreamHandler(sys.stdout)
console.setLevel(logging.DEBUG)
# set a format which is simpler for console use
formatter = logging.Formatter('%(filename)s:%(levelname)s:%(asctime)s %(message)s')
# tell the handler to use this format
console.setFormatter(formatter)
# add the handler to the root logger
logging.getLogger().addHandler(console)


# function to connect to ml stats frontend db
@retry(wait_random_min=1000, wait_random_max=2000, wait_exponential_multiplier=1000)
def connectDB():
	try:
		# connect to DB and return connection
		logging.info("Trying to Connect to DB")
		connection = psycopg2.connect(user=dbUser, password=dbPass, host=dbHost, port=dbPort, database=dbName,
		                              connect_timeout=10)
		return connection
	
	except Exception as e:
		logging.error("Connect DB Error: {}".format(e))
		raise Exception("connectDB Error: {}".format(e))


# get latest btc block
@retry(wait_random_min=1000, wait_random_max=2000, wait_exponential_multiplier=1000)
def getLatestBlockHeight():
	try:
		data_json = None
		url = "https://blockchain.info/latestblock"
		
		logging.info("Getting Latest Block")
		response = urlopen(url)
		if response.getcode() == 200:
			logging.info("Successful Response from Latest Block")
			data_json = json.loads(response.read())
			if "height" in data_json:
				return data_json["height"]
		
		return None
	except Exception as e:
		logging.error("getLatestBlockHeight Error: {}".format(e))
		raise Exception("getLatestBlockHeight Error: {}".format(e))


# get latest blocks from table
@retry(wait_random_min=1000, wait_random_max=2000, wait_exponential_multiplier=1000)
def getFailingNodes():
	try:
		
		latestBlock = getLatestBlockHeight()
		
		# set sql stmnt
		sql = "SELECT alias, block_height FROM lnd_node_info WHERE timestamp IN (SELECT MAX(timestamp) FROM lnd_node_info GROUP BY alias)"
		
		# get connection and create cursor
		con = connectDB()
		cursor = con.cursor()
		
		cursor.execute(sql)
		rows = cursor.fetchall()
		
		failed_nodes = []
		for row in rows:
			if (latestBlock - row[1]) > 3:
				print(row)
				failed_nodes.append(row)
		
		return failed_nodes
	
	except Exception as e:
		logging.error("getFailingNodes Error: {}".format(e))
		raise Exception("getFailingNodes Error: {}".format(e))


def create_topic(sns_resource, name):
	"""
        Creates a notification topic.
        :param name: The name of the topic to create.
        :return: The newly created topic.
        """
	try:
		topic = sns_resource.create_topic(Name=name)
		logging.info("Created topic %s with ARN %s.", name, topic.arn)
	except ClientError:
		logging.exception("Couldn't create topic %s.", name)
		raise
	else:
		return topic


def sendNotifications(sns_resource, ses_client, source, emails):
	try:
		failed_nodes = getFailingNodes()
		sms_message = "LQwD Node Failures Detected!\n"
		email_message = "<h2>LQwD Node Failures Detected!</h2><br><ul>"
		
		if len(failed_nodes) > 0:
			for node in failed_nodes:
				sms_message += f"\n----------------------------------\n" \
				               f"LND Name: {node[0]}\nLast Block Height Checked: {node[1]}"
				
				email_message += f"<li>LND Name: {node[0]}\nLast Block Height Checked: {node[1]}</li>"
			email_message += "</ul>"
			sms_message += f"\n----------------------------------"
			
			sendSMSNotificationAWS(sns_resource, sms_message)
			
			sendEmailNotificationAWS(ses_client, source, emails, email_message, "LQwD Node Failures Detected!")
		
		else:
			logging.info("No Message to Publish")
			return None
	
	except Exception as e:
		logging.error("sendNotifications Error: {}".format(e))
		raise Exception("sendNotifications Error: {}".format(e))


def sendSMSNotificationAWS(sns_resource, message):
	try:
		
		topic = create_topic(sns_resource, Config.aws_topic)
		
		print(message)
		response = topic.publish(Message=message)
		message_id = response['MessageId']
		logging.info("Published message to topic %s.", topic.arn)
		logging.info(f"Message Published:\n {message}")
		return message_id
	
	except ClientError:
		logging.exception("Couldn't publish message to topic %s.", topic.arn)
		raise
	except Exception as e:
		logging.error("sendSMSNotificationAWS Error: {}".format(e))
		raise Exception("sendSMSNotificationAWS Error: {}".format(e))


def sendSMSNotificationTwilio():
	try:
		account_sid = Config.twilio_account_sid
		auth_token = Config.twilio_auth_token
		client = Client(account_sid, auth_token)
		# failed_nodes = getBlockHeights()
		
		message = client.messages \
			.create(
			body="LQwD Nodes Failure Detected",
			from_='+13474105959',
			to='+16046445174'
		)
		
		print(message.sid)
	except Exception as e:
		logging.error("sendSMSNotification Error: {}".format(e))
		raise Exception("sendSMSNotification Error: {}".format(e))


def sendEmailNotificationAWS(ses_client, source, emails):
	try:
		email = "josh@lqwd.money"
		destination = SesDestination([email])
		
		subject = "LQwD Node Failure"
		html = "<p>Hello!</p><p>From the <b>Amazon SES</b> mail demo!</p>"
		text = "Hello from the Amazon SES mail demo!"
		
		send_args = {
			'Source': source,
			'Destination': {
				'ToAddresses': [
					"josh@lqwd.money"
				]
			},
			'Message': {
				'Subject': {'Data': subject},
				'Body': {
					'Text': {'Data': text},
					'Html': {'Data': html}
				}
			}
		}
		
		try:
			response = ses_client.send_email(
			Source=source,
			Destination=destination.to_service_format(),
			Message={
				'Subject': {'Data': subject},
				'Body': {
					'Text': {'Data': text},
					'Html': {'Data': html}
					}
				}
			)
			
			message_id = response['MessageId']
			logging.info("Sent mail %s from %s to %s.", message_id, source, destination.tos)
		except ClientError:
			logging.exception(
				"Couldn't send mail from %s to %s.", source, destination.tos)
			raise
		else:
			return message_id
	except Exception as e:
		logging.error("sendEmailNotificationAWS Error: {}".format(e))


# sendSMSNotificationAWS()
my_config = botocoreConfig(
	region_name='us-west-2',
	signature_version='v4',
	# retries={
	# 	'max_attempts': 10,
	# 	'mode': 'standard'
	# }
)

sns_resource = boto3.resource(
	service_name='sns',
	aws_access_key_id=Config.aws_key,
	aws_secret_access_key=Config.aws_secret,
	config=my_config
)

ses_client = boto3.client(
	service_name='ses',
	aws_access_key_id=Config.aws_key,
	aws_secret_access_key=Config.aws_secret,
	config=my_config,
	region_name='us-west-2'
)

source = "info@lqwd.money"

emails = [
	"josh@lqwd.money",
	"aziz@lqwd.money",
	"shone@lqwd.money",
	"ashley@lqwd.money"
]

# sendNotifications(sns_resource, ses_client, source, emails)

sendEmailNotificationAWS(ses_client, source, emails)

# sendSMSNotificationAWS(sns_resource)
