# Python Script to handle DB connection and macaroon files
# Author: Joshua Jackson
# Date: Feb 4 2022
# Version: 0.0.1
# !/usr/local/bin/python3
import sys, os
sys.path.insert(0, os.path.abspath(os.path.join('../../scripts/', '.')))

import psycopg2
import base64
from retrying import retry
from config.config import Config


class DbHandler:
    def __init__(self, debug=True):
        try:
            self.debug = debug
        except Exception as e:
            print(f"Exception in __init__ dbHandler: {e}")

    # connect to Postgres DB
    def connect_to_postgres(self, database=None):
        try:
            # connect to DB and return connection
            if database is None:
                connection = psycopg2.connect(user=Config.dbuser, password=Config.dbpassword, host=Config.dbhost,
                                              port=Config.dbport, database=Config.dbname)
            else:
                connection = psycopg2.connect(user=Config.dbuser, password=Config.dbpassword, host=Config.dbhost,
                                              port=Config.dbport, database=database)

            return connection
        except Exception as e:
            print("Exception {}".format(e))