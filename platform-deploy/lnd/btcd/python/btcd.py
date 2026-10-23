import os
import shutil
import time
from pathlib import Path




class BTCD:

    def __init__(self, lnd_config, debug):
        self.dev = debug
        if 'datadir' in lnd_config:
            self.dir_name = lnd_config['datadir']
        else:
            self.dir_name = "/data/bitcoind"
        if self.dev:
            print(self.dir_name)
        self.lnd_config = lnd_config


    def create_bitcoind_config(self):

        Path(self.dir_name).mkdir(parents=True, exist_ok=True)

        print(f"Main folder for bitcoind- {self.dir_name} ")
        file_name = self.dir_name + "/bitcoin.conf"
        file = open(file_name, 'w')

        if self.lnd_config['lndnetwork'] == 'testnet':
            content = '''
#Bitcoin config on the testnet network
testnet=1
# Run on a signet network
#signet=0
# Run a regression test network
#regtest=1

#bitcoin conf
daemon=1
txindex=1
server=1


# Options only for testnet
[test]
rpcuser=''' + self.lnd_config['rpcuser'] + '''
rpcpassword=''' + self.lnd_config['rpcpass'] + '''

#on off neutrino
blockfilterindex=1
peerblockfilters=1

rpcallowip=0.0.0.0/0
rpcbind=0.0.0.0 # kubernetes cluster address
rpcport=853

externalip=192.168.123.252
datadir=''' + self.dir_name + '''

minrelaytxfee=0.00000000
incrementalrelayfee=0.00000010

#for lnd connection:
zmqpubrawblock=tcp://0.0.0.0:29088 
# kubernetes cluster address
zmqpubrawtx=tcp://0.0.0.0:29099 
# kubernetes cluster address

# Optimizations
dbcache=2000
maxuploadtarget=5000
maxconnections=60
rpcthreads=256
rpcworkqueue=8192
rpctimeout=60
                '''
        elif self.lnd_config['lndnetwork'] == 'regtest':
            content = '''
regtest=1
daemon=1
[regtest]
  rpcuser=''' + self.lnd_config['rpcuser'] + '''
  rpcpassword=''' + self.lnd_config['rpcpass'] + '''
  rpcport=853
  rpcallowip=0.0.0.0/0
  rpcbind=0.0.0.0
  rpchost=127.0.0.1
  zmqpubrawblock=tcp://0.0.0.0:29088
  zmqpubrawtx=tcp://0.0.0.0:29099

#on off neutrino
blockfilterindex=1
peerblockfilters=1

maxtxfee=1
paytxfee=0.0001
            '''
        elif self.lnd_config['lndnetwork'] == 'mainnet':
            content = '''
#bitcoin config on the mainnet network
daemon=1
txindex=1
server=1

rpcuser=''' + self.lnd_config['rpcuser'] + '''
rpcpassword=''' + self.lnd_config['rpcpass'] + '''

rpcallowip=0.0.0.0/0
rpcconnect=192.168.123.252
#rpcbind=127.0.0.1
# local DNS name (container name used in my Docker Compose file)
rpcbind=0.0.0.0
rpcport=853


datadir=''' + self.dir_name + '''
# Connection options
#bind=192.168.123.252
externalip=192.243.215.232
#externalip=''' + self.lnd_config['rpchost'] + '''.''' + self.lnd_config['alias'] + '''

minrelaytxfee=0.00000000
incrementalrelayfee=0.00000010

#for lnd connection:
zmqpubrawblock=tcp://0.0.0.0:29088
zmqpubrawtx=tcp://0.0.0.0:29099

#on off neutrino
blockfilterindex=1
peerblockfilters=1

# Optimizations
dbcache=2000
maxuploadtarget=5000
maxconnections=60
rpcthreads=256
rpcworkqueue=8192
rpctimeout=60
            '''
        else:
            if self.dev:
                print(self.lnd_config)
                print("Error in lnd network parameter")
            return None
        file.write(content)
        file.close()
        if self.dev:
            print(content)
