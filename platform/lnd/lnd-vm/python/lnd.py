import base64
import codecs
import json
import os
import time
from pathlib import Path
import python_lnd_grpc
import requests
import config as config
import grpc
from cipher_api_handler import CipherAPIHandler
from redis_store import RedisStore
from confluent_kafka import Producer


class Lnd:
    def __init__(self, lnd_config, debug):

        self.lnd_config = lnd_config
        self.dev = debug
        self.is_new_node = True
        self.pod_name = os.getenv("LND_POD_NAME")
        self.lnd_network = os.getenv("LND_NETWORK")
        self.dir_name = self.root_dir() + "/" + self.pod_name
        self.macaroon_file = self.dir_name + '/data/chain/bitcoin/' + self.lnd_network + '/readonly.macaroon'
        self.macaroon = ''
        self.cert_path = self.dir_name + '/tls.cert'
        self.localhost = 'https://localhost:8080'
        self.headers = {'Grpc-Metadata-macaroon': self.macaroon}
        self.cipher_api = CipherAPIHandler(lnd_config)
        self.restore_node = os.getenv("RESTORATION_NODE")
        self.lnd_seed_exp_seconds = os.getenv("LND_SEED_EXP_SECONDS")
        self.lnd_non_custodial_value = os.getenv("LND_NON_CUSTODIAL_VALUE")
        self.redis_store = RedisStore(lnd_config['redis_cred'])
        self.cipher_password = None
        monitor_config = config.read_config('monitor.ini', 'monitor')
        self.producer = Producer({'bootstrap.servers': os.getenv("KAFKA_HOST"),
                                  'sasl.username': monitor_config['user_kafka'],
                                  'sasl.mechanism': monitor_config['sasl_mechanism'],
                                  'sasl.password': monitor_config['user_kafka_pass'],
                                  'security.protocol': monitor_config['security_protocol']})

    def get_dir_name(self):
        return self.dir_name

    def get_cipher_password(self):
        return self.cipher_password

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
                return r.json()
            except Exception as e:
                print(e)
                result = 1
            if result == 1:
                time.sleep(15)
            else:
                indicator = False
        return None

    def send_unlock_fail_message(self, nodeId):
        self.producer.produce("lnd-unlock-failed", value=nodeId, key=nodeId)
        self.producer.flush()

    def update_lnd_version(self, lnd_version, script_version):
        node_id = self.pod_name
        json_message = f'{{"nodeName":"{node_id}","lndVersion":"{lnd_version}","scriptVersion":"{script_version}"}}'

        self.producer.produce("version-update", value=json_message, key=node_id)
        self.producer.flush()

    def unlock_create_wallet(self):
        print("creating wallet...")

        wallet_un_locker = python_lnd_grpc.WalletUnlocker(
            tls_file_path=self.dir_name + "/",
            tls_file_name="tls.cert",
            grpc_host="127.0.0.1",
            grpc_port="10009",
            network=self.lnd_network,
            output="json-none-included",
            is_wallet_unlocker=True
        )
        passphrase = None
        password = self.lnd_config['password']
        if self.lnd_non_custodial_value == "1":
            user_passphrase = self.redis_store.get(self.pod_name + "-passphrase")

            total_wait_loop = 0
            # if it is non custodial then we need to keep waiting until we get that
            # passphrase  from redis before proceeding
            while user_passphrase is None:
                print("could not get user passphrase. will wait until it comes in")
                # wait 30 seconds and check again
                time.sleep(5)
                user_passphrase = self.redis_store.get(self.pod_name + "-passphrase")
                total_wait_loop += 1
                # send kafka message so  user can get notification to unlock wallet.
                if total_wait_loop == 1:
                    self.send_unlock_fail_message(self.pod_name)

            # now we have gotten  passphrase from redis we can continue
            data = self.cipher_api.decrypt(user_passphrase.decode("utf-8"), 'AEAD')
            self.cipher_password = base64.b64decode(data).decode("utf-8")
            passphrase = self.cipher_password.encode()
            password = password + "_" + self.cipher_password

        if os.path.exists(self.dir_name + '/data/chain/bitcoin/' + self.lnd_network
                          + '/readonly.macaroon'):
            self.is_new_node = False

        try:
            # initialize and create wallet if is new node else unlock
            if self.is_new_node:
                if self.restore_node is None or self.restore_node == "0":
                    geen_seed = wallet_un_locker.genseed(passphrase, None)
                    cipher_seed_mnemonic = geen_seed.cipher_seed_mnemonic
                else:
                    seed = self.redis_store.get(self.pod_name + "-seed")
                    if seed is None:
                        print("restoration seed is empty")
                        return False, False

                    cipher_seed_mnemonic = seed.split(",")

                processed_seed = ','.join(cipher_seed_mnemonic)

                # only save seed to file if non custodial
                if self.lnd_non_custodial_value == "0":
                    self.save_to_file("geen_seed", processed_seed)
                else:
                    self.redis_store.set_with_expiry(self.pod_name + "-seed", processed_seed,
                                                     self.lnd_seed_exp_seconds)

                print("seed", cipher_seed_mnemonic)
                wallet_un_locker.initwallet(password.encode(), cipher_seed_mnemonic,
                                            passphrase, None, None)

                time.sleep(30)
                print("wallet creation successful")

            else:
                print("unlocking wallet")
                self.unlock_wallet(password, wallet_un_locker)

            return True, self.is_new_node

        except grpc._channel._InactiveRpcError as e:
            status = json.loads(e.debug_error_string())
            if 'grpc_status' in status.keys():
                if status['grpc_status'] == 2:
                    self.unlock_wallet(password, wallet_un_locker)
                    return True, False

            print("Exception {}".format(e))

            return False, self.is_new_node

    def unlock_wallet(self, password, wallet_unlocker):
        response = wallet_unlocker.unlockwallet(password.encode(), None, None)
        if self.dev:
            print(response)
        time.sleep(30)
        print("Unlock successful")

    def save_to_file(self, filename, content):
        file_name = self.dir_name + f"/{filename}"
        file = open(file_name, 'w')
        file.write(str(content))
        file.close()

    def root_dir(self):
        return "/home/ubuntu/data/v3"

    def create_lnd_config(self):
        db_config = ""
        if os.getenv("USE_POSTGRES") == '1':
            user = self.lnd_config['db_user']
            password = self.lnd_config['db_password']
            host = os.getenv("LND_DB_HOST")
            port = os.getenv("LND_DB_PORT")
            db_config = f'''
        [postgres]
            db.postgres.dsn=postgresql://{user}:{password}@{host}:{port}/{str(
                self.pod_name)}?sslmode=disable
            db.postgres.timeout=0
            db.postgres.maxconnections=0
        [db]
            db.backend=postgres
        '''

        min_channel_size = '20000'
        if self.lnd_config['wenv'] == 'production':
            min_channel_size = '500000'

        dir_name = self.root_dir() + "/" + self.pod_name
        Path(dir_name).mkdir(parents=True, exist_ok=True)

        if self.dev:
            print("Main folder for LND node: " + dir_name)

        file_name = dir_name + "/lnd.conf"
        file = open(file_name, 'w')

        content = f'''
[Application Options]
    datadir={dir_name}/data
    logdir={dir_name}/logs
    debuglevel=debug
    maxlogfiles=3
    maxlogfilesize=10
    maxpendingchannels=10

    externalhosts={self.pod_name}.ln.lqwd.tech
    alias= {os.getenv("ALIAS")}
    
    #Path to TLS certificate for lnd's RPC and REST services.
    tlscertpath={dir_name}/tls.cert

    #Path to TLS private key for lnd's RPC and REST services.
    tlskeypath={dir_name}/tls.key


    tlsextraip=192.168.123.252
    tlsextradomain={self.pod_name}.ln.lqwd.tech
    tlsextradomain={self.pod_name}.lqwd-lnd
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
    minchansize={min_channel_size}

{db_config}

[Bitcoin]
     bitcoin.active=1
     bitcoin.{self.lnd_network}=1
     bitcoin.node=bitcoind
     bitcoin.defaultchanconfs=3
[Bitcoind]
     bitcoind.rpcuser={self.lnd_config['rpcuser']}
     bitcoind.rpcpass={self.lnd_config['rpcpass']}
     bitcoind.zmqpubrawblock=tcp://{os.getenv("LND_RPC_HOST")}:29088
     bitcoind.zmqpubrawtx=tcp://{os.getenv("LND_RPC_HOST")}:29099
     bitcoind.rpchost={os.getenv("LND_RPC_HOST")}:853
[autopilot]
    autopilot.active=false
    autopilot.maxchannels=16
    autopilot.allocation=0.1
[Watchtower]
    watchtower.active={os.getenv("WATCHTOWER")}
[routerrpc]
   routerrpc.minrtprob=0.01
   routerrpc.apriorihopprob=0.6
   routerrpc.aprioriweight=0.5
   routerrpc.penaltyhalflife=1h
   routerrpc.attemptcost=100
         '''

        file.write(content)
        file.close()
        if os.getenv("WENV") == 'development':
            print(content)

        return dir_name
