import psycopg2
import datetime

def get_last_id(connection, table):
    query = f"SELECT MAX(id) FROM {table};"
    with connection.cursor() as cursor:
        cursor.execute(query)
        result = cursor.fetchone()
        return result[0] if result[0] else 0

def select_column_names(connection, source_table):
    query = f"SELECT * FROM {source_table} WHERE id = 20;"
    with connection.cursor() as cursor:
        cursor.execute(query)
        result = cursor.fetchall()
        #print(result)
        return result

def select_data(connection, table, last_id, row_numbers):
    query = f"SELECT * FROM {table} WHERE id > %s LIMIT %s;"
    with connection.cursor() as cursor:
        cursor.execute(query, (last_id,row_numbers,))
        column_names = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()
        return column_names, rows

def insert_data(connection, target_table, column_names, data):
    print(data[0])
    placeholders = ", ".join(["%s"] * len(data[0]))
    columns = ", ".join(column_names)
    query = f"INSERT INTO {target_table} ({columns}) VALUES ({placeholders});"
    with connection.cursor() as cursor:
        cursor.executemany(query, data)
        connection.commit()

def insert_data_replace(connection, target_table, column_names, data):

    placeholders = ", ".join(["%s"] * len(data[0]))
    # placeholders = placeholders.replace('\u2607', '')
    columns = ", ".join(column_names)
    query = f"INSERT INTO {target_table} ({columns}) VALUES ({placeholders});"
    with connection.cursor() as cursor:
        cursor.executemany(query, data)
        connection.commit()

# Connection parameters for development database
dev_db_params = {
    "host": "192.243.215.105",
    "port": 25434,
    "database": "routing_vm",
    "user": "postgres",
    "password": "password"
}

# Connection parameters for production database
prod_db_params = {
    "host": "lqwd-routing-nodes.csvn42eedrmo.us-west-2.rds.amazonaws.com",
    "port": 5432,
    "database": "routing_vm",
    "user": "postgres",
    "password": "1M4M2LJaKIXrRlrKPE09"
}


# Table names and column names
tables = ["lnd_node_channel_info", "lnd_node_closed_channels", "lnd_node_forwards", "lnd_node_info", "lnd_node_peer_info", "lnd_node_pending_channels", "lnd_node_transaction_info"]

# Establish a connection to the database
with psycopg2.connect(**dev_db_params) as dev_conn, psycopg2.connect(**prod_db_params) as prod_conn:
    iii = 1
    for table in tables:
        row_numbers = 10000
        indicator_done = True
        while indicator_done:
            # Get the last ID from the table
            last_id = get_last_id(dev_conn, table)

            # Select data from the table where ID is greater than the last ID
            column_names, data = select_data(prod_conn, table, last_id, row_numbers)
            iii = iii + 1
            if data:
                # Insert the selected data back into the same table
                if table == "lnd_node_info":
                    insert_data_replace(dev_conn, table, column_names, data)
                else :
                    insert_data(dev_conn, table, column_names, data)
                # Get the current date and time
                current_datetime = datetime.datetime.now()

                # Print the current date and time
                print("Current date and time:", current_datetime)
                print(f"N_ {iii} : Inserted {len(data)} row(s) into {table}.")
            else:
                indicator_done = False
                print(f"No {iii} new data to insert into {table}.")

