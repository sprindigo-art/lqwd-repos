from datetime import date, timedelta


class DBlib:

    def __init__(self, debug):
        debug = debug

    def select_data(connection, table, last_id, row_numbers):
        query = f"SELECT  FROM {table} WHERE id > %s LIMIT %s;"
        with connection.cursor() as cursor:
            cursor.execute(query, (last_id, row_numbers,))
            column_names = [desc[0] for desc in cursor.description]
            rows = cursor.fetchall()
            return column_names, rows

    def select_pubkeis(connection, table):
        query = f"SELECT pubkey FROM {table} GROUP BY pubkey;"
        with connection.cursor() as cursor:
            cursor.execute(query)
            rows = cursor.fetchall()
            return rows

    def select_chan_ids(connection, table, local_pubkey):
        query = f"SELECT * FROM {table} where local_pubkey = '{local_pubkey}';"
        with connection.cursor() as cursor:
            cursor.execute(query)

            rows = cursor.fetchall()
            count = cursor.rowcount
            return count, rows

    def select_node_info(connection, table, pubkey):
        query = f"SELECT * FROM {table} WHERE  id =(SELECT MAX(id) from {table} where pubkey = '{pubkey}');"
        with connection.cursor() as cursor:
            cursor.execute(query)
            row = cursor.fetchone()
            return row

    def select_channel_info(connection, table, chan_id):
        query = f"SELECT * FROM {table} WHERE  id =(SELECT MAX(id) from {table} where chan_id = '{chan_id}');"
        with connection.cursor() as cursor:
            cursor.execute(query)
            row = cursor.fetchone()
            return row

    def db_save_result(connection, alias_name, chan_id, channel_point, amount_balance, max_fee):
        with connection.cursor() as cursor:
            insertSql = f"insert into ai_rebalance_channels (lnd_node, channel_id, channel_point, amount_to_balance, max_fee, balanced) " \
                        f"values('{alias_name}', {chan_id}, '{channel_point}', {amount_balance}, {max_fee}, false )"
            print("##################################")
            print(insertSql)
            cursor.execute(insertSql)
            connection.commit()

    def count_number_of_tx_on_channel(connection, chan_id):
        sql = f"select to_char(to_timestamp(timestamp_ns::bigint / 1000000000), 'YYYY-MM-DD HH24:MI:SS') as tx, * from lnd_node_forwards where chan_id_in = {chan_id}"
        print(sql)
        with connection.cursor() as cursor:
            cursor.execute(sql)
            count_forwards = cursor.rowcount
            print(f"forwarded tx number is {count_forwards}")
            return count_forwards
        return 0

    def get_last_rebalance(connection, chan_id):
        sql = f"select * from ai_rebalance_channels where channel_id = {chan_id}  order by created_at limit 1"
        print(sql)
        with connection.cursor() as cursor:
            cursor.execute(sql)
            row = cursor.fetchall()
            if len(row) == 0:
                return 0
            row = row[0]
            print(f"checking last rebalancing {row}")
            other_date = row[7]
            print(f"checking other date {other_date}")
            other_date = row[7].date()
            # Get today's date
            today = date.today()
            # Calculate the duration
            ten_days = timedelta(days=10)
            one_month = timedelta(days=30)

            # Compare the dates
            if other_date < today:
                print("The other date is in the past.")
            elif other_date == today:
                print("The other date is today.")
            elif today - other_date <= ten_days:
                print("in 10 days range")
            elif today - other_date <= one_month:
                print("in one monte rage")
            else:
                print("The other date is in the future.")

            if row[6]:
                return 1

        return 0
