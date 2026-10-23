import pandas as pd
import psycopg2
from psycopg2 import sql
import jinja2
import pdfkit

dbUser = "postgres"
dbPass = "postgresdocker#"
dbHost = "192.168.113.250"
dbPort = "5433"
dbName = "lnd"

class PrepareReport:

	def __init__(self, lnd_node, start_date, end_date):
		self.lnd_node=lnd_node
		self.start_date = start_date
		self.end_date = end_date
		
	# connect to Postgres DB
	def connect_to_postgres(self):
		try:
			#connect to DB and return connection
			connection = psycopg2.connect(user = dbUser, password = dbPass, host=dbHost, port=dbPort, database = dbName)
			return connection
		except Exception as e:
			print("Exception {}".format(e))
			
	def get_forwarding_history_data(self):
		try:
			
			column_names = ["event_timestamp", "chan_id_in", "chan_id_out", "amt_in", "amt_out", "fee", "fee_msat", "amt_in_msat", "amt_out_msat", "lnd_node"]
			sql = "SELECT event_timestamp, chan_id_in, chan_id_out, amt_in, amt_out, fee, fee_msat, amt_in_msat, amt_out_msat, lnd_node FROM forwarding_events WHERE lnd_node='{}';".format(self.lnd_node)
			
			# get connection and create cursor
			con = self.connect_to_postgres()
			cursor = con.cursor()

			cursor.execute(sql)
			rows = cursor.fetchall()
			df = pd.DataFrame(rows, columns=column_names)
			
			#group by chan_id and filter given date
			print(df)
				
			df.to_csv("~/prepare_report.csv")

			con.close()
		except Exception as e:
			print(f"Exception in get_forwarding_history_data: {e}")
			
#	def create_forwarding_history_report(self):
#		try:
#
#		except Exception as e:
#			print(f"Exception in create forwarding history report: {e}")
			
	

pr = PrepareReport("lnd-885", None, None)
pr.get_forwarding_history_data()
'''
To create a report (per node) that will supply the following data

time frame this report is for

fees collected (sum)

amount forwarded (sum)

total number of forwarding events


per channel breakdown

	number of forwarding events

	(avg. per day, week, month)

	amount forwarded  (= amount out)

	amount in

	amount out

	fees
'''
