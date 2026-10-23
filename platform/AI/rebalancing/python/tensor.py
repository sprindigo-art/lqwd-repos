import keras
import numpy
import os
import sys
from datetime import date

# 0 = all messages are logged (default behavior)
# 1 = INFO messages are not printedyTe0IGod2U3kXxLHLESz
# 2 = INFO and WARNING messages are not printed
# 3 = INFO, WARNING, and ERROR messages are not printed
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
import tensorflow as tf
# from tensorflow import keras
from keras import layers

import psycopg2
from db_lib import DBlib
from create_model import Tmodel

# Connection parameters for development database
dev_db_params = {
    "host": "192.168.123.59",
    "port": 5434,
    "database": "routing_vm",
    "user": "postgres",
    "password": "password"
}


def count_indicator(indicator):
    total = 0;
    for i in indicator:
        total = total + i
    return total


def clean_predict(a, b, c, d, f, e, g, model):
    input_tens = tf.constant([[a, b, c, d, f, e, g]])
    c_result = False
    round_res = round(model.predict(input_tens)[0][0])
    if round_res == 1:
        c_result = True
    print(f"predicted result is : {round_res}")
    return c_result


def main():
    # Main code logic goes here
    # result = tf.add(1,2).numpy()
    # print(result)
    tables = ["lnd_node_info", "chan_pubkey_view", "lnd_node_channel_info", "lnd_node_closed_channels",
              "lnd_node_forwards", "lnd_node_peer_info", "lnd_node_pending_channels", "lnd_node_transaction_info"]
    create_model_object = Tmodel(True)
    # dblib = DBlib(True)
    develop = True
    print(f"Tensor working status: {develop}")
    with psycopg2.connect(**dev_db_params) as dev_conn:

        pubkeys = DBlib.select_pubkeis(dev_conn, tables[0])
        i_count = 10
        for row in pubkeys:
            pubkey = row[0]
            node_info = DBlib.select_node_info(dev_conn, tables[0], pubkey)
            print(f"Node Info: {node_info[2]} ")
            today = node_info[2] + "_rebal_" + str(date.today()).replace("-", "_")
            print(f"Lnd node name : {today}")
            if develop:
                if os.path.exists(today):
                    print(f"Model file -{today} exists and will be removed for regeneration.")
                    os.remove(today)
                create_model_object.create_model_main(tables)
            else:
                # running status is production Open a cursor to perform database operations


                # Check if model file exists
                if os.path.exists(today):
                    print(f"Model file -{today} exists and ready to use.")

                else:
                    print("Starting to create Model ")
                    create_model_object.create_model_main(tables)

                i = 0
                count, chan_ids = DBlib.select_chan_ids(dev_conn, tables[1], pubkey)
                # Load the model
                model = tf.keras.models.load_model(today)
                # Print model summary
                model.summary()

                # Print model architecture
                print(model.layers)

                # Print model input and output shapes
                print("Input shape:", model.input_shape)
                print("Output shape:", model.output_shape)
                # sys.exit()
                for row_chan_id in chan_ids:
                    print(f" Second time record number {i}, chan id selected for AI {row_chan_id[0]}")
                    channel_info = DBlib.select_channel_info(dev_conn, tables[2], row_chan_id[0])
                    # print(channel_info)

                    if not channel_info[1]:
                        print(f"Chanel not active anymore {row_chan_id[0]}")
                        continue

                    print(f"Channel info: {channel_info[0]}")
                    # last_rebalance = DBlib.get_last_rebalance(dev_conn, row_chan_id[0])
                    # exit(2)

                    alias = node_info[2]
                    active_channels = node_info[3]
                    capacity = channel_info[6]
                    local_balance = channel_info[7]
                    remote_balance = channel_info[8]
                    total_sent = channel_info[12]
                    total_recs = channel_info[13]
                    print(f" active channel {active_channels}, capacity {capacity}, local balance {local_balance}, remote "
                          f"balance {remote_balance}, total sent {total_sent}, total recs {total_recs} ")
                    x = numpy.zeros((1, 7))
                    # last rebalance last day 3, ten days or less 2, in last month 1, more than one month 0
                    last_rebalance = DBlib.get_last_rebalance(dev_conn, row_chan_id[0])
                    x[0, 0] = active_channels
                    x[0, 1] = capacity
                    x[0, 2] = local_balance
                    x[0, 3] = remote_balance
                    x[0, 4] = total_recs
                    x[0, 5] = total_sent
                    x[0, 6] = last_rebalance
                    print(f" line 111 before clean result")
                    clean_result = clean_predict(x[0, 0], x[0, 1], x[0, 2], x[0, 3], x[0, 4], x[0, 5], x[0, 6], model)
                    print(f"predicted result is : {clean_result}")
                    if clean_result:
                        # def db_save_result(connection, alias_name, chan_id, channel_point, amount_balance, max_fee):
                        amount_balance = abs(local_balance - remote_balance)
                        max_fee = 100
                        DBlib.db_save_result(dev_conn, alias, row_chan_id[0], channel_info[4], amount_balance, max_fee)
                        print(f"Data saved to Db for {alias}")


if __name__ == "__main__":
    main()
