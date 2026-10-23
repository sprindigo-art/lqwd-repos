# Created by Joshua Jackson
# Date: 2022-01-21
# File: prepare_report.py
# Project: forwardHistory
# Version: 0.0.1
#
# Builds Report for Forward History for LND node from table
# !/usr/local/bin/python3
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join('../../scripts/', '.')))

import pandas as pd
import psycopg2
import base64
from datetime import datetime
from config.config import Config
import traceback

pd.set_option('display.float_format', lambda x: '%.f' % x)


class CreateReport:
	
	def __init__(self, start_date, end_date, template, csv, html, report_out, debug):
		self.start_date = start_date
		self.end_date = end_date
		
		self.csv = csv
		self.report_out = report_out
		self.debug = debug
	
	# connect to Postgres DB
	def connect_to_postgres(self):
		try:
			# connect to DB and return connection
			connection = psycopg2.connect(user=Config.routingUser, password=Config.routingPass, host=Config.routingHost,
			                              port=Config.routingPort, database=Config.routingDB)
			if self.debug:
				print(f"Connected to DB - {connection}")
			return connection
		except Exception as e:
			print("Exception {}".format(e))
	
	# get list of current LQwD Nodes from Monitoring DB
	def get_lqwd_nodes(self):
		try:
			if self.debug:
				print(f"Get LQwD Nodes for Report")
			
			sql = "SELECT DISTINCT alias FROM lnd_node_info;"
			
			# connect to DB
			con = self.connect_to_postgres()
			cursor = con.cursor()
			
			# execute sql statement
			cursor.execute(sql)
			rows = cursor.fetchall()
			
			lqwd_nodes = list()
			
			for row in rows:
				lqwd_nodes.append(row[0])
				
			if self.debug:
				print(f"Currently {len(lqwd_nodes)} LQwD Nodes\n")
				
			return lqwd_nodes
		
		except Exception as e:
			print(f"Exception at get_lqwd_nodes: {e}")
	
	#given start and end date total fees in sats for nodes
	def get_total_fees_for_lqwd_nodes(self, start_date, end_date):
		try:
			if self.debug:
				print(f"Get Total Fees for LQwD Nodes for Report between {start_date} and {end_date}")
			
			sql = f"SELECT lni.alias as \"LND Node\", SUM(lnf.fee) as \"Total Fees\" \
					FROM lnd_node_forwards AS lnf \
					INNER JOIN \
					( \
					SELECT DISTINCT alias, pubkey FROM lnd_node_info\
					) lni ON lni.pubkey = lnf.lnd_pubkey\
					WHERE TO_TIMESTAMP(lnf.timestamp_ns::decimal/1000000000) BETWEEN '{start_date}'::timestamp AND '{end_date}'::timestamp\
					GROUP BY lni.alias\
					ORDER BY \"Total Fees\" DESC;"
			
			# connect to DB
			con = self.connect_to_postgres()
			cursor = con.cursor()
			
			# execute sql statement
			cursor.execute(sql)
			rows = cursor.fetchall()
			
			column_names = ['alias', 'Total Fees']
			df = pd.DataFrame(rows, columns=column_names)
			
			print(df)
			
			return df
		except Exception as e:
			print(f"Exception in get_total_fees_for_lqwd_nodes: {e}")
	
	#channel balance and wallet balance for nodes at specified snapshot date
	def get_node_info_for_lqwd_nodes(self, date):
		try:
			start = f"{date} 23:55:00"
			end = f"{date} 23:59:59"
			
			if self.debug:
				print(f"Get Node Info for LQwD Nodes for Report @ {date} ({start} and {end})")
				
			sql = f"SELECT DISTINCT ON (alias) \
			            alias, \
						active_channels, \
						pending_channels, \
						inactive_channels, \
						local_channel_balance, \
						remote_channel_balance, \
						confirmed_wallet_balance, \
						unconfirmed_wallet_balance, \
						total_wallet_balance\
						FROM lnd_node_info \
						WHERE timestamp BETWEEN '{start}'::timestamp AND '{end}'::timestamp;"
			
			# connect to DB
			con = self.connect_to_postgres()
			cursor = con.cursor()
			
			# execute sql statement
			cursor.execute(sql)
			rows = cursor.fetchall()
			print(rows)
			column_names = ['alias', 'active_channels', 'pending_channels', 'inactive_channels', 'local_channel_balance','remote_channel_balance','confirmed_wallet_balance','unconfirmed_wallet_balance','total_wallet_balance']
			df = pd.DataFrame(rows, columns=column_names)
			print(df)
			
			return df
		except Exception as e:
			print(f"Exception in get_node_info_for_lqwd_nodes: {e}")
			

	#get total on-chain transaction fees from lqwd nodes as well as not channel opening sending transactions
	def get_onchain_tx_fees(self):
		try:
			start = f"{date} 23:55:00"
			end = f"{date} 23:59:59"
			
			if self.debug:
				print(f"Get Node Info for LQwD Nodes for Report @ {date} ({start} and {end})")
			
			sql = f"SELECT DISTINCT ON (alias) \
			            alias, \
						active_channels, \
						pending_channels, \
						inactive_channels, \
						local_channel_balance, \
						remote_channel_balance, \
						confirmed_wallet_balance, \
						unconfirmed_wallet_balance, \
						total_wallet_balance\
						FROM lnd_node_info \
						WHERE timestamp BETWEEN '{start}'::timestamp AND '{end}'::timestamp;"
			
			# connect to DB
			con = self.connect_to_postgres()
			cursor = con.cursor()
			
			# execute sql statement
			cursor.execute(sql)
			rows = cursor.fetchall()
			print(rows)
			column_names = ['alias', 'active_channels', 'pending_channels', 'inactive_channels',
			                'local_channel_balance', 'remote_channel_balance', 'confirmed_wallet_balance',
			                'unconfirmed_wallet_balance', 'total_wallet_balance']
			df = pd.DataFrame(rows, columns=column_names)
			print(df)
			
			return df
		except Exception as e:
			print(f"Exception in get_node_info_for_lqwd_nodes: {e}")

cr = CreateReport(None, None, None, None, None, None, True)
df1 = cr.get_total_fees_for_lqwd_nodes("2022-03-01 00:00:00", "2023-02-28 23:59:59")
df2 = cr.get_node_info_for_lqwd_nodes("2023-02-28")

result = pd.merge(df2, df1, how="left", on='alias')
result.to_csv("/Users/jjackson/LQwD/code/platform/tools/scripts/reportTools/report_03_21_2023.csv")
print(result)