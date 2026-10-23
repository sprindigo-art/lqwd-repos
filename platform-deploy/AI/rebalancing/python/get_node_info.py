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


def main_r():
    # Connection parameters for development database

    clean_table_true = False
    clean_each_record_Db = False
    canada_node_pubkey = '0364913d18a19c671bb36dd04d6ad5be0fe8f2894314c36a9db3f03c2d414907e1'
    with psycopg2.connect(**dev_db_params) as conn:
        del_conn = psycopg2.connect(**dev_db_params)
        if clean_table_true:
            clean_canada_node_peers(del_conn)
        #            del_conn.close()



        command = "lncli --tlscertpath /lnd/tls.cert --macaroonpath /lnd/data/chain/bitcoin/mainnet/admin.macaroon listchannels "

        print(command)

        try:
            result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True, text=True)
            if result.returncode == 0:

                json_output = json.loads(result.stdout)
                dump_json_output = json.dumps(json_output, indent=2)
                #                print(dump_json_output)
                for channel_info in json_output['channels']:
                    print(channel_info)
                    check_in_pending = check_pubkey_in_db(conn, channel_info['remote_pubkey'], 'pending_open_channels', 'remote_node_pub')
                    if check_in_pending > 0:
                        update_pending_status(conn, channel_info['remote_pubkey'], 'connected')
                    insert_channel_info(conn, channel_info)

            else:
                print("Error:", result.stderr)
        except Exception as e:
            print("An error occurred:", str(e))

        if clean_table_true:
            clean_canada_pending_peers(del_conn)
        #            del_conn.close()

        command = "lncli --tlscertpath /lnd/tls.cert --macaroonpath /lnd/data/chain/bitcoin/mainnet/admin.macaroon pendingchannels "

        print(command)

        try:
            result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True, text=True)
            if result.returncode == 0:

                json_output = json.loads(result.stdout)
                dump_json_output = json.dumps(json_output, indent=2)
                #                print(dump_json_output)
                for channel_info in json_output['pending_open_channels']:

                    insert_pending_channel_info(conn, channel_info)

            else:
                print("Error:", result.stderr)
        except Exception as e:
            print("An error occurred:", str(e))


def update_pending_status(connection, pubkey, status='connected'):
    updateSql = f'''
    UPDATE pending_open_channels SET status ='{status}' where remote_node_pub = '{pubkey}'
    '''
    print(updateSql)
    with connection.cursor() as cursor:
        cursor.execute(updateSql)
        connection.commit()




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

def check_pubkey_in_db(connection, pubkey, table, col_name):
    sql = f"select {col_name} from {table} where {col_name} = '{pubkey}'"
    print(sql)
    with connection.cursor() as cursor:
        cursor.execute(sql)
        count_forwards = cursor.rowcount
        return count_forwards
    return 0

def insert_pending_channel_info(connection, item):
    # Insert data into the table
    sqlString = """INSERT INTO pending_open_channels (remote_node_pub, channel_data, commit_fee, commit_weight, fee_per_kw, status) VALUES (
      %(remote_node_pub)s, %(channel)s, %(commit_fee)s, %(commit_weight)s, %(fee_per_kw)s, %(status)s
    );"""
    print(sqlString)
    try:
        with connection.cursor() as cursor:
            channel = json.dumps(item['channel'])
            print(channel)
            item['remote_node_pub'] = item['channel']['remote_node_pub']
            print(item['remote_node_pub'])
            print("-----------------")
            item['status'] = 'pending'
            item['channel'] = channel
            print(item)
            cursor.execute(sqlString, item)


            connection.commit()
    except psycopg2.Error as e:
        connection.rollback()  # Rollback the transaction if an error occurs
        print("An error occurred while inserting data:", e)


def insert_channel_info(connection, data):
    # Insert data into the table
    # Define SQL insert statements
    insert_sql = """
        INSERT INTO channel_data (
            active, remote_pubkey, channel_point, chan_id, capacity,
            local_balance, remote_balance, commit_fee, commit_weight, fee_per_kw,
            unsettled_balance, total_satoshis_sent, total_satoshis_received, num_updates,
            csv_delay, private, initiator, chan_status_flags, local_chan_reserve_sat,
            remote_chan_reserve_sat, static_remote_key, commitment_type, lifetime,
            uptime, close_address, push_amount_sat, thaw_height, zero_conf,
            zero_conf_confirmed_scid, peer_alias, peer_scid_alias, local_constraints,
            remote_constraints, alias_scids, pending_htlcs
        ) VALUES (
            %(active)s, %(remote_pubkey)s, %(channel_point)s, %(chan_id)s, %(capacity)s,
            %(local_balance)s, %(remote_balance)s, %(commit_fee)s, %(commit_weight)s, %(fee_per_kw)s,
            %(unsettled_balance)s, %(total_satoshis_sent)s, %(total_satoshis_received)s, %(num_updates)s,
            %(csv_delay)s, %(private)s, %(initiator)s, %(chan_status_flags)s, %(local_chan_reserve_sat)s,
            %(remote_chan_reserve_sat)s, %(static_remote_key)s, %(commitment_type)s, %(lifetime)s,
            %(uptime)s, %(close_address)s, %(push_amount_sat)s, %(thaw_height)s, %(zero_conf)s,
            %(zero_conf_confirmed_scid)s, %(peer_alias)s, %(peer_scid_alias)s, %(local_constraints)s,
            %(remote_constraints)s, %(alias_scids)s, %(pending_htlcs)s
        );
    """



    try:
        with connection.cursor() as cursor:
            data['local_constraints'] = json.dumps(data['local_constraints'])
            data['remote_constraints'] = json.dumps(data['remote_constraints'])
            data['peer_alias'] = data['peer_alias'].replace("\'", " ");
            cursor.execute(insert_sql, data)
            connection.commit()
    except psycopg2.Error as e:
        connection.rollback()  # Rollback the transaction if an error occurs
        print("An error occurred while inserting data:", e)



def update_pubkey(connection, pubkey, status):
    updateSql = f'''
    UPDATE canada_nodes_peer SET status ='{status}' where pub_key = '{pubkey}'
    '''
    print(updateSql)
    with connection.cursor() as cursor:
        cursor.execute(updateSql)
        connection.commit()

def clean_canada_node_peers(connection):
    deleteSql = '''DELETE FROM channel_data'''
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


def clean_canada_pending_peers(connection):
    deleteSql = '''DELETE FROM pending_open_channels'''
    print(deleteSql)
    with connection.cursor() as cursor:
        cursor.execute(deleteSql)
        connection.commit()



#
#
# if __name__ == "__main__":
#     main_r()
