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


def create_macaroon_or_tls_file(filename, data):
    file = open(filename, "wb")
    file.write(data)
    file.close()


# get macaroon data from db
@retry(wait_fixed=10000)
def get_macaroon_and_tls_cert(service_address, macaroon=True):
    try:
        cipher_api_handler = CipherAPIHandler()
        admin_macaroon = None
        tls_cert = None
        # set sql stmnt
        sql = "SELECT DISTINCT file_name, sfile, id FROM lnd_main_v2 WHERE node_name='{}' AND file_name LIKE " \
              "'%admin.macaroon' OR node_name='{}' AND file_name LIKE '%tls.cert' LIMIT 2;".format(
            service_address, service_address, service_address)

        # get connection and create cursor
        con = connect_to_postgres()
        cursor = con.cursor()

        cursor.execute(sql)
        rows = cursor.fetchall()

        # get admin macaroon file
        for row in rows:
            if 'admin.macaroon' in str(row[0]):
                decrypted_data = cipher_api_handler.decrypt_macaroon(row[2])
                admin_macaroon = base64.b64decode(decrypted_data)
                if macaroon:
                    create_macaroon_or_tls_file("admin.macaroon", admin_macaroon)

            # get tls file
            if 'tls.cert' in str(row[0]):
                tls_cert = row[1]
                create_macaroon_or_tls_file("tls.cert", row[1])

        con.close()
        return admin_macaroon, tls_cert
    except Exception as e:
        print(f"Exception occurred when getting macaroon and tls: {e}")
        print("Retrying in 10 Seconds")
