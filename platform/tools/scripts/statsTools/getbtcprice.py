# Python Script to get and Save BTC Prices in USD and CAD Values
# Author: Joshua Jackson
# Date: June 17 2021
# Version: 0.0.1

# !/usr/local/bin/python3
import sys, os
sys.path.insert(0, os.path.abspath(os.path.join('../../scripts/', '.')))


import psycopg2
import requests
import json
from dateutil import parser
from retrying import retry
import logging
from config.config import Config

dbUser = Config.dbuser
dbPass = Config.dbpassword
dbHost = Config.dbhost
dbPort = Config.dbport
dbName = Config.dbname
api_key = Config.coinmarket_cap_api

routingDB = Config.routingDB
routingUser = Config.routingUser
routingPass = Config.routingPass
routingHost = Config.routingHost
routingPort = Config.routingPort


# set up logging now
logging.basicConfig(
    level=logging.DEBUG,
    filename='/var/log/cron.log',
    encoding='utf-8',
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

# connect to db
@retry(wait_random_min=1000, wait_random_max=2000, wait_exponential_multiplier=1000)
def connect_to_routing():
    try:
        # connect to DB and return connection
        logging.info("Attempting to Connect to Database")
        connection = psycopg2.connect(user=routingUser, password=routingPass, host=routingHost, port=routingPort, database=routingDB)
        return connection
    except Exception as e:
        print("Exception {}".format(e))

# connect to db
@retry(wait_random_min=1000, wait_random_max=2000, wait_exponential_multiplier=1000)
def connect_to_postgres():
    try:
        # connect to DB and return connection
        logging.info("Attempting to Connect to Database")
        connection = psycopg2.connect(user=dbUser, password=dbPass, host=dbHost, port=dbPort, database=dbName)
        return connection
    except Exception as e:
        print("Exception {}".format(e))


def insert_current_price_monitoring_db(cad_price, usd_price, lastupdated):
    try:
        sql_insert = "INSERT INTO price_usd_cad (CAD, USD, LAST_UPDATED) VALUES ({},{},'{}')".format(cad_price,
                                                                                                     usd_price,
                                                                                                     lastupdated)
        con = connect_to_routing()
        
        logging.info("Succesfully Connected to Database")
        
        cursor = con.cursor()
        cursor.execute(sql_insert)
        con.commit()
        cursor.close()
    
        logging.info("Succesfully Inserted Price into Bitcoin Price DB Routing")
        
        con.close()
        
        logging.info("Connection Closed")
    except Exception as e:
        logging.error("insert_current_price_monitoring_db - Exception {}".format(e))
        raise Exception("insert_current_price_monitoring_db - Exception {}".format(e))
    
# insert latest price from coin marketcap into bitcoin price db
def insert_current_price(cad_price, usd_price, lastupdated):
    try:
        sql_insert = "INSERT INTO price_usd_cad (CAD, USD, LAST_UPDATED) VALUES ({},{},'{}')".format(cad_price,
                                                                                                     usd_price,
                                                                                                     lastupdated)
        con = connect_to_postgres()
        
        logging.info("Succesfully Connected to Database")
        
        cursor = con.cursor()
        cursor.execute(sql_insert)
        con.commit()
        cursor.close()
        
        logging.info("Succesfully Inserted Price into Bitcoin Price DB")
        con.close()
        
        logging.info("Connection Closed")
    except Exception as e:
        logging.error("insert_current_price - Exception {}".format(e))
        raise Exception("insert_current_price - Exception {}".format(e))


# api request for price from coinmarket cap individual currencies as currently on basic plan
@retry(wait_random_min=1000, wait_random_max=2000, wait_exponential_multiplier=1000)
def get_price_from_coinmarketcap():
    try:

        url1 = "https://pro-api.coinmarketcap.com/v1/tools/price-conversion?id=1&amount=1&convert={}".format('USD')
        url2 = "https://pro-api.coinmarketcap.com/v1/tools/price-conversion?id=1&amount=1&convert={}".format('CAD')

        payload = {}

        headers = {
            'X-CMC_PRO_API_KEY': api_key
        }

        response1 = requests.request("GET", url1, headers=headers, data=payload)
        response2 = requests.request("GET", url2, headers=headers, data=payload)

        response_dict_usd = response1.json()
        response_dict_cad = response2.json()

        usd_price = response_dict_usd['data']['quote']['USD']['price']
        cad_price = response_dict_cad['data']['quote']['CAD']['price']

        lastupdated = response_dict_cad['data']['quote']['CAD']['last_updated']

        return {'usd': usd_price, 'cad': cad_price, 'lastupdated': lastupdated}

    except Exception as e:
        logging.error("get_price_from_coinmarketcap - Exception {}".format(e))
        raise Exception("get_price_from_coinmarketcap - Exception {}".format(e))


def main():
    try:
        coinmarketcap_dict = get_price_from_coinmarketcap()
        if coinmarketcap_dict is not None:
            logging.info("Inserting Coinmarketcap Data into DB\n{}".format(json.dumps(coinmarketcap_dict, indent=2)))
            insert_current_price_monitoring_db(coinmarketcap_dict['cad'], coinmarketcap_dict['usd'],
                                               parser.parse(coinmarketcap_dict['lastupdated']))
            # insert_current_price(coinmarketcap_dict['cad'], coinmarketcap_dict['usd'],
            #                      parser.parse(coinmarketcap_dict['lastupdated']))
        else:
            logging.info("Coinmarketcap Data is None")
    except Exception as e:
        raise Exception("main Error: {}".format(e))


if __name__ == '__main__':
    main()
