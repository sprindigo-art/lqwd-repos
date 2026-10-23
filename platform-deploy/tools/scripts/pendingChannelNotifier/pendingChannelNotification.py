# Created by Joshua Jackson
# Date: 2023-04-27
# File: pendingChannelNotification.py 
# Project: blockCheck
# Version: 0.0.1
#
# Script which will check pending channels and notify if greater than or equal to 5M Sats
import os
import psycopg2
import logging
from datetime import datetime
from producer import Producer

logging.basicConfig(
	filename='pendingChannelNotification.log',
	encoding='utf-8',
	level=logging.DEBUG,
	format='%(filename)s:%(levelname)s:%(asctime)s %(message)s',
	filemode='a',
	datefmt='%m/%d/%Y %I:%M:%S %p'
)


class PendingChannelNotifier:
	def __init__(self, producer, debug=False):
		self.debug = debug
		self.producer = producer
		self.session = None
		self.dbUser = os.getenv("ROUTING_USER")
		self.dbPass = os.getenv("ROUTING_PASS")
		self.dbHost = os.getenv("ROUTING_HOST")
		self.dbPort = os.getenv("ROUTING_PORT")
		self.dbName = os.getenv("ROUTING_DB")
	
	# function to connect to ml stats frontend db
	def connectDB(self):
		try:
			# connect to DB and return connection
			logging.info("Trying to Connect to DB")
			connection = psycopg2.connect(user=self.dbUser, password=self.dbPass, host=self.dbHost, port=self.dbPort,
			                              database=self.dbName, connect_timeout=10)
			return connection
		
		except Exception as e:
			logging.error("Connect DB Error: {}".format(e))
			raise Exception("connectDB Error: {}".format(e))
	
	# get new incoming pending channels
	def getPendingChannels(self):
		try:
			
			# set sql stmnt
			sql = """
					SELECT DISTINCT ON (ci.channel_point) ci.channel_point, ci.remote_node_pub, ci.capacity, ln.lnd_alias, MIN(ln.timestamp)
					FROM lnd_node_pending_channels ci
					JOIN lnd_node_pending_channels ln ON ci.channel_point = ln.channel_point
					WHERE ci.initiator = 'INITIATOR_REMOTE'
					AND ci.capacity >= 5000000
					AND ci.closing = false
					AND ci.timestamp >= DATE(NOW())
					GROUP BY ci.channel_point, ci.remote_node_pub, ci.capacity, ln.lnd_alias
					ORDER BY ci.channel_point, MIN(ln.timestamp) DESC
				"""
			
			# get connection and create cursor
			con = self.connectDB()
			cursor = con.cursor()
			
			cursor.execute(sql)
			rows = cursor.fetchall()
			
			pending_channels = []
			for row in rows:
				pending_channels.append({
					"channel_point": row[0],
					"remote_node": row[1],
					"capacity": row[2],
					"alias": row[3],
					"first_seen": row[4]
				})
			
			return pending_channels
		
		except Exception as e:
			logging.error("getPendingChannels Error: {}".format(e))
			raise Exception("getPendingChannels Error: {}".format(e))
	
	def building_pending_list_email(self, node_list):
		try:
			
			# Get current date and time
			now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
			
			# Build HTML list items for each node
			items = ""
			for node in node_list:
				items += f"""
									<li>{node['alias']}
										<ul>
											<li>Remote Node Pubkey: {node['remote_node']}</li>
											<li>Channel Point: {node['channel_point']}</li>
											<li>Capacity: {node['capacity']} Sats</li>
											<li>First Seen: {node['first_seen']}</li>
										</ul>
									</li>"""
			
			# Build HTML page with header, list, and footer
			html = f"""
				        <body>
				            <h1>Current Pending Channels</h1>
				            <p>Generated at: {now}</p>
				            <ul>
				                {items}
				            </ul>
				        </body>
				    """
			
			# Output the HTML
			return html
		
		
		
		except Exception as e:
			logging.error("building_pending_list_email Error: {}".format(e))
			raise Exception("building_pending_list_email Error: {}".format(e))
	
	def send_to_kafka(self, data):
		try:
			body = self.building_pending_list_email(data)
			
			value = {'body': body,
			         'subject': "Pending Channel List",
			         'sender': {
				         'email': 'info@lqwd.money',
				         'displayName': 'Info',
				         'recipientType': 'TO'
			         },
			         'recipients': [
				         {
					         'email': 'josh@lqwd.money',
					         'displayName': 'Joshua Jackson',
					         'recipientType': 'TO'
				         },
				         {
					         'email': 'aziz@lqwd.money',
					         'displayName': 'Aziz Pulatov',
					         'recipientType': 'TO'
				         },
			
			         ],
			         'attachments': []
			         }
			
			if self.debug:
				print(value)
			
			self.producer.produce(topic="send-email", value=value)
			self.producer.flush()
			
			if self.debug:
				print("Sent Message to Kafka")
		
		except Exception as e:
			print("Exception in sendToKafka: {}".format(e))


if __name__ == "__main__":
	producer = Producer(True).connect()
	pendingChannel = PendingChannelNotifier(producer, True)
	pendingChannelData = pendingChannel.getPendingChannels()
	pendingChannel.send_to_kafka(pendingChannelData)
