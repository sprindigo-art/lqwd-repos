import sys

from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

sys.path.insert(0, "/path/to/module")
import psycopg2

# Connect to the database
conn = psycopg2.connect(
    host="192.168.123.59",
    port="5434",
    database="routing_vm",
    user="postgres",
    password="password"
)


def show_query(title, qry):
    print('%s' % (title))
    cur.execute(qry)
    for row in cur.fetchall():
        print(row)
    print('')


# Open a cursor to perform database operations
cur = conn.cursor()

# conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
# cur = conn.cursor()
# show_query('current database', 'SELECT current_database()')
#
# show_query('available databases', 'SELECT * FROM pg_database')
sql = "select * from chan_pubkey_view where local_pubkey = '02b1afba6153f9668ea0be12f4dbfc396a782a52d3eccf868732a1088eb2cc5d69' limit 10000"
cur.execute(sql)

result0 = cur.fetchall()
i = 0
for row0 in result0:
    print("---------------------------------------------------------------")
    i = i + 1
    sql = 'SELECT * from  lnd_node_channel_info where chan_id = ' + str(row0[0]) + '  order by id desc limit 3 ;'

    # Fetch the result of the query

    cur.execute(sql)

    print(i, sql, cur.rowcount)

    count = cur.fetchone()
    indicator = [0, 0, 0]
    # Fetch all the rows and save to a list of tuples
    results = cur.fetchall()
    result_indicator = 0

    for row in results:
        result_indicator = result_indicator + 1
        # print(row)
        localPubkey = row[2]
        remotePubkey = row[3]
        channelPoint = row[4]
        chanId = row[5]
        capacity = row[6]
        localBalance = row[7]
        remoteBalance = row[8]
        cur.execute("select * from lnd_node_info where pubkey = '" + localPubkey + "' limit 1")
        aliasName = cur.fetchone()
        if aliasName:
            aliasName = aliasName[2]
            print(aliasName + " alias name **************")

        print(f"{localBalance} - local balance, {capacity} - capacity ")

        if localBalance < capacity * 0.40:
            print(str(chanId) + " Local -- need to rebalance first indicator")
            indicator[0] = 1

        sql2 = "select to_char(to_timestamp(timestamp_ns::bigint / 1000000000), 'YYYY-MM-DD HH24:MI:SS') as tx, * from lnd_node_forwards where chan_id_in = " + str(
            chanId);
        cur.execute(sql2)
        count_forwards = cur.rowcount
        print(f"forwarded tx number is {count_forwards}")

        if count_forwards > 100:
            print(str(chanId) + " Local -- need to rebalance second indicator")
            indicator[1] = 1

        tx_results = cur.fetchall()
        tx_row_i = 0
        for tx_row in tx_results:
            # print(tx_row)
            tx_row_i = tx_row_i + 1
            print(tx_row[0] + " amount : ", tx_row[4])
            if tx_row_i > 10:
                break

        if indicator[0] > 0 and indicator[1] > 0:
            amountBalance = str(capacity - localBalance)
            maxFee = str(count_forwards * 2)

            insertSql = f"insert into ai_rebalance_channels (lnd_node, channel_id, channel_point, amount_to_balance, max_fee, balanced) " \
                        f"values('{aliasName}', {chanId}, '{channelPoint}', {amountBalance}, {maxFee}, false )"
            print("##################################")
            print(insertSql)
            cur.execute(insertSql)
            conn.commit()
            print("##################################")
        if result_indicator >= 1:
            break
        # result2 = cur.fetchall()
        #
        # for row2 in result2:
        #     print(row2)

# # Print the number of records
# print(f"There are {count} records in your_table")
#
# # Execute the SELECT query to group by chain_id
# cur.execute('SELECT chan_id, count(id) FROM "lnd_node_channel_info" GROUP BY chan_id')

# Create a new table to save the results
# cur.execute("CREATE TABLE channels_id (chain_id VARCHAR(255), total_value NUMERIC)")
# cur.execute("delete from table channels_id");
# # Loop through the results and insert each row into the new table
# for row in results:
#     cur.execute("INSERT INTO channels_id (chain_id, total_value) VALUES (%s, %s)", row)
#
# # Commit the changes to the database
# conn.commit()
#
# Close the cursor and connection
cur.close()
conn.close()
