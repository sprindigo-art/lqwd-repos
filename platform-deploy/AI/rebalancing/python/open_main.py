import get_node_info
import open_config
import open_lib as ol
import psycopg2

# Connection parameters for development database
dev_db_params = {
    "host": "192.243.215.105",
    "port": 25434,
    "database": "routing_vm",
    "user": "postgres",
    "password": "password"
}
#config params
parse = True
openChannelStringCommand = True
clean_table_true = True
clean_each_record_Db = True


def open_channels():
    get_node_info.main_r()

    if openChannelStringCommand:
        conn = psycopg2.connect(**dev_db_params)

        m_records = ol.select_pubkeys(conn)
        total = len(m_records)
        print("total len : "+str(total))
        if len(m_records) <= 0:
            print(f"records in Db is zero")
            exit(1)

        pubkey_array = {}
        number_of_tx_i = 1
        for record in m_records:
            print(record)

            #            ip, port = record[4].split(":")
            #            if is_ip_from_canada(ip):
            check_if_already_connected = ol.check_if_connected(conn, record[1])
            if check_if_already_connected:
                print(f"Already connected node {record[1]}")
                continue

            pubkey_ip_port = record[1] + "@" + record[4]
            try_to_peer_connect = ol.peer_connection(pubkey_ip_port)
            if try_to_peer_connect == 'timeOut':
                print(f"TimeOut for pubkey:{pubkey_ip_port}")
                ol.update_pubkey(conn, record[1], 'timeOut')
                print("status updated")
                continue
            if try_to_peer_connect:
                continue

            #adding pubkey as a key and amount as a value to the list
            funding = record[13]
            if funding == '0':
                funding = open_config.local_funding

            pubkey_array[record[1]] = funding
            print(pubkey_array)
            exit(1)

            #
            #            else:
            #                print(f"{ip} is not from Canada.")
            print(f" Total number in array before next step is: {len(pubkey_array)}")
            if len(pubkey_array) >= open_config.number_of_nodes_in_request:
                print(pubkey_array)
                command_string = ol.generate_command(pubkey_array, open_config.sat_vt, open_config.base_fee, open_config.fee_rate)
                result, result_string = ol.run_command(command_string)
                print(f"The result is  {result} and result string : {result_string}")
                if result:
                    #save to DB
                    ol.save_open_channel_result(conn, result_string, pubkey_array)
                    number_of_tx_i += 1
                else:
                    #checking error
                    #search pubkeys in error string
                    error_result, pubkey_array, error_pubkey = ol.search_pubkey_in_message(result_string, pubkey_array)
                    print(f"{pubkey_array} this after  error message search")
                    btc_min_amout = ol.find_btc_amounts(result_string)
                    ol.update_btc_min_amount(conn, btc_min_amout, error_pubkey)
            # save_error_result_id_db(error_result, pubkey_array, result_string)
            #                exit(1)
            if number_of_tx_i >= open_config.number_of_tx:
                print(f"total number of successed tx is: {number_of_tx_i}")
                break
            else:
                print(f"total number tx is: {number_of_tx_i}")
            if len(pubkey_array) >= open_config.number_of_nodes_in_request +3:
                print(f"total number of successed tx is: {number_of_tx_i}")
                exit(1)




#Open batch channel example
# lncli --tlscertpath tls.cert --macaroonpath data/chain/bitcoin/mainnet/admin.macaroon batchopenchannel --sat_per_vbyte=10 '[
# {
#     "node_pubkey": "03ac61c971d146787a036f75e80a9fbede238a75d0c396f1fe996def00f0ac5dbe",
#     "local_funding_amount": 15000000
# },
# {
#     "node_pubkey": "0242c1650f320c43f3600ebf3b5fcaf566760fcd421f35b68fd1e39a31b29ef540",
#     "local_funding_amount": 10000000
# },
# {
#     "node_pubkey": "038a76001327217efd35d5f286779871818191030cf3c41ff48c215f4a6c942e5c",
#     "local_funding_amount": 1500000
# }
# ]
# Fetch and print matching records
# Connect to the database


if __name__ == "__main__":
    open_channels()
