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
from reportTools.cipher_api_handler import CipherAPIHandler
from config.config import ConfigLND as Config


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

    # get macaroon file for node
    def create_macaroon_or_tls_file(self, filename, data):
        file = open(filename, "wb")
        file.write(data)
        file.close()

    # get macaroon data from db
    @retry(wait_fixed=10000)
    def get_macaroon_and_tls_cert(self, service_address, macaroon=True):
        try:
            cipher_api_handler = CipherAPIHandler()
            admin_macaroon = None
            tls_cert = None
            print(service_address)
            # set sql stmnt
            sql = "SELECT DISTINCT file_name, sfile, id FROM lnd_main_v2 WHERE node_name='{}' AND file_name LIKE " \
                  "'%admin.macaroon' OR node_name='{}' AND file_name LIKE '%tls.cert' LIMIT 2;".format(service_address,
                                                                                                       service_address,
                                                                                                       service_address)

            # get connection and create cursor
            con = self.connect_to_postgres()
            cursor = con.cursor()

            cursor.execute(sql)
            rows = cursor.fetchall()

            if self.debug:
                print(f"Getting Macroon File and TLS Cert - Row: {len(rows)}")

            # get admin macaroon file
            for row in rows:
                if 'admin.macaroon' in str(row[0]):
                    decrypted_data = cipher_api_handler.decrypt_macaroon(row[2])
                    print(decrypted_data)
                    admin_macaroon = base64.b64decode(decrypted_data)
                    if macaroon:
                        if self.debug: print("Creating Admin Macaroon File")
                        self.create_macaroon_or_tls_file("admin.macaroon", admin_macaroon)
                        if self.debug: print("Finished Admin Macaroon File")

                # get tls file
                if 'tls.cert' in str(row[0]):
                    tls_cert = row[1]
                    if self.debug: print("Creating TLS File")
                    self.create_macaroon_or_tls_file("tls.cert", tls_cert)
                    if self.debug: print("Finished TLS File")

            con.close()
            return admin_macaroon, tls_cert

        except Exception as e:
            print("Exception get_macaroon_and_tls_cert {}".format(e))
            print("Retrying in 10 Seconds")
