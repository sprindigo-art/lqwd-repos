import sys, os
sys.path.insert(0, os.path.abspath(os.path.join('../../scripts/', '.')))

from config.config import Config
import requests
import pandas as pd
import logging
import io
from sqlalchemy import create_engine

# logging setup
logging.basicConfig(
    filename='debug.log',
    level=logging.DEBUG,
    format='%(filename)s:%(levelname)s:%(asctime)s %(message)s',
    filemode='a',
    datefmt='%m/%d/%Y %I:%M:%S %p'
)

# define a Handler which writes INFO messages or higher to the sys.stderr
console = logging.StreamHandler(sys.stdout)
console.setLevel(logging.DEBUG)
# set a format which is simpler for console use
formatter = logging.Formatter('%(filename)s:%(levelname)s:%(asctime)s %(message)s')
# tell the handler to use this format
console.setFormatter(formatter)
# add the handler to the root logger
logging.getLogger().addHandler(console)


class BitcoinVisualUpdater:

    def __init__(self, bitcoin_visual_table_name):
        try:
            self.dbUser = Config.dbuser
            self.dbPass = Config.dbpassword
            self.dbHost = Config.dbhost
            self.dbPort = Config.dbport
            self.dbName = Config.dbname
            self.bitcoin_visual_table_name = bitcoin_visual_table_name
        except Exception as e:
            print(f"Exception in __init__: {e}")

    def table_install_data_first_run(self):
        try:

            response = requests.get("https://bitcoinvisuals.com/static/data/data_daily.csv").content
            # convery response to dataframe
            data = pd.read_csv(io.StringIO(response.decode('utf-8')))

            # separate ln_data from daily data set
            # create subset of data
            ln_data = data.loc[:, 'nodes_total':]

            # move date to new data set
            ln_data.insert(0, 'date', data.pop('day'))

            # drop all fully zero rows and replace 0
            ln_data = ln_data.dropna(subset=ln_data.columns[1:], how='all').fillna(0)

            # load into postgres table
            engine = create_engine(
                f"postgresql://{self.dbUser}:{self.dbPass}@{self.dbHost}:{self.dbPort}/{self.dbName}")

            ln_data.to_sql(self.bitcoin_visual_table_name, engine, schema="public", if_exists='replace', index=False,
                           chunksize=100)

        except Exception as e:
            logging.error("tableInstallDataFirstRun Error: {}".format(e))
            raise Exception("tableInstallDataFirstRun Error: {}".format(e))


if __name__ == '__main__':
    BitcoinVisualUpdater("bitcoin_visual_stats").table_install_data_first_run()

