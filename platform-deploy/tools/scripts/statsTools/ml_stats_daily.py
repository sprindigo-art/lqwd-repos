# Author: Joshua Jackson
# Date: July 5 2021
# Version: 0.0.1
# file: 1ml_stats_daily.py
#
# Script to read from https://1ml.com/statistics
# and get stats to update frontend db for btc charts

# !/usr/local/bin/python3
import sys, os

sys.path.insert(0, os.path.abspath(os.path.join('../../scripts/', '.')))

import psycopg2
from psycopg2.extensions import AsIs
import json
from urllib.request import urlopen
from retrying import retry
import logging
from config.config import Config

dbUser = Config.dbuser
dbPass = Config.dbpassword
dbHost = Config.dbhost
dbPort = Config.dbport
dbName = Config.dbname

logging.basicConfig(
    filename='/var/log/cron.log',
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


# insert sql statement for updating latest 1ml stats into database
@retry(wait_random_min=1000, wait_random_max=2000, wait_exponential_multiplier=1000)
def insert1mlStats(stats_dict):
    try:

        sql_insert = "INSERT INTO ml_stats_daily (%s) VALUES %s"

        con = connectDB()
        logging.info("Connected to DB")
        cursor = con.cursor()

        logging.info("Attempting to Insert 1ML Stats into Database")
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
def get1mlStats():
    try:
        data_json = None
        url = "https://1ml.com/statistics?json=true"

        logging.info("Gettign 1ML Stats")
        response = urlopen(url)
        if response.getcode() == 200:
            logging.info("Successful Response from 1ML Stats")
            data_json = json.loads(response.read())

            return data_json

        return None

    except Exception as e:
        logging.error("get1mlStats Error: {}".format(e))
        raise Exception("get1mlStats Error: {}".format(e))


def main():
    try:
        data_json = get1mlStats()
        if data_json is not None:
            logging.info("Data From 1ML:\n{}".format(json.dumps(data_json, indent=2)))
            insert1mlStats(data_json)
    except Exception as e:
        logging.error("main Error: {}".format(e))
        raise Exception("main Error: {}".format(e))


if __name__ == '__main__':
    main()
