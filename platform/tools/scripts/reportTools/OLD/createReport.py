# Created by Joshua Jackson
# Date: 2022-01-21
# File: prepare_report.py
# Project: forwardHistory
# Version: 0.0.1
#
# Builds Report for Forward History for LND node from table
# !/usr/local/bin/python3
import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join('../../scripts/', '.')))

import pandas as pd
import psycopg2
from jinja2 import Environment, FileSystemLoader
import base64
from datetime import datetime
from config.config import ConfigLND as Config
import traceback

pd.set_option('display.float_format', lambda x: '%.f' % x)


class CreateReport:

    def __init__(self, start_date, end_date, template, csv, html, report_out, debug):
        self.start_date = start_date
        self.end_date = end_date
        if html is True:
            self.env = Environment(loader=FileSystemLoader(os.path.dirname(os.path.abspath(template))))
            self.template = self.env.get_template(os.path.basename(os.path.abspath(template)))
            self.template_path = os.path.dirname(os.path.abspath(template))
        self.csv = csv
        self.html = html
        self.report_out = report_out
        self.debug = debug

    # connect to Postgres DB
    def connect_to_postgres(self):
        try:
            # connect to DB and return connection
            connection = psycopg2.connect(user=Config.dbuser, password=Config.dbpassword, host=Config.dbhost,
                                          port=Config.dbport, database=Config.dbname)
            if self.debug:
                print(f"Connected to DB - {connection}")
            return connection
        except Exception as e:
            print("Exception {}".format(e))

    def get_forwarding_history_data(self, lnd_node):
        try:
            if self.debug:
                print(f"Get Forwarding History for Report Start Date: {self.start_date}, End Date: {self.end_date}")

            start_date = datetime.strptime(self.start_date, "%m-%d-%Y")

            end_date = datetime.strptime(self.end_date, "%m-%d-%Y")

            column_names = ["event_timestamp", "chan_id_in", "chan_id_out", "amt_in", "amt_out", "fee", "fee_msat",
                            "amt_in_msat", "amt_out_msat", "timestamp_ns", "lnd_node"]

            if type(lnd_node) != list and lnd_node is not None:
                print(type(lnd_node))
                sql = "SELECT event_timestamp, chan_id_in, chan_id_out, amt_in, amt_out, fee, fee_msat, amt_in_msat, amt_out_msat, timestamp_ns, lnd_node FROM forwarding_event \
					WHERE lnd_node='{}' AND event_timestamp > '{}' AND event_timestamp < '{}';".format(lnd_node,
                                                                                                       start_date,
                                                                                                       end_date)
            elif type(lnd_node) == list and len(lnd_node) > 0:
                sql = "SELECT event_timestamp, chan_id_in, chan_id_out, amt_in, amt_out, fee, fee_msat, amt_in_msat, amt_out_msat, timestamp_ns, lnd_node FROM forwarding_event \
					WHERE lnd_node IN {} AND event_timestamp > '{}' AND event_timestamp < '{}';".format(tuple(lnd_node),
                                                                                                        start_date,
                                                                                                        end_date)
            else:
                sql = "SELECT event_timestamp, chan_id_in, chan_id_out, amt_in, amt_out, fee, fee_msat, amt_in_msat, amt_out_msat, timestamp_ns, lnd_node FROM forwarding_event \
					WHERE event_timestamp > '{}' AND event_timestamp < '{}';".format(start_date, end_date)

            # get connection and create cursor
            con = self.connect_to_postgres()
            cursor = con.cursor()

            cursor.execute(sql)

            rows = cursor.fetchall()

            if self.debug:
                if lnd_node is None:
                    print(f"Retreived Data from DB for - Start Date: {self.start_date}, End Date: {self.end_date}")
                else:
                    print(
                        f"Retreived Data from DB for LND - {lnd_node} between Start Date: {self.start_date}, End Date: {self.end_date}")

                print(f"Rows: {len(rows)}")

            df = pd.DataFrame(rows, columns=column_names)

            # get channel age dataframe
            sql_chan_age = "SELECT chan_id, timestamp_ns FROM channel_info;"
            cursor.execute(sql_chan_age)
            rows_chan_age = cursor.fetchall()
            df_chan_age = pd.DataFrame(rows_chan_age, columns=['chan_id', 'timestamp_ns'])
            df_chan_age['timestamp_ns'] = df_chan_age['timestamp_ns'].astype('datetime64[ms]')
            con.close()

            return df, df_chan_age

        except Exception as e:
            print(f"Exception in get_forwarding_history_data: {e}")

    # pandas df operations for base report
    def build_dataframe(self, df, df_chan_age):
        try:

            if self.debug:
                print(f"Building Dataframe for CSV and HTML output")
            # get total events in and out
            df_total_events_out = df[['chan_id_out', 'lnd_node']].value_counts().to_frame("total_events_out")
            df_total_events_in = df[['chan_id_in', 'lnd_node']].value_counts().to_frame("total_events_in")

            # get number of events
            df_tmp = pd.concat([df_total_events_in, df_total_events_out]).fillna(0).reset_index()
            df_tmp.columns = ['chan_id', 'lnd_node', 'total_events_in', 'total_events_out']
            df_total_events = df_tmp.groupby(['chan_id', 'lnd_node']).agg(
                {"total_events_in": "sum", "total_events_out": "sum"}).reset_index()
            df_total_events['total_events'] = df_total_events['total_events_in'] + df_total_events['total_events_out']
            df_total_events.columns = ['chan_id', 'lnd_node', 'total_events_in', 'total_events_out', 'total_events']

            # set start date to min date based on selection from data frame
            self.start_date = pd.to_datetime(df_chan_age['timestamp_ns'].min(), utc=True, unit='s').strftime(
                "%m-%d-%Y %H:%M:%S")

            # get age of channels
            today = pd.to_datetime("today", utc=True)
            df_chan_age['age_days'] = today - pd.to_datetime(df_chan_age['timestamp_ns'], utc=True, unit='s')

            df_chan_age['age_days'] = df_chan_age['age_days'].dt.days
            df['event_date'] = df['event_timestamp'].dt.date
            # make sure no age value is zero min 1 day
            df_chan_age.loc[df_chan_age.age_days == 0, "age_days"] = 1
            df_chan_age.loc[df_chan_age.age_days < 0, "age_days"] = 0

            # get total amount in on chan_in
            chan_in_df_total_amount = df.groupby('chan_id_in', as_index=False)['amt_in_msat'].sum()
            chan_in_df_total_amount.columns = ['chan_id', 'amt_in_msat']

            # getting total fees, amount out for chan_id_out
            chan_out_df_total_fees = df.groupby('chan_id_out', as_index=False)[
                ['fee', 'fee_msat', 'amt_out_msat']].sum()
            chan_out_df_total_fees['fee'] = chan_out_df_total_fees['fee_msat'] / 1000
            chan_out_df_total_fees.rename(columns={'chan_id_out': 'chan_id', 'fee': 'fee_sat', 'fee_msat': 'fee_msat',
                                                   'amt_out_msat': 'amt_out_msat'}, inplace=True)

            # merge chan out and in amounts
            df_tmp_amt = chan_out_df_total_fees.merge(chan_in_df_total_amount, how='outer').fillna(0)
            chan_out_df_total_fees = df_tmp_amt.groupby(['chan_id']).agg(
                {"fee_sat": "sum", "fee_msat": "sum", "amt_in_msat": "sum", "amt_out_msat": "sum"}).reset_index()
            chan_out_df_total_fees = chan_in_df_total_amount.merge(chan_out_df_total_fees, how='outer')

            # join df_chan_age with total events
            df_chan_age_events = df_chan_age.merge(df_total_events, how='outer')

            # join chan age and values df
            df_chan_total_and_age = chan_out_df_total_fees.merge(df_chan_age_events, how='outer')

            # add avg amount in out per event
            df_chan_total_and_age['avg_amt_in_per_event'] = df_chan_total_and_age['amt_in_msat'] / \
                                                            df_chan_total_and_age['total_events_in']
            df_chan_total_and_age['avg_amt_out_per_event'] = df_chan_total_and_age['amt_out_msat'] / \
                                                             df_chan_total_and_age['total_events_out']

            delta_days = pd.to_datetime(self.end_date, utc=True) - pd.to_datetime(self.start_date, utc=True)
            df_chan_total_and_age.loc[
                df_chan_total_and_age['age_days'] > delta_days.days, ['age_days']] = delta_days.days
            # 1 day amount in average
            df_chan_total_and_age['amt_in_1d'] = df_chan_total_and_age['amt_in_msat'] / df_chan_total_and_age[
                'age_days']
            # 1 day amount out average
            df_chan_total_and_age['amt_out_1d'] = df_chan_total_and_age['amt_out_msat'] / df_chan_total_and_age[
                'age_days']
            # 1 day fee average
            df_chan_total_and_age['fee_msat_1d'] = df_chan_total_and_age['fee_msat'] / df_chan_total_and_age['age_days']

            # make 7d amount in average
            df_chan_total_and_age['amt_in_7d'] = df_chan_total_and_age['amt_in_1d'] * 7
            # make 7d amount out average
            df_chan_total_and_age['amt_out_7d'] = df_chan_total_and_age['amt_out_1d'] * 7
            # make 7d fee average
            df_chan_total_and_age['fee_msat_7d'] = df_chan_total_and_age['fee_msat_1d'] * 7

            # make 30d amount in average
            df_chan_total_and_age['amt_in_30d'] = df_chan_total_and_age['amt_in_1d'] * 30
            # make 30d amount out average
            df_chan_total_and_age['amt_out_30d'] = df_chan_total_and_age['amt_out_1d'] * 30
            # make 30d fee average
            df_chan_total_and_age['fee_msat_30d'] = df_chan_total_and_age['fee_msat_1d'] * 30

            # if age is less then 7 or 30 remove averages
            df_chan_total_and_age.loc[
                df_chan_total_and_age['age_days'] < 30, ["amt_out_30d", "amt_in_30d", "fee_msat_30d"]] = None
            df_chan_total_and_age.loc[
                df_chan_total_and_age['age_days'] < 7, ["amt_out_7d", "amt_in_7d", "fee_msat_7d"]] = None

            # reset index and sort by age
            df_chan_total_and_age.fillna(0, inplace=True)
            df_chan_total_and_age.sort_values(by="total_events", ascending=False, inplace=True)

            df_tmp = pd.DataFrame(df_chan_total_and_age.sum(numeric_only=True)[1:]).T.reset_index()

            final_df = df_chan_total_and_age.set_index('chan_id').append(df_tmp).reset_index()

            final_df = final_df.rename(columns={'level_0': 'chan_id'})
            final_df = final_df.astype({'chan_id': 'string'})
            final_df = final_df[final_df['lnd_node'] != 0]
            final_df.iloc[-1, final_df.columns.get_loc('chan_id')] = "Totals"
            final_df.drop(columns=['index'], inplace=True)

            if self.csv:
                final_df.to_csv(
                    f"{self.report_out}/forwarding-history-report_{pd.to_datetime(self.start_date, utc=True).strftime('%m-%d-%Y')}_to_{self.end_date}.csv",
                    float_format='%.0f', index=False)
                if self.debug:
                    print(
                        f"CSV created - {self.report_out}/forwarding-history-report_{pd.to_datetime(self.start_date, utc=True).strftime('%m-%d-%Y')}_to_{self.end_date}.csv")

            return final_df
        except Exception as e:
            print(f"Exception in build_dataframe: {e}")

    # handle forwarding history data
    def create_forwarding_history_report(self, df, lnd_node):
        try:

            if self.debug:
                print(f"Building HTML File for Graphic Display")
            # encode image to base64
            lqwd_logo = base64.b64encode(
                open(os.path.abspath("../../forwardingHistory/images/lqwd.png"), "rb").read()).decode('ascii')
            image_url = '{}'.format(lqwd_logo)

            template_vars = {
                "absolute_path": self.template_path,
                "start_date": self.start_date,
                "end_date": self.end_date,
                "user_name": "User Name",
                "user_email": "user@email.com",
                "user_phone": "(123) 345 5544",
                "node_alias": lnd_node,
                "node_pubkey": lnd_node,
                "num_channels": "50",
                "num_peers": "45",
                "total_balance": "",
                "total_num_events": df['total_events'].sum(),
                "total_num_events_out": df['total_events_out'].sum(),
                "total_num_events_in": df['total_events_in'].sum(),
                "total_amount_in": df['amt_in_msat'].sum(),
                "total_amount_out": df['amt_out_msat'].sum(),
                "total_fees": df['fee_msat'].sum() / 1000,
                "df": df,
                "image_base64": image_url
            }

            html_out = self.template.render(template_vars)
            html_file_open = open(
                f"{self.report_out}/forwarding-history-report_{self.start_date}_to_{self.end_date}.html", "w+")
            html_file_open.write(html_out)
            html_file_open.close()

            if self.debug:
                print(
                    f"Creating HTML output to {self.report_out}/forwarding-history-report_{self.start_date}_to_{self.end_date}.html")
        except Exception as e:
            traceback.print_exc()
            print(f"Exception in create forwarding history report: {e}")
