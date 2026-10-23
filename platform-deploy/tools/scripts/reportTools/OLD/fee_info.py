# Author: Joshua Jackson
# Date: April 11 2022
# Version: 0.0.1
# file: fee_info.py
#
# Script to build fee info data for nodes in the network

# !/usr/local/bin/python3
import codecs
import sys, os
import time

sys.path.insert(0, os.path.abspath(os.path.join('../../scripts', '.')))

import psycopg2
from psycopg2.extensions import AsIs
import requests
import json
from datetime import datetime
from dateutil import parser
from urllib.request import urlopen
from retrying import retry
import logging
from config.config import Config
from reportTools.dbHandler import dbHandler

dbUser = Config.dbuser
dbPass = Config.dbpassword
dbHost = Config.dbhost
dbPort = Config.dbport
dbName = Config.dbname

logging.basicConfig(
	filename='cron.log',
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


# create RPC call
# @retry(wait_random_min=1000, wait_random_max=2000, wait_exponential_multiplier=1000)
# def create_rpc_call(lnd_node, host, port, action, data, macaroon):
# 	try:
# 		headers = {'Grpc-Metadata-macaroon': codecs.encode(macaroon, 'hex')}
# 		url = f'https://localhost:{port}{action}'
#
# 		# if self.debug:
# 		# print(f"Request\nHeaders: {headers}\nURL: {url}")
# 		r = requests.post(url, headers=headers, verify=os.getcwd()+"/tls.cert", data=json.dumps(data), timeout=10)
# 		except requests.exceptions.Timeout as e:
# 			return Exception(f"Exception {e} in Creating RPC Call, Retrying...")
#
# 		print(f"JSON Response: {r.json()}")
#
# 		return r.json()
# 	except Exception as e:
# 		print(f"Exception in createRPCCall: {e}")


@retry(wait_random_min=1000, wait_random_max=2000, wait_exponential_multiplier=1000)
def connect_to_peer(nodelist):
	try:
		db = dbHandler()
		macaroon, tls = db.get_macaroon_and_tls_cert("lnd-32894")
		if macaroon is None or tls is None:
			raise Exception("Macaroon Details Not Found")
		
		headers = {'Grpc-Metadata-macaroon': codecs.encode(macaroon, 'hex')}
		url = f'https://localhost:8080/v1/peers'
		
		count = 0
		for peer in nodelist:
			for address in peer['addresses']:
				if 'onion' not in address['addr'] and '[' not in address['addr']:
					
					data = {
						'addr':
							{
								'pubkey': peer['pub_key'],
								'host': address['addr']
							}
					}

					
					flag = True
					count += 1
					
					while flag:
						try:
							# print(f"\n{count} -- {peer['pub_key']}@{address['addr']}\n")
							r = requests.post(url, headers=headers, verify=os.getcwd() + "/tls.cert", data=json.dumps(data), timeout=10)
							flag = False
							print(f"{count}/{len(nodelist)}", end="\r")
						except Exception as e:
							flag = True
							print(f"Exception: {e}... Retrying")
						
	except Exception as e:
		print(f"Exception in connect_to_peer: {e}")


# insert sql statement for updating latest 1ml stats into database
@retry(wait_random_min=1000, wait_random_max=2000, wait_exponential_multiplier=1000)
def insert_fee_info(stats_dict):
	try:
		
		sql_insert = "INSERT INTO fee_info (%s) VALUES %s"
		db = dbHandler()
		con = db.connect_to_postgres("stats")
		logging.info("Connected to DB")
		cursor = con.cursor()
		
		logging.info("Attempting to Insert Fee Info into Database")
		cursor.execute(sql_insert, (AsIs(', '.join(stats_dict.keys())), tuple(stats_dict.values())))
		
		con.commit()
		cursor.close()
		
		logging.info("Succesfully Insert 1ML Stats into Database")
		con.close()
	
	except Exception as e:
		logging.error("insert1mlStats Error: {}".format(e))
		raise Exception("insert1mlStats Error: {}".format(e))


# url open to read and get 1ml stats in json format
@retry(wait_random_min=1000, wait_random_max=2000, wait_exponential_multiplier=1000)
def getNodeList():
	try:
		
		node_list = list()
		
		data_json = None
		url_list = [
			"https://1ml.com/node?order=nodeconnectednodecount&active=true&public=true&json=true",
			"https://1ml.com/node?order=channelcount&active=true&public=true&json=true",
			"https://1ml.com/node?order=capacity&active=true&public=true&json=true",
			"https://1ml.com/node?order=capacitychange&active=true&public=true&json=true",
			"https://1ml.com/node?active=true&public=true&json=true",
			"https://1ml.com/node?order=channelcountchange&active=true&public=true&json=true",
			"https://1ml.com/node?order=capacitychange&active=true&public=true&json=true",
			"https://1ml.com/node?order=newest&active=true&public=true&json=true"
		]
		
		logging.info("Getting Node List")
		for url in url_list:
			response = urlopen(url)
			if response.getcode() == 200:
				logging.info("Successful Response from 1ML Stats")
				data_json = json.loads(response.read())
				node_list.append(data_json)
		return node_list
	
	except Exception as e:
		logging.error("get1mlStats Error: {}".format(e))
		raise Exception("get1mlStats Error: {}".format(e))

def main():
	try:
		data_json = getNodeList()
		nodeList = list()
		if data_json is not None:
			# logging.info("Data From 1ML:\n{}".format(json.dumps(data_json, indent=2)))
			# connect_to_peer(data_json)
			for peers in data_json:
				for peer in peers:
					if peer not in nodeList:
						nodeList.append(peer)
			print(f"Number of Unique Nodes: {len(nodeList)}")
			
			connect_to_peer(nodeList)
	except Exception as e:
		logging.error("main Error: {}".format(e))
		raise Exception("main Error: {}".format(e))


if __name__ == '__main__':
	main()
