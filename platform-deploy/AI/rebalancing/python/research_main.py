import subprocess
import json
import psycopg2
import geoip2.database

dev_db_params = {
    "host": "192.243.215.105",
    "port": 25434,
    "database": "routing_vm",
    "user": "postgres",
    "password": "password"
}

def get_pubkey_from_file(pubkeys_file):
    # Replace with the path to your file
    p_array = []
    with open(pubkeys_file, 'r') as file:
        # Read and print each line
        for line in file:
            print(line.strip())
            p_array.append(line.strip())
    return p_array

def get_pubkey_from_tables(connection):
    cursor = connection.cursor()
    p_array = []
    # SQL query to fetch records where pubkey is not connected
    query = ''' SELECT pub_key FROM canada_nodes_peer where status is NULL  or status not like 'not_connected' '''
    print(query)
    cursor.execute(query)
    matching_records = cursor.fetchall()

    if len(matching_records) > 0:
        for record in matching_records:
            pkey = record[0]
            p_array.append(pkey)
    print(f"Number of records in canada_nodes_peer is : {len(p_array)}")
    # SQL query to fetch records where pubkey is not connected
    query = ''' SELECT node2_pub FROM canada_channel_info where status is NULL  or status not like 'not_connected'  '''
    print(query)
    cursor.execute(query)
    matching_records = cursor.fetchall()

    if len(matching_records) > 0:
        for record in matching_records:
            pkey = record[0]
            p_array.append(pkey)
    print(f"Number of records after adding canada_channel_info is : {len(p_array)}")
    # Close cursor and connection
    cursor.close()

    return p_array
def main_r():
    # Connection parameters for development database

    #config params
    search_for_new_pubkeys = True
    openChannelStringCommand = True
    clean_table_true = False
    clean_each_record_Db = False
    pubkeys_file_name = 'pubkey_Canada.txt'
    with psycopg2.connect(**dev_db_params) as conn:
        del_conn = psycopg2.connect(**dev_db_params)
        if clean_table_true:
            clean_canada_node_peers(del_conn)
            del_conn.close()

        if search_for_new_pubkeys:
            #check in DB first and if not exist check file pubkeys.txt
            pubkey_array = get_pubkey_from_tables(conn)
            if len(pubkey_array) < 1:
                print("this is again")
                pubkey_array = get_pubkey_from_file(pubkeys_file_name)
            print(f"Number of records  is : {len(pubkey_array)}")
            output_file_path = 'result_get_peers_info.txt'
            output_file = open(output_file_path, 'w')


            for line in pubkey_array:
                print(line)
                command = "lncli --tlscertpath /lnd/tls.cert --macaroonpath /lnd/data/chain/bitcoin/mainnet/admin.macaroon getnodeinfo "
                command = command + line + " --include_channels"
                print(command)

                try:
                    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True, text=True)
                    if result.returncode == 0:

                        json_output = json.loads(result.stdout)
                        dump_json_output = json.dumps(json_output, indent=2)

                        insertString = db_save_result(conn, json_output, clean_each_record_Db)

                        output_file.write(insertString)
                    else:
                        print("Error:", result.stderr)
                except Exception as e:
                    print("An error occurred:", str(e))
            output_file.close()

def peer_connection(pubkey_ip_port):
    command = "/Users/azizpulatov/lnd-main/lnd/lncli --tlscertpath ~/LND_NODE/tls.cert --macaroonpath ~/LND_NODE/data/chain/bitcoin/mainnet/admin.macaroon connect "
    command = command + pubkey_ip_port
    print(command)
    try:
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True, text=True)
        if result.returncode == 0:

            json_output = json.loads(result.stdout)
            dump_json_output = json.dumps(json_output, indent=2)
            print(dump_json_output)
        else:
            print("Error:", result.stderr)
    except Exception as e:
        print("An error occurred:", str(e))

