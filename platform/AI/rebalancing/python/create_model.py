import keras
import numpy
import os

from datetime import date
# 0 = all messages are logged (default behavior)
# 1 = INFO messages are not printed
# 2 = INFO and WARNING messages are not printed
# 3 = INFO, WARNING, and ERROR messages are not printed
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
import tensorflow as tf
# from tensorflow import keras
from keras import layers

import psycopg2
from db_lib import DBlib

# Connection parameters for development database
dev_db_params = {
    "host": "192.168.123.59",
    "port": 5434,
    "database": "routing_vm",
    "user": "postgres",
    "password": "password"
}


class Tmodel:
    def __init__(self, debug):
        debug = debug

    def create_model_main(self, tables):
        with psycopg2.connect(**dev_db_params) as dev_conn:
        # Open a cursor to perform database operations

            pubkeys = DBlib.select_pubkeis(dev_conn, tables[0])
            i_count = 10
            for row in pubkeys:
                pubkey = row[0]
                node_info = DBlib.select_node_info(dev_conn, tables[0], pubkey)
                print(f"Node Info: {node_info[2]} ")
                count, chan_ids = DBlib.select_chan_ids(dev_conn, tables[1], pubkey)
                x = numpy.zeros((i_count, 7))
                y = numpy.zeros((i_count, 4))
                i = 0
                print(f" number of records {count}")

                model = keras.Sequential()
                model.add(layers.Dense(7, input_dim=7, activation='relu'))
                model.add(layers.Dense(1, activation='sigmoid'))
                today = node_info[2]+"_rebal_"+str(date.today()).replace("-", "_")
                print(today , " : model file name")
                model.compile(
                    loss='mean_squared_error',
                    optimizer='adam',
                    metrics=['binary_accuracy']
                )

                for row_chan_id in chan_ids:
                    print(f"record number {i}, chan id selected for AI {row_chan_id[0]}")
                    channel_info = DBlib.select_channel_info(dev_conn, tables[2], row_chan_id[0])
                    #print(channel_info)
                    if not channel_info[1]:
                        print(f"Chanel not active anymore {row_chan_id[0]}")
                        continue
                    active_channels = node_info[3]
                    capacity = channel_info[6]
                    local_balance = channel_info[7]
                    remote_balance = channel_info[8]
                    total_sent = channel_info[12]
                    total_recs = channel_info[13]
                    # last rebalance last day 3, ten days or less 2, in last month 1, more than one month 0
                    last_rebalance = DBlib.get_last_rebalance(dev_conn, row_chan_id[0])
                    print(f"last rebalancing result is {last_rebalance}")
                    if i < i_count:
                        x[i, 0] = active_channels
                        x[i, 1] = capacity
                        x[i, 2] = local_balance
                        x[i, 3] = remote_balance
                        x[i, 4] = total_recs
                        x[i, 5] = total_sent
                        x[i, 6] = last_rebalance
                        y[i] = self.result_y(capacity, local_balance, total_sent, total_recs, active_channels, dev_conn,
                                        row_chan_id[0], last_rebalance)

                    if i == i_count:
                        print("-------------------------")
                        print(x)
                        print("-------------------------")
                        print(y)
                        print("-------------------------")

                        xx = tf.constant(x)
                        yy = tf.constant(y)
                        # print(clean_predict(1, 0, 0, 0, 0, 0, model))

                        model.fit(
                            xx,
                            yy,
                            epochs=2000,
                            verbose=1
                        )
                        model.save(today + "_" + str(i))
                    if i > i_count:
                        break
                    i = i + 1

                # Print model summary
                model.summary()

                # Print model architecture
                print(model.layers)

                # Print model input and output shapes
                print("before save Input shape:", model.input_shape)
                print("before save Output shape:", model.output_shape)
                model.save(today)
                # print(clean_predict(1, 0, 0, 0, 0, 0, model))
        i = 0

    def result_y(self, capacity, local_balance, total_sent, total_resc, active_channels, connection, chan_id, last_rebalance):
        indicator = numpy.zeros(4)
        if local_balance < capacity * 0.40:
            indicator[0] = 2
        if DBlib.count_number_of_tx_on_channel(connection, chan_id) > 100:
            indicator[1] = 1
        if active_channels > 20:
            indicator[2] = 1
        if active_channels > 40:
            indicator[2] = 2
        if abs(total_sent - total_resc) > capacity * 0.20:
            indicator[3] = 1
        print(indicator, "this from line 72 inside from result_y")
        return indicator

