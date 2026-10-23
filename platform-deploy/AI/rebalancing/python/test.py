import subprocess
import json
import psycopg2
import geoip2.database
import get_node_info


def save_open_channel_result(connection, open_result, pubkey_array):
    # Insert data into the table
    # Define SQL insert statements
    insert_sql = """
        INSERT INTO open_channels_results (
            open_result, pubkey_array, status
        ) VALUES (
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

def open_channels():


    # Connection parameters for development database
    dev_db_params = {
        "host": "192.168.123.59",
        "port": 5434,
        "database": "routing_vm",
        "user": "postgres",
        "password": "password"
    }
    conn = psycopg2.connect(**dev_db_params)

    data1 = '''
    lncli --tlscertpath /lnd/tls.cert --macaroonpath /lnd/data/chain/bitcoin/mainnet/admin.macaroon batchopenchannel --sat_per_vbyte=20 '[{"node_pubkey": "03b9aacb265dc5ebde04b91b28f7c8bb6ba0af146e5f37426915742daf8f195a09", "local_funding_amount":2000000},
{"node_pubkey": "035cf526f4c01ed693bacd7434461b9dc53d65b910fb3006110d8b42a574858fb2", "local_funding_amount":2000000},
{"node_pubkey": "03c445275ee7d79ee5778ca2ac81b7c4d84aed7ee04629e8d8f35434b3c21e2da8", "local_funding_amount":2000000},
{"node_pubkey": "02ef503ab9f9fe3d78a83b4124c8ab9777fd08702b205034e6e8bd8d9d2cb84527", "local_funding_amount":2000000},
{"node_pubkey": "03f3643570433b67f22ef1c2e7660e33c9b9d53f786cb1779544983aa5c8f286e3", "local_funding_amount":2000000},
{"node_pubkey": "0351fabd839e93962826ab8eff7f86795b66b7295a2330773938d409a725aa8176", "local_funding_amount":2000000},
{"node_pubkey": "03797da684da0b6de8a813f9d7ebb0412c5d7504619b3fa5255861b991a7f86960", "local_funding_amount":2000000},
{"node_pubkey": "03434a39cd9a537c852fc8fb72454086d726f9111e9f730cef4985c39c11fae944", "local_funding_amount":2000000},
{"node_pubkey": "036ff83834666d3ebfe61c2a7d1f8fc5d6b339a26559a61819e2b0d1b5f540fdfc", "local_funding_amount":2000000},
{"node_pubkey": "028ed7bd6ba6763cf040869681890bf5bf95d623108a60e75d76a57f5d637be3ef", "local_funding_amount":2000000},
{"node_pubkey": "0379221a4051d4171490e43e4a09e218a02941f06996b71cd814b290da08ad5f7e", "local_funding_amount":2000000},
{"node_pubkey": "03a465772d45616bf6c8450a69191db8f3cf8cca19ff92138735fd5f1d436fe4dc", "local_funding_amount":2000000},
{"node_pubkey": "03501a74753e0f6ae270a1e4e2ffbbc37f7a796360e650c1121c18e116b22ac106", "local_funding_amount":2000000},
{"node_pubkey": "03fbe1c1baedbc99b2642ae524d9c2a6f12b771a3ab91e0f56ca6efc6f7f7d53b6", "local_funding_amount":2000000},
{"node_pubkey": "03627ebe50fc6eb80b0caab0c3714958c701eda735e3c29588e83150d6d4a93976", "local_funding_amount":2000000},
{"node_pubkey": "0380030304baea090616a296674b6ae337a138593b5390266a45a17eef7a62a2b0", "local_funding_amount":2000000},
{"node_pubkey": "037172d2110c4148d6ed0c2790ec8be948458022425dced6794fede834be92af36", "local_funding_amount":2000000},
{"node_pubkey": "03edfc1919ca6fe4de6a6645e544486bf5a651122fdb2172b6c96ce3fb68956d51", "local_funding_amount":2000000},
{"node_pubkey": "037f6c805dfef7a0f01cca0abcea96352a32aa478c63c974bc2e726cad8d026a89", "local_funding_amount":2000000},
{"node_pubkey": "03a01da97af71f7859cd1b2b6a70f221ecd49f6eabf0bf1e267bae9570b47232a6", "local_funding_amount":2000000}]'

'''
    data2 = '''
Success:  {
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 17
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 9
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 5
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 18
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 11
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 19
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 6
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 1
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 0
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 15
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 3
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 16
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 13
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 12
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 8
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 14
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 10
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 2
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 4
}
{
	"funding_txid": "b118e2f5494e53302d817ef1132a207b01b08d0ee057cdf949c92f2ed87decf3",
	"funding_output_index": 7
}

'''
    pubkey_array = []
    save_open_channel_result(conn, data2, pubkey_array)


if __name__ == "__main__":
    open_channels()