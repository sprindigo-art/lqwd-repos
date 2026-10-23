# Python Script to Build Growth Report for Routing Node Forward History
# Author: Joshua Jackson
# Date: Jan 5 202
# Version: 0.0.1
# !/usr/local/bin/python3
import sys, os
sys.path.insert(0, os.path.abspath(os.path.join('../../scripts/', '.')))

from datetime import date
import pandas as pd
from reportTools.dbHandler import DbHandler


class CreateGrowthReport:
    def __init__(self, df, lnd_node, report_out, debug):
        try:
            self.df = df
            self.lnd_node = lnd_node
            self.debug = debug
            self.report_out = report_out

        except Exception as e:
            print(f"Exception in __init__: {e}")

    def get_channel_info(self):
        try:

            column_names = ["chan_id", "timestamp_ns", "channel_capacity", "remote_pubkey", "local_node",
                            "channel_point", "fee_per_kw"]
            self.db = DbHandler()

            if type(self.lnd_node) == list and len(self.lnd_node) > 0:
                sql = f"SELECT *	FROM channel_info WHERE local_node IN {tuple(self.lnd_node)};"
            else:
                sql = f"SELECT *	FROM channel_info WHERE local_node = '{self.lnd_node}';"

            # get connection and create cursor
            con = self.db.connect_to_postgres()
            cursor = con.cursor()

            cursor.execute(sql)
            rows = cursor.fetchall()

            if self.debug:
                print(f"Getting Channel Info - Row Selected: {len(rows)}")

            channel_df = pd.DataFrame(rows, columns=column_names)
            channel_df = channel_df.astype({'chan_id': 'string'})

            return channel_df
        except Exception as e:
            print(f"Exception in get_channel_info: {e}")

    # build dataframe for amt in growth week over week
    def amt_in_growth(self):
        try:
            # add sums for amt_in, fees for week over week
            growth_df_in = self.df.groupby(['chan_id_in', 'event_date']).sum().reset_index()

            # loop in increments of weeks to end date to build change values per cahnnel for amt in
            end_date = pd.to_datetime(date.today(), utc=True)
            tmp_date1 = self.df['event_date'].min()

            amt_in_wkly = pd.DataFrame(growth_df_in[
                                           growth_df_in['event_date'] <= self.df['event_date'].min() + pd.to_timedelta(
                                               7, unit='d')].groupby(['chan_id_in']).sum()['amt_in_msat'])

            for i in range(1, round((self.df['event_date'].max() - self.df['event_date'].min()).days / 7) + 1):
                tmp_date = self.df['event_date'].min() + pd.to_timedelta(i * 7, unit='d')
                tmp_date2 = self.df['event_date'].min() + pd.to_timedelta((i + 1) * 7, unit='d')
                if tmp_date2 > end_date:
                    tmp_date2 = end_date

                amt_in_wkly = pd.merge(amt_in_wkly, growth_df_in[
                    (growth_df_in['event_date'] > tmp_date) & (growth_df_in['event_date'] <= tmp_date2)] \
                                       .groupby(['chan_id_in']).sum()['amt_in_msat'], on=['chan_id_in'], how='outer') \
                    .rename(columns={'amt_in_msat_x': f'week{i}', 'amt_in_msat_y': f'week{i + 1}'})
            return amt_in_wkly
        except Exception as e:
            print(f"Exception in amt_in_growth: {e}")

    # build dataframe for amt out growth
    def amt_out_growth(self):
        try:
            # add sums for amt_in, fees for week 1 week 2 week 3 week 4
            growth_df_out = self.df.groupby(['chan_id_out', 'event_date']).sum().reset_index()
            # loop in increments of weeks to end date to build change values per cahnnel for amt in
            end_date = pd.to_datetime(date.today(), utc=True)
            tmp_date1 = self.df['event_date'].min()

            amt_out_wkly = pd.DataFrame(growth_df_out[growth_df_out['event_date'] <= self.df[
                'event_date'].min() + pd.to_timedelta(7, unit='d')].groupby(['chan_id_out']).sum()['amt_out_msat'])

            for i in range(1, round((self.df['event_date'].max() - self.df['event_date'].min()).days / 7) + 1):
                tmp_date = self.df['event_date'].min() + pd.to_timedelta(i * 7, unit='d')
                tmp_date2 = self.df['event_date'].min() + pd.to_timedelta((i + 1) * 7, unit='d')
                if tmp_date2 > end_date:
                    tmp_date2 = end_date

                amt_out_wkly = pd.merge(amt_out_wkly, growth_df_out[
                    (growth_df_out['event_date'] > tmp_date) & (growth_df_out['event_date'] <= tmp_date2)] \
                                        .groupby(['chan_id_out']).sum()['amt_out_msat'], on=['chan_id_out'],
                                        how='outer') \
                    .rename(columns={'amt_out_msat_x': f'week{i}', 'amt_out_msat_y': f'week{i + 1}'})
            return amt_out_wkly
        except Exception as e:
            print(f"Exception in amt_out_growth: {e}")

    # build dataframe for fee msat growth
    def fee_growth(self):
        try:
            # add sums for amt_in, fees for week 1 week 2 week 3 week 4
            growth_df_out = self.df.groupby(['chan_id_out', 'event_date']).sum().reset_index()
            # loop in increments of weeks to end date to build change values per cahnnel for amt in
            end_date = pd.to_datetime(date.today(), utc=True)
            tmp_date1 = self.df['event_date'].min()

            fee_wkly = pd.DataFrame(growth_df_out[
                                        growth_df_out['event_date'] <= self.df['event_date'].min() + pd.to_timedelta(7,
                                                                                                                     unit='d')].groupby(
                ['chan_id_out']).sum()['fee_msat'])

            for i in range(1, round((self.df['event_date'].max() - self.df['event_date'].min()).days / 7) + 1):
                tmp_date = self.df['event_date'].min() + pd.to_timedelta(i * 7, unit='d')
                tmp_date2 = self.df['event_date'].min() + pd.to_timedelta((i + 1) * 7, unit='d')
                if tmp_date2 > end_date:
                    tmp_date2 = end_date

                fee_wkly = pd.merge(fee_wkly, growth_df_out[
                    (growth_df_out['event_date'] > tmp_date) & (growth_df_out['event_date'] <= tmp_date2)] \
                                    .groupby(['chan_id_out']).sum()['fee_msat'], on=['chan_id_out'], how='outer') \
                    .rename(columns={'fee_msat_x': f'week{i}', 'fee_msat_y': f'week{i + 1}'})
            return fee_wkly
        except Exception as e:
            print(f"Exception in fee_growth: {e}")

    # add channel capacity to channels to demonstrate growth in total capacity over time
    def add_channel_capacity(self, final_df, channel_df):
        try:
            tmp_df = pd.merge(final_df, channel_df, how="outer", on=["chan_id"]).rename(
                columns={'timestamp_ns_x': 'timestamp_ns', 'timestamp_ns_y': 'timestamp_ns_lifetime'})

            return tmp_df
        except Exception as e:
            print(f"Exception in add_channel_capacity: {e}")

    # create channel capacity growth numbers
    def channel_capacity_growth(self, channel_df):
        try:
            # add sums for amt_in, fees for week 1 week 2 week 3 week 4
            channel_df['event_date'] = pd.to_datetime(channel_df['timestamp_ns'], unit='ms', utc=True).dt.date
            channel_df = channel_df.groupby(['chan_id', 'event_date']).sum().reset_index()

            # loop in increments of weeks to end date to build change values per cahnnel for amt in
            end_date = pd.to_datetime(date.today(), utc=True)
            tmp_date1 = channel_df['event_date'].min()

            channel_df_wkly = pd.DataFrame(channel_df[channel_df['event_date'] <= channel_df[
                'event_date'].min() + pd.to_timedelta(7, unit='d')].groupby(['chan_id']).sum()['channel_capacity'])

            for i in range(1, round((channel_df['event_date'].max() - channel_df['event_date'].min()).days / 7) + 1):
                tmp_date = channel_df['event_date'].min() + pd.to_timedelta(i * 7, unit='d')
                tmp_date2 = channel_df['event_date'].min() + pd.to_timedelta((i + 1) * 7, unit='d')
                if tmp_date2 > end_date:
                    tmp_date2 = end_date

                channel_df_wkly = pd.merge(channel_df_wkly, channel_df[
                    (channel_df['event_date'] > tmp_date) & (channel_df['event_date'] <= tmp_date2)] \
                                           .groupby(['chan_id']).sum()['channel_capacity'], on=['chan_id'], how='outer') \
                    .rename(columns={'channel_capacity_x': f'week{i}', 'channel_capacity_y': f'week{i + 1}'})

            channel_df_wkly = channel_df_wkly.drop(columns=['channel_capacity'])

            return channel_df_wkly

        except Exception as e:
            print(f"Exception in channel_capacity_growth: {e}")

    # build growth sums dataframe (for entire node not channel specific)
    def build_growth_df(self):
        try:
            channel_df = self.get_channel_info()

            amts_wkly = pd.merge(pd.Series(self.amt_in_growth().sum(), name='amt_in'),
                                 pd.Series(self.amt_out_growth().sum(), name='amt_out'), how='outer', left_index=True,
                                 right_index=True)
            channel_growth = pd.merge(amts_wkly, pd.Series(self.channel_capacity_growth(channel_df).sum(),
                                                           name='channel_capacity'), how='outer', left_index=True,
                                      right_index=True)
            final_growth_df = pd.merge(channel_growth, pd.Series(self.fee_growth().sum(), name='fees_msat'),
                                       how='outer', left_index=True, right_index=True)

            return final_growth_df
        except Exception as e:
            print(f"Exception in build_growth_df: {e}")

    # create csv for given data frame
    def create_csv(self, df, filename):
        try:
            df.to_csv(f"{self.report_out}/{filename}.csv", float_format='%.0f', index=False)
            if self.debug:
                print(f"CSV created - {self.report_out}/{filename}.csv")

        except Exception as e:
            print(f"Exception in create_csv: {e}")
