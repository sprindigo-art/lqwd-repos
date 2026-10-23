import codecs
import json
import os
import shutil
import time
from pathlib import Path
import python_lnd_grpc
import requests
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
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
        self.lndDbUser = os.getenv("LND_DB_USER")
        self.lndDbPassword = os.getenv("LND_DB_PASS")
        self.lndDbHost = os.getenv("LND_DB_HOST")
        self.lndDbPort = os.getenv("LND_DB_PORT")
        self.lndId = os.getenv("LND_ID")
        self.etcdNode = os.getenv("ETCD_NODE")

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


    def create_lnd_db(self):
        try:
            con = psycopg2.connect(dbname='postgres', user=str(self.lndDbUser), password=str(self.lndDbPassword),host=str(self.lndDbHost), port=str(self.lndDbPort))
            con.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
            cursor= con.cursor()
            db_name= "lnd_"+ self.lndId
            query  = "CREATE DATABASE "+db_name
            cursor.execute(query)
            return True
        except Exception as e:
            return False



    def get_wallet_state(self):
        print("Get wallet state")
        url = self.localhost + '/v1/state'
        try:
            r = requests.get(url, verify=self.cert_path)
            result = r.json()
            return result["state"]
        except Exception as e:
            return None


    def unlock_create_wallet(self):
        print("creating wallet...")

        state = self.get_wallet_state()
        run_count  = 0
        wallet_ready = False

        wallet_unlocker = python_lnd_grpc.WalletUnlocker(
                    tls_file_path=self.dir_name + "/",
                    tls_file_name="tls.cert",
                    grpc_host="127.0.0.1",
                    grpc_port="10009",
                    network=self.lnd_config['lndnetwork'],
                    output="json-none-included",
                    is_wallet_unlocker=True

        )


        while state != "LOCKED" and state != "RPC_ACTIVE" and  state != "NON_EXISTING":
            time.sleep(5)
            state = self.get_wallet_state()

            print("State is : {}".format( 'None' if state == None else state ))
            if state != "WAITING_TO_START":
                #if node is waiting to start, then loop should continue until when leader node is dropped
                run_count = run_count + 1
            if run_count == 5:
                break


        run_unlock = False
        #once state is seen as LOCKED, then we can create or unlock wallet
        if state == "LOCKED" or state == "NON_EXISTING":

            password = self.lnd_config['password']
            passphrase = self.lnd_config['passphrase']
            #Try to create a new wallet

            try:
                print("Creating new wallet.")
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
                response = wallet_unlocker.initwallet(password.encode(), cipher_seed_mnemonic,passphrase.encode(), None, None)
                if self.dev:
                    print(response)
                wallet_ready = True
                print("wallet creation successful")
            except grpc._channel._InactiveRpcError as e:
                error_json = json.loads(e.debug_error_string())
                if error_json["grpc_status"] == 2:
                    run_unlock = True
                    print("Wallet already exist. going to unlock it now.")
                else:
                    print("Exception {}".format(e))


            #if wallet already exist. then unlock it
            if run_unlock == True:
                try:
                    print("Unlocking wallet.")
                    password=self.lnd_config['password']
                    response = wallet_unlocker.unlockwallet(password.encode(), None, None)
                    if self.dev:
                        print(response)
                    wallet_ready = True
                except grpc._channel._InactiveRpcError as e:
                    print("Exception {}".format(e))
                    print("Could not unlock wallet.")


        #if wallet state is RPC_ACTIVE, then we can say wallet is also ready
        if state == "RPC_ACTIVE":
            print("Wallet is already active")
            wallet_ready=False

        #let caller know if wallet is ready or not.
        return wallet_ready


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

        db_name= "lnd_"+ self.lndId
        self.create_lnd_db()


        content = '''
[Application Options]
    datadir=''' + dir_name + '''/data
    logdir=''' + dir_name + '''/logs
    debuglevel=debug
    maxlogfiles=3
    maxlogfilesize=10
    maxpendingchannels=10

    externalip=''' + self.lnd_config['podname'] + '''.ln.lqwd.tech
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

[postgres]
    db.postgres.dsn=postgresql://''' +  str(self.lndDbUser) + ''':''' +  str(self.lndDbPassword) + '''@'''+str(self.lndDbHost)+''':'''+str(self.lndDbPort)+'''/'''+db_name+'''?sslmode=disable
    db.postgres.timeout=0
    db.postgres.maxconnections=0
[db]
     db.backend=postgres
[etcd]
     db.etcd.host=''' +  str(self.etcdNode) + '''.lqwd-lnd:2379
     db.etcd.insecure_skip_verify=true
     db.etcd.disabletls=true
[cluster]
     cluster.enable-leader-election=true
     cluster.leader-elector=etcd
     cluster.id=''' + self.lnd_config['podname'] + '''

       
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
