import codecs
import json
import os
import shutil
import time
from pathlib import Path
import python_lnd_grpc
import requests

import grpc
import cipher_api_handler


class Lnd:
    def __init__(self, lnd_config, debug):

        self.lnd_config = lnd_config
        self.dev = debug
        self.is_new_node = True
        self.dir_name = self.root_dir() + "/" + self.lnd_config['podname'];
        self.macaroon_file = self.dir_name + '/data/chain/bitcoin/' + self.lnd_config['lndnetwork'] + '/admin.macaroon'
        self.macaroon = ''
        self.cert_path = self.dir_name + '/tls.cert'
        self.localhost = 'https://localhost:8080'
        self.headers = {'Grpc-Metadata-macaroon': self.macaroon}
        self.nodeIP = self.lnd_config['podname'] + '.' + self.lnd_config['alias']
        self.port = "10009"
        self.cipher_api = cipher_api_handler.CipherAPIHandler()
        self.restore_node = os.getenv("RESTORATION_NODE")

    def get_dir_name(self):
        return self.dir_name

    def get_macaroon(self):
        indicator = 0
        while indicator < 5:
            try:
                self.macaroon = codecs.encode(open(self.macaroon_file, 'rb').read(), 'hex')
                indicator = 6
            except FileNotFoundError:
                time.sleep(5)
                indicator = indicator + 1

    def backup_channel(self):
        print("Start channels backup")
        url = self.localhost + 'v1/channels/backup'
        indicator = True
        while indicator:
            self.headers = {'Grpc-Metadata-macaroon': self.macaroon}
            r = requests.get(url, headers=self.headers, verify=self.cert_path)
            print(r)
            result = r.json()
            print(result)
        if 'error' in result:
            print("Error wait 15 sec")
            time.sleep(15)
        else:
            indicator = False
        return r.json()

    def get_info(self):
        indicator = True
        print("Get info Command started")
        url = self.localhost + '/v1/getinfo'
        result = 0
        while indicator:
            try:
                self.headers = {'Grpc-Metadata-macaroon': self.macaroon}
                r = requests.get(url, headers=self.headers, verify=self.cert_path)
                result = r.json()
                print(result)
                print(result['identity_pubkey'])
            except Exception as e:
                print(e)
                result = 1
            if result == 1:
                time.sleep(15)
            else:
                indicator = False
        return r.json()

    # def start_lnd_in_subprocess(self):
    #     subprocess_lnd_start = subprocess.Popen(self.start_command, shell=True, stderr=subprocess.PIPE)
    #     subprocess_lnd_start.logfile = open(f'{self.dir_name}/lnd_start.log', 'wb')
    #
    #     # wait till process start
    #     time.sleep(3)

    def unlock_create_wallet(self):
        print("creating wallet...")

        wallet_unlocker = python_lnd_grpc.WalletUnlocker(
            tls_file_path=self.dir_name + "/",
            tls_file_name="tls.cert",
            grpc_host="127.0.0.1",
            grpc_port="10009",
            network=self.lnd_config['lndnetwork'],
            output="json-none-included",
            is_wallet_unlocker=True

        )

        password = self.lnd_config['password']
        passphrase = self.lnd_config['passphrase']

        if os.path.exists(self.dir_name + '/data/chain/bitcoin/' + self.lnd_config['lndnetwork'] + '/admin.macaroon'):
            self.is_new_node = False
            print("lnd node exist. Run grpc unlock!")
        else:
            print("folder not found" + self.dir_name + '/data/chain/bitcoin/' + self.lnd_config[
                'lndnetwork'] + '/admin.macaroon')
            try:
                shutil.rmtree(self.dir_name + '/data')
            except Exception as e:
                print('An exception occurred: {}'.format(e))
        try:
            # initialize and create wallet if is new node else unlock
            if self.is_new_node:
                if self.restore_node == 'NONE':
                    geen_seed = wallet_unlocker.genseed(passphrase.encode(), None)
                    cipher_seed_mnemonic = geen_seed.cipher_seed_mnemonic
                else:
                    seed, phrase = self.cipher_api.get_cipher_seed_details(self.restore_node)
                    cipher_seed_mnemonic = seed.split(",")
                    if phrase is not None:
                        passphrase = phrase

                processed_seed = ','.join(cipher_seed_mnemonic)
                self.save_to_file("geen_seed", processed_seed)

                response = wallet_unlocker.initwallet(password.encode(), cipher_seed_mnemonic,
                                                      passphrase.encode(), None, None)

                print(response)
                print("wallet creation successful")

            else:
                print("wait 30 sec for unlock wallet")
                time.sleep(30)
                print("unlocking wallet")
                response = wallet_unlocker.unlockwallet(password.encode(), None, None)
                if self.dev:
                    print(response)
                print("Unlock successful")

            return True

        except grpc._channel._InactiveRpcError as e:
            status_code = json.loads(e.debug_error_string())
            if status_code == 12:
                print("wallet already exist")
                return True

            print("Exception {}".format(e))
            print("wallet creation failed, retrying...")
            return False

    def save_to_file(self, filename, content):
        file_name = self.dir_name + f"/{filename}"
        file = open(file_name, 'w')
        file.write(str(content))
        file.close()

    def root_dir(self):

        dir_name = ''

        if 'datadir' in self.lnd_config:
            dir_name = self.lnd_config['datadir']
        else:
            dir_name = "/data/v3"

        return dir_name

    def create_lnd_config(self):
        min_channel_size = '20000'
        if self.lnd_config['wenv'] == 'production':
            min_channel_size = '500000'
            
        dir_name = self.root_dir()
        dir_name = dir_name + "/" + self.lnd_config['podname']
        Path(dir_name).mkdir(parents=True, exist_ok=True)
        if self.dev:
            print("Main folder for LND node: " + dir_name)

        file_name = dir_name + "/lnd.conf"
        file = open(file_name, 'w')

        content = '''
[Application Options]
    datadir=''' + dir_name + '''/data
    logdir=''' + dir_name + '''/logs
    debuglevel=debug
    maxlogfiles=3
    maxlogfilesize=10
    maxpendingchannels=10

    externalhosts=''' + self.lnd_config['podname'] + '''.ln.lqwd.tech
    alias= ''' + self.lnd_config['node_alias'] + '''
    
    #Path to TLS certificate for lnd's RPC and REST services.
    tlscertpath=''' + dir_name + '''/tls.cert

    #Path to TLS private key for lnd's RPC and REST services.
    tlskeypath=''' + dir_name + '''/tls.key


    tlsextraip=192.168.123.252
    tlsextradomain=''' + self.lnd_config['podname'] + '''.ln.lqwd.tech
    tlsextradomain=''' + self.lnd_config['podname'] + '''.lqwd-lnd
    listen=0.0.0.0:9735
    restlisten=0.0.0.0:8080
    rpclisten=0.0.0.0:10009

    #The number of peers that we should receive new graph updates from. This option
    #can be tuned to save bandwidth for light clients or routing nodes. (default: 3)
    numgraphsyncpeers=3

    #The color of the node in hex format, used to customize node appearance in
    #intelligence services.
    color=#3399FF
    

    # The smallest channel size (in satoshis) that we should accept. Incoming
    # channels smaller than this will be rejected, default value 20000.
    minchansize='''+min_channel_size+'''

       
[Bitcoin]
     bitcoin.active=1
     bitcoin.''' + self.lnd_config['lndnetwork'] + '''=1
     bitcoin.node=bitcoind
     bitcoin.defaultchanconfs=3
[Bitcoind]
     bitcoind.rpcuser=''' + self.lnd_config['rpcuser'] + '''
     bitcoind.rpcpass=''' + self.lnd_config['rpcpass'] + '''
     bitcoind.zmqpubrawblock=tcp://''' + self.lnd_config['rpchost'] + '''.''' + self.lnd_config['alias'] + ''':29088
     bitcoind.zmqpubrawtx=tcp://''' + self.lnd_config['rpchost'] + '''.''' + self.lnd_config['alias'] + ''':29099
     bitcoind.rpchost=''' + self.lnd_config['rpchost'] + '''.''' + self.lnd_config['alias'] + ''':853
[autopilot]
    autopilot.active=false
    autopilot.maxchannels=16
    autopilot.allocation=0.1
[Watchtower]
    watchtower.active=''' + self.lnd_config['watchtower'] + '''
[routerrpc]
   routerrpc.minrtprob=0.01
   routerrpc.apriorihopprob=0.6
   routerrpc.aprioriweight=0.5
   routerrpc.penaltyhalflife=1h
   routerrpc.attemptcost=100
         '''

        file.write(content)
        file.close()
        if self.dev:
            print(content)

        return dir_name