def check_pubkey_in_db(connection, pubkey):
    sql = f"select pub_key from canada_nodes_peer where pub_key = '{pubkey}'"
    print(sql)
    with connection.cursor() as cursor:
        cursor.execute(sql)
        count_forwards = cursor.rowcount
        return count_forwards
    return 0

def insert_channel_info(connection, data):
    # Insert data into the table
    insert_query = """
    INSERT INTO canada_channel_info (
        channel_id, chan_point, last_update, node1_pub, node2_pub, capacity,
        node1_time_lock_delta, node1_min_htlc, node1_fee_base_msat,
        node1_fee_rate_milli_msat, node1_disabled, node1_max_htlc_msat,
        node1_last_update, node2_time_lock_delta, node2_min_htlc,
        node2_fee_base_msat, node2_fee_rate_milli_msat, node2_disabled,
        node2_max_htlc_msat, node2_last_update
    ) VALUES (
        %(channel_id)s, %(chan_point)s, %(last_update)s, %(node1_pub)s, %(node2_pub)s, %(capacity)s,
        %(node1_time_lock_delta)s, %(node1_min_htlc)s, %(node1_fee_base_msat)s,
        %(node1_fee_rate_milli_msat)s, %(node1_disabled)s, %(node1_max_htlc_msat)s,
        %(node1_last_update)s, %(node2_time_lock_delta)s, %(node2_min_htlc)s,
        %(node2_fee_base_msat)s, %(node2_fee_rate_milli_msat)s, %(node2_disabled)s,
        %(node2_max_htlc_msat)s, %(node2_last_update)s
    );
    """

    if 'node1_policy' in data:
        if data['node1_policy'] is not None:
            node1_policy = data['node1_policy']
            data.update({
                'node1_time_lock_delta': node1_policy.get('time_lock_delta'),
                'node1_min_htlc': node1_policy.get('min_htlc'),
                'node1_fee_base_msat': node1_policy.get('fee_base_msat'),
                'node1_fee_rate_milli_msat': node1_policy.get('fee_rate_milli_msat'),
                'node1_disabled': node1_policy.get('disabled'),
                'node1_max_htlc_msat': int(node1_policy.get('max_htlc_msat')),
                'node1_last_update': node1_policy.get('last_update')
            })
        else:
            data.update({
                'node1_time_lock_delta': 0,
                'node1_min_htlc': 0,
                'node1_fee_base_msat': 0,
                'node1_fee_rate_milli_msat': 0,
                'node1_disabled': False,
                'node1_max_htlc_msat': 0,
                'node1_last_update': 0
            })

    if 'node2_policy' in data:
        if data['node1_policy'] is not None:
            node2_policy = data['node2_policy']
            data.update({
                'node2_time_lock_delta': node2_policy.get('time_lock_delta'),
                'node2_min_htlc': node2_policy.get('min_htlc'),
                'node2_fee_base_msat': node2_policy.get('fee_base_msat'),
                'node2_fee_rate_milli_msat': node2_policy.get('fee_rate_milli_msat'),
                'node2_disabled': node2_policy.get('disabled'),
                'node2_max_htlc_msat': int(node2_policy.get('max_htlc_msat')),
                'node2_last_update': node2_policy.get('last_update')
            })
        else:
            data.update({
                'node2_time_lock_delta': 0,
                'node2_min_htlc': 0,
                'node2_fee_base_msat': 0,
                'node2_fee_rate_milli_msat': 0,
                'node2_disabled': False,
                'node2_max_htlc_msat': 0,
                'node2_last_update': 0
            })

    print(data)
    try:
        with connection.cursor() as cursor:
            cursor.execute(insert_query, data)
            connection.commit()
    except psycopg2.Error as e:
        connection.rollback()  # Rollback the transaction if an error occurs
        print("An error occurred while inserting data:", e)


