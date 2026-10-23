import subprocess
import json
import psycopg2
import geoip2.database
import re


def generate_command(pubkey_array, sat_vt, base_fee, fee_rate):
    batch_string = "lncli --tlscertpath /lnd/tls.cert --macaroonpath /lnd/data/chain/bitcoin/mainnet/admin.macaroon batchopenchannel --sat_per_vbyte=" + str(sat_vt) +" '[\n"
    for pubkey in pubkey_array:
        batch_string += '{"node_pubkey": "' + pubkey + '", "local_funding_amount":'+str(pubkey_array[pubkey])+', "base_fee": ' + base_fee + ', "fee_rate": ' + fee_rate + ' },\n'
    batch_string = batch_string[:-2] + "]'"
    print(batch_string)
    return batch_string

def find_btc_amounts(input_string):
    btc_pattern = r'is below min chan size of (\d+\.\d+) BTC'
    btc_amounts = re.findall(btc_pattern, input_string)
    print(f"find btc amounts in Error string is : {btc_amounts}")
    return btc_amounts


def run_command(command_string):
    try:
        result = subprocess.run(command_string, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=100, shell=True, text=True)
        if result.returncode == 0:
            print("Success: ", result.stdout)
            return True, result.stdout
        else:
            print("Error:", result.stderr)
            return False, result.stderr

    except Exception as e:
        print("An error occurred:", str(e))
        return False, str(e)
def search_pubkey_in_message(res_string, pubkey_array):
    new_pubkey_array = {}
    indicator = True
    pubkey_in_message = ''
    if "cannot open channel to self" in res_string:
        res_string += ' 0364913d18a19c671bb36dd04d6ad5be0fe8f2894314c36a9db3f03c2d414907e1'
    for pubkey in pubkey_array:
        if pubkey in res_string.lower():
            print(f"pubkey in string: {pubkey}")
            indicator = False
            pubkey_in_message = pubkey
        else:
            new_pubkey_array[pubkey] = pubkey_array[pubkey]
    return indicator, new_pubkey_array, pubkey_in_message

def update_btc_min_amount(connection, btc_min_amount, pubkey):
    updateSql = f''' UPDATE canada_nodes_peer SET min_capacity = '{btc_min_amount}'  where pub_key = '{pubkey}'    '''
    print(updateSql)
    print(f"Min amount for pubkey : {pubkey} is updated to : {btc_min_amount}")
    with connection.cursor() as cursor:
        cursor.execute(updateSql)
        connection.commit()


def save_open_channel_result(connection, open_result, pubkey_array):
    # Insert data into the table
    # Define SQL insert statements
    insert_sql = """
        INSERT INTO open_channels_results (open_result, pubkey_array, status) VALUES (
            %(open_result)s, %(pubkey_array)s, %(status)s
        );
    """
    data = {}
    try:
        with connection.cursor() as cursor:
            data['open_result'] = open_result
            data['pubkey_array'] = ' '.join(map(str, pubkey_array))
            data['status'] = 'requested'
            cursor.execute(insert_sql, data)
            connection.commit()
    except psycopg2.Error as e:
        connection.rollback()  # Rollback the transaction if an error occurs
        print("An error occurred while inserting data:", e)

def peer_connection(pubkey_ip_port):
    command = "lncli --tlscertpath /lnd/tls.cert --macaroonpath /lnd/data/chain/bitcoin/mainnet/admin.macaroon connect "
    command = command + pubkey_ip_port
    print(command)
    connection_result = True
    try:
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,timeout=10, shell=True, text=True)
        if result.returncode == 0:
            ok_result = '''{}'''
            json_output = json.loads(result.stdout)
            print(f"json_out : {json_output}")
            dump_json_output = json.dumps(json_output, indent=2)
            print(f"dump json out {dump_json_output}")
            if ok_result in json_output:
                print("json output connected")
            if ok_result in dump_json_output:
                print("dump json output connected")
            if "Already connected" in dump_json_output:
                print("connected")
            connection_result = False
        else:
            print("Error in Peer connection :", result.stderr)
    except subprocess.TimeoutExpired:
        print("Command exceeded the 20-second timeout")
        return "timeOut"
    except Exception as e:
        print("An error occurred in peer connection :", str(e))
    return connection_result

def check_pubkey_in_db(connection, pubkey):
    sql = f"select pub_key from canada_nodes_peer where pub_key = '{pubkey}'"
    print(sql)
    with connection.cursor() as cursor:
        cursor.execute(sql)
        count_forwards = cursor.rowcount
        return count_forwards
    return 0


def check_if_connected(connection, pubkey):
    sql = f"select remote_pubkey from channel_data where remote_pubkey = '{pubkey}'"
    #    print(sql)
    with connection.cursor() as cursor:
        cursor.execute(sql)
        count_forwards = cursor.rowcount
        if count_forwards > 0:
            return True
    sql = f"select remote_node_pub from pending_open_channels where remote_node_pub = '{pubkey}'"
    #   print(sql)
    with connection.cursor() as cursor:
        cursor.execute(sql)
        count_forwards = cursor.rowcount
        if count_forwards > 0:
            return True

    return False
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

    # SQL query to fetch records
    query = """ SELECT * FROM canada_nodes_peer WHERE  status is null and num_channels < 200 ORDER BY num_channels DESC """

    cursor.execute(query)
    matching_records = cursor.fetchall()

    # Close cursor and connection
    cursor.close()
    return matching_records

def select_pubkeys_by_ip(connection):
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
        if response.country.iso_code == 'CA' or response.country.iso_code == 'US':
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

