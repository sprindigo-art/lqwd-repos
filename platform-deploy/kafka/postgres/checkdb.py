import psycopg2
from psycopg2 import sql

from configdb import configdb


def checkdb():
    params = configdb()
    dbsname = ['oauth2', 'lnd', 'request']
    params['database'] = 'postgres'
    connection = None
    try:
        # In PostgreSQL, default username is 'postgres' and password is 'postgres'.
        # And also there is a default database exist named as 'postgres'.
        # Default host is 'localhost' or '127.0.0.1'
        # And default port is '54322'.
        connection = psycopg2.connect(**params)
        print('Database connected.')

    except:
        print('Database not connected.')
    result = False
    if connection is not None:
        connection.autocommit = True

        cur = connection.cursor()

        cur.execute("SELECT datname FROM pg_database;")

        list_database = cur.fetchall()

        for database_name in dbsname:
            if (database_name,) in list_database:
                print("'{}' Database already exist".format(database_name))
                result = True
            else:
                # use the sql module instead to avoid SQL injection attacks
                cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))

                print("'{}' Database was not exist and created".format(database_name))

        connection.close()
        print('Done')
    return result
