import base64
import psycopg2
from retrying import retry
import config as config


@retry(wait_fixed=10000)
def connect_to_postgres():
    try:
        db_config = config.read_config()
        # connect to DB and return connection
        connection = psycopg2.connect(user=db_config['user'], password=db_config['password'],
                                      host=db_config['host'], port=db_config['port'],
                                      database=db_config['database'])
        return connection
    except Exception as e:
        print("Exception {}".format(e))
        print("Retrying in 10 Seconds")


def create_file(filename, data):
    file = open(filename, "wb")
    file.write(data)
    file.close()


# get macaroon data from db
@retry(wait_fixed=10000)
def get_btc_transactions(pubkey, date_from, date_to):
    try:

        sql = "SELECT * FROM public.lnd_node_transaction_info where lnd_alias = '{}' "\
            "and timestamp between '{}'::timestamp and '{}' ORDER BY id DESC ".format(pubkey, date_from, date_to)
        # get connection and create cursor
        con = connect_to_postgres()
        cursor = con.cursor()

        cursor.execute(sql)
        rows = cursor.fetchall()
        file = open(filename, "wb")
        # get admin macaroon file
        for row in rows:
            new_line = ""
            for col in row:
                new_line = new_line + "," + col
            file.write(new_line + "\n")

        con.close()
        file.close
        
    except Exception as e:
        print(f"Exception occurred when getting btc_trasactions with {pubkey} from {date_from} to {date_to}: {e}")
        print("Retrying in 10 Seconds")
