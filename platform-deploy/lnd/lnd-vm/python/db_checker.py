import os

import psycopg2
import config
from psycopg2 import sql


def check_and_create_db(database_name):
    lnd_config = config.read_config("lnd.ini", "lnd")
    user = lnd_config['db_user']
    password = lnd_config['db_password']
    host = os.getenv("LND_DB_HOST")
    port = os.getenv("LND_DB_PORT")

    connection = None
    try:
        # In PostgreSQL, default username is 'postgres' and password is 'postgres'.
        # And also there is a default database exist named as 'postgres'.
        # Default host is 'localhost' or '127.0.0.1'
        # And default port is '54322'.
        print('database connection start')
        connection = psycopg2.connect(user=user, password=password, host=host, port=port, dbname='postgres')
        print('Database connected for checking.')

    except Exception as e:
        print('Database not connected for checking. Connection Error.', e)
    result = False

    if connection is not None:
        connection.autocommit = True
        cur = connection.cursor()
        cur.execute("SELECT datname FROM pg_database;")
        list_database = cur.fetchall()

        if (database_name,) in list_database:
            print("'{}' Database already exist".format(database_name))
            result = True
        else:
            # use the sql module instead to avoid SQL injection attacks
            cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))
            print("'{}' Database created".format(database_name))
            result = True
        connection.close()
        print('Checking database connection and database exist done')
    return result