def db_save_result(connection, data, cleanDb = False):
    node = data['node']
    pub_count = check_pubkey_in_db(connection, node['pub_key']);
    if pub_count > 0 and not cleanDb:
        return f" Pubkey {node['pub_key']} already exist in DB"
    else:
        delete_pubkey_in_db(connection, node['pub_key'])
        print(f"Old {node['pub_key']} deleted successfully")
    lupdate = str(node['last_update'])

    network = ""
    addrIp = ""
    addr = ""
    if 'addresses' in node:
        if len(node['addresses']) > 0 and 'network' in node['addresses'][0]:
            network = node['addresses'][0]['network']
            addrIp = node['addresses'][0]['addr']

        if len(node['addresses']) > 1 and 'network' in node['addresses'][0]:
            addr = node['addresses'][1]['addr']
    wumboo = False
    if 'features' in node:
        if '19' in node['features']:
            wumboo = node['features']['19']['is_known']

    mchannel = False
    if 'features' in node:
        if '17' in node['features']:
            mchannel = node['features']['17']['is_known']
    ancors = False
    if 'features' in node:
        if '23' in node['features']:
            ancors = node['features']['23']['is_known']

    # Insert data into the table
    insertSql = f'''    INSERT INTO canada_nodes_peer (last_update, pub_key, alias, network, addrIP, addr,
            num_channels, total_capacity, multi_path_payments, wumbo_channels, anchors_zero_fee_htlc_tx, created_at
        ) VALUES ({lupdate}, '{node['pub_key']}', '{node['alias'].replace("'", "")}', '{network}', '{addrIp}', '{addr}',  {data['num_channels']}, {data['total_capacity']},
        {mchannel}, {wumboo}, {ancors}, NOW())    '''
    print(insertSql)
    with connection.cursor() as cursor:
        cursor.execute(insertSql)
        connection.commit()
        print(f"Node peer data inserted to table")
    for data1 in data["channels"]:
        print(data1)
        insert_channel_info(connection, data1)
        print(data1['channel_id'])
    return insertSql


def update_pubkey(connection, pubkey, status):
    updateSql = f'''
    UPDATE canada_nodes_peer SET status ='{status}' where pub_key = '{pubkey}'
    '''
    print(updateSql)
    with connection.cursor() as cursor:
        cursor.execute(updateSql)
        connection.commit()

def clean_canada_node_peers(connection):
    deleteSql = '''DELETE FROM canada_nodes_peer;'''
    print(deleteSql)
    with connection.cursor() as cursor:
        cursor.execute(deleteSql)
        connection.commit()

def delete_pubkey_in_db(connection, pubkey):
    deleteSql = f'''DELETE FROM canada_nodes_peer where pub_key = '{pubkey}' '''
    print(deleteSql)
    with connection.cursor() as cursor:
        cursor.execute(deleteSql)
        connection.commit()

def select_pubkeys(connection):
    cursor = connection.cursor()

    # SQL query to fetch records with matching addrIp pattern
    query = """ SELECT * FROM canada_nodes_peer
    WHERE addrIp ~ '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{1,5}$' AND status is null ORDER BY num_channels DESC
    """

    cursor.execute(query)
    matching_records = cursor.fetchall()

    # Close cursor and connection
    cursor.close()
    return matching_records

def is_ip_from_canada(ip_address):
    # Load the MaxMind GeoIP2 database (replace with your database path)
    reader = geoip2.database.Reader('GeoLite2-Country.mmdb')

    try:
        # Get the geolocation information for the IP address
        response = reader.country(ip_address)

        # Check if the country is Canada
        if response.country.iso_code == 'CA':
            return True
        else:
            print(response.country.iso_code)
            return False
    except geoip2.errors.AddressNotFoundError:
        # Handle if the IP address is not found in the database
        return False
    finally:
        reader.close()

def search_pubkey_in_error(error_string, pubkeys):
    for substring in pubkeys:
        if substring in error_string:
            return substring
    return None


if __name__ == "__main__":
    main_r()

