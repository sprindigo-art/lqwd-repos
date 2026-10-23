import base64
import codecs
import os
import subprocess
import time
from pathlib import Path

import psutil as psutil
import python_lnd_grpc
import requests
import grpc
from cipher_api_handler import CipherAPIHandler
from cipherservice import CipherService
from redis_store import RedisStore
from confluent_kafka import Producer
from log_follower import LogFollower
import db_checker
import string
import random
import psycopg2
import config as config


class Lnd:
    def __init__(self, debug):
        self.dev = os.getenv("DEBUG")
        self.user = os.getenv("LND_DB_USER_MAIN")
        self.password = os.getenv("LND_DB_PASS_MAIN")
        self.host = os.getenv("LND_DB_HOST_MAIN")
        self.db_port = os.getenv("LND_DB_PORT_MAIN")
        self.podname = os.getenv("LND_PODNAME")

        self.root_dir = "/data/v3"
        lnd_node_params = self.get_config_params_from_db()
        if lnd_node_params == None:
            self.lnd_config = config.read_config("lnd.ini", "lnd")
            self.dev = debug
            self.is_new_node = True
            self.dir_name = self.root_dir + "/" + self.lnd_config['podname']
            self.macaroon_file = self.dir_name + '/data/chain/bitcoin/' + self.lnd_config[
                'lndnetwork'] + '/readonly.macaroon'
            self.macaroon = ''
            self.cert_path = self.dir_name + '/tls.cert'
            self.localhost = 'https://localhost:8080'
            self.headers = {'Grpc-Metadata-macaroon': self.macaroon}
            self.nodeIP = self.lnd_config['podname'] + '.' + self.lnd_config['alias']
            self.port = "10009"
            self.cipher_api = CipherAPIHandler()
            self.restore_node = os.getenv("RESTORATION_NODE")
            self.lnd_seed_exp_seconds = os.getenv("LND_SEED_EXP_SECONDS")
            self.lnd_non_custodial_value = os.getenv("LND_NON_CUSTODIAL_VALUE")
            self.redis_store = RedisStore()
            self.cipher_password = None
            self.lndnetworkMain = os.getenv("LND_NETWORK")
            self.lndnetwork = self.lndnetworkMain.lower()
            self.force_update_config = os.getenv("FORCE_UPDATE_CONFIG")
            self.wenv = os.getenv("WENV")
            self.watchtower = os.getenv("WATCHTOWER")
            self.owner = os.getenv("OWNER")
            self.rpcuser = os.getenv("BTC_RPCUSER")
            self.rpcpass = os.getenv("BTC_RPCPASS")
            self.rpchost = os.getenv("BTC_RPCHOST")
            self.usepostgres = os.getenv("USE_POSTGRES")
            self.external_ip = os.getenv("EXTERNAL_IP")
            self.lnd_min_channel_size = os.getenv("LND_MINCHAINSIZE")
            self.key_send_enabled = 0
            self.subscription = "K8_NEUTRINO"
            self.tor_enable = 0
            self.alias = os.getenv("LND_ALIAS")
            monitor_config = self.create_monitor_config()

            self.producer = Producer({'bootstrap.servers': monitor_config['kafka_host'],
                                      'sasl.username': monitor_config['user_kafka'],
                                      'sasl.mechanism': monitor_config['sasl_mechanism'],
                                      'sasl.password': monitor_config['user_kafka_pass'],
                                      'security.protocol': monitor_config['security_protocol']})
        else:
            self.is_new_node = True
            self.root_dir = "/data/v3"
            if "SUBSCRIPTION" in lnd_node_params:
                self.subscription = lnd_node_params["SUBSCRIPTION"]
            else:
                self.subscription = "K8_NEUTRINO"

            self.external_ip = lnd_node_params["EXTERNAL_IP"]
            self.alias = lnd_node_params["LND_ALIAS"]
            self.lndnetworkMain = lnd_node_params["LND_NETWORK"]
            self.lndnetwork = self.lndnetworkMain.lower()
            self.key_send_enabled = lnd_node_params["KEY_SEND_ENABLED"]
            self.dir_name = self.root_dir + "/" + self.podname
            self.macaroon_file = self.dir_name + '/data/chain/bitcoin/' + self.lndnetwork.lower() + '/readonly.macaroon'
            self.macaroon = ''
            self.cert_path = self.dir_name + '/tls.cert'
            self.localhost = 'https://localhost:8080'
            self.headers = {'Grpc-Metadata-macaroon': self.macaroon}
            self.nodeIP = self.podname + '.' + self.alias
            self.port = "10009"
            self.cipher_api = CipherAPIHandler()
            self.restore_node = lnd_node_params["RESTORATION_NODE"]
            self.lnd_seed_exp_seconds = lnd_node_params["LND_SEED_EXP_SECONDS"]
            self.lnd_non_custodial_value = lnd_node_params["LND_NON_CUSTODIAL_VALUE"]
            # self.lnd_non_custodial_value = "1"
            self.redis_store = RedisStore()
            self.cipher_password = None
            self.usepostgres = lnd_node_params["USE_POSTGRES"]
            self.namespace = lnd_node_params["NAMESPACE"]
            self.rpcuser = lnd_node_params["BTC_RPCUSER"]
            self.rpcpass = lnd_node_params["BTC_RPCPASS"]
            self.rpchost = lnd_node_params["BTC_RPCHOST"]
            if self.rpchost == "null":
                self.rpchost = os.getenv("BTC_RPCHOST")

            self.wenv = lnd_node_params["WENV"]
            self.watchtower = lnd_node_params["WATCHTOWER"]
            self.owner = lnd_node_params["OWNER"]
            self.lnd_public_port = lnd_node_params["LND_PUBLIC_PORT"]
            self.tor_enable = lnd_node_params["TOR_ENABLE"]
            self.lnd_min_channel_size = lnd_node_params["LND_MINCHAINSIZE"]
            self.force_update_config = lnd_node_params["FORCE_UPDATE_CONFIG"]


            kafka_host = os.getenv("KAFKA_HOST")
            kafka_user = os.getenv("KAFKA_USER")
            kafka_pass = os.getenv("KAFKA_PASSWORD")
            self.producer = Producer({'bootstrap.servers': kafka_host,
                                      'sasl.username': kafka_user,
                                      'sasl.mechanism': "PLAIN",
                                      'sasl.password': kafka_pass,
                                      'security.protocol': "SASL_PLAINTEXT"})
            self.lnd_config = {'podname': self.podname, 'lndnetwork': self.lndnetwork.lower(),
                               'watchtower': self.watchtower, 'owner': self.owner}


    def stop_lnd(self):

        cipherservice = CipherService(self.get_lnd_config(), self.dev)
        cipherservice.get_macaroon_and_tls_cert(self.podname)
        subprocess.call(['sh', '/root/python/stop_lnd.sh'])
        time.sleep(15)
        check_result = self.check_if_process_running("lnd")
        if (not check_result):
            subprocess.call(['sh', '/root/python/stop_lnd.sh'])
            time.sleep(15)
            check_result = self.check_if_process_running("lnd")
        return check_result

    def start_lnd(self):
        self.rename_old_log_files()
        subprocess.call(['sh', '/root/python/start_lnd.sh'])
        process_name = "lnd"
        return self.check_if_process_running(process_name)

    def check_if_process_running(slelf, processName):
        '''
        Check if there is any running process that contains the given name processName.
        '''
        # Iterate over the all the running process
        for proc in psutil.process_iter():
            try:
                # Check if process name contains the given name string.
                if processName.lower() in proc.name().lower():
                    return True
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                pass

    def check_lnd_status_in_db(self):
        # user = os.getenv("LND_DB_USER")
        # password = os.getenv("LND_DB_PASS")
        # host = os.getenv("LND_DB_HOST")
        # port = os.getenv("LND_DB_PORT")

        connection = None
        lnd_node_status = None
        try:
            # In PostgreSQL, default username is 'postgres' and password is 'postgres'.
            # And also there is a default database exist named as 'postgres'.
            # Default host is 'localhost' or '127.0.0.1'
            # And default port is '54322'.
            print('Database connection start for check REQUESTED Status')

            try:
                connection = psycopg2.connect(user=self.user, password=self.password, host=self.host, port=self.db_port, dbname='lnd')
            except Exception as e:
                print(e)
            cur = connection.cursor()
            status_sql = "SELECT id, lnd_node_name, status FROM lnd_node_status WHERE lnd_node_name = '" + self.podname + "' ORDER BY id DESC LIMIT 1"
            cur.execute(status_sql)
            records = cur.fetchall()
            if len(records) < 1:
                print("no records found. Start checking current status and update it DB")
                self.update_lnd_status("RUNNING")
            print(records)
            for record in records:
                print(record)

                lnd_node_status = record[2]

                print("status is :", lnd_node_status)
            cur.close()
            connection.close()

        except Exception as e:
            print('Database not connected for checking. Connection Error.', e)

        return lnd_node_status

    def get_config_params_from_db(self):
        # user = os.getenv("LND_DB_USER")
        # password = os.getenv("LND_DB_PASS")
        # host = os.getenv("LND_DB_HOST")
        # port = os.getenv("LND_DB_PORT")

        connection = None
        lnd_node_config = None
        try:
            # In PostgreSQL, default username is 'postgres' and password is 'postgres'.
            # And also there is a default database exist named as 'postgres'.
            # Default host is 'localhost' or '127.0.0.1'
            # And default port is '54322'.
            print('database connection start in config params')

            if self.dev == "debug":
                print(self.user, self.password, self.host, self.port)
            try:
                connection = psycopg2.connect(user=self.user, password=self.password, host=self.host, port=self.db_port, dbname='lnd')
            except Exception as e:
                print(e)
                return None
            print('Database connected for Get params from db.')
            cur = connection.cursor()
            status_sql = "SELECT * FROM lnd_node_configs WHERE lnd_node_name = '" + self.podname + "'"
            print(status_sql)
            cur.execute(status_sql)
            records = cur.fetchall()
            print("records loaded from DB")
            lnd_config = ""
            for record in records:

                lnd_config = record[4]

            cur.close()
            connection.close()
            lnd_config = lnd_config.replace("{", "")
            lnd_config = lnd_config.replace("}", "")
            lnd_config = lnd_config.split(",")
            lnd_node_config = {}
            for conf in lnd_config:
                conf_ar = conf.split("=")
                conf_ar_1 = conf_ar[0]
                conf_ar_1 = conf_ar_1.replace(" ", "")
                lnd_node_config[conf_ar_1] = conf_ar[1]
            print(lnd_node_config)
        except Exception as e:
            print('Error in Get configuration from DB function', e)

        # closing database connection
        finally:
            if connection:
                cur.close()
                connection.close()
                print("PostgreSQL connection is closed with finally \n")
        if len(lnd_node_config) < 1:
            lnd_node_config = None
        return lnd_node_config

    def update_lnd_status(self, status):
        # user = os.getenv("LND_DB_USER")
        # password = os.getenv("LND_DB_PASS")
        # host = os.getenv("LND_DB_HOST")
        # port = os.getenv("LND_DB_PORT")

        connection = None
        lnd_node_status = None
        try:
            # In PostgreSQL, default username is 'postgres' and password is 'postgres'.
            # And also there is a default database exist named as 'postgres'.
            # Default host is 'localhost' or '127.0.0.1'
            # And default port is '54322'.
            print('database connection start')
            if self.dev == "debug":
                print(self.user, self.password, self.host, self.port)
            connection = psycopg2.connect(user=self.user, password=self.password, host=self.host, port=self.db_port, dbname='lnd')
            print('Database connected for Update Status.')
            cur = connection.cursor()
            status_sql = "INSERT INTO lnd_node_status (status, lnd_node_name, result_updated) VALUES ('" + status + "', '" + self.podname + "', 'restart completed')"
            cur.execute(status_sql)
            connection.commit()
            cur.close()
            connection.close()

        except Exception as e:
            print('Database not connected for checking. Connection Error.', e)

        return lnd_node_status

    def get_lnd_config(self):
        lnd_config = {"cipher_password": self.cipher_password, "lndnetwork": self.lndnetwork.lower(), "dir_name": self.dir_name,
                      "wenv": self.wenv, "podname": self.podname, "watchtower": self.watchtower,
                      "owner": self.owner,
                      'nodeName': self.podname,
                      'domain': self.rpchost,
                      'rpchost': self.rpchost,
                      'rpcpass': self.rpcpass,
                      'rpcuser': self.rpcuser}

        return lnd_config

    def get_dir_name(self):
        return self.dir_name

    def get_lnd_port(self):
        lnd_public_port = os.getenv("LND_PUBLIC_PORT")
        if (lnd_public_port == 0):
            num = ""
            for c in self.podname:
                if c.isdigit():
                    num = num + c
            return num
        else:
            return lnd_public_port

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
                if "identity_pubkey" in r.json():
                    return r.json()
                else:
                    print("No identity_pubkey")
                    print(r.json())
                    result = 1
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

    def send_lnd_fail_message(self, nodeId):
        self.producer.produce("lnd-failed", value=nodeId, key=nodeId)
        self.producer.flush()

    def update_lnd_version(self, lnd_version, script_version):
        node_id = self.podname
        json_message = f'{{"nodeName":"{node_id}","lndVersion":"{lnd_version}","scriptVersion":"{script_version}"}}'

        self.producer.produce("version-update", value=json_message, key=node_id)
        self.producer.flush()

    def unlock_create_wallet(self):
        print("Unlock or creating wallet start...", self.dir_name)

        tlsfilecheck = self.dir_name + "/" + '/tls.cert'
        tlsfile_exists = os.path.exists(tlsfilecheck)
        while not tlsfile_exists:
            time.sleep(5)
            tlsfile_exists = os.path.exists(tlsfilecheck)
        print("tls file exist")
        wallet_un_locker = python_lnd_grpc.WalletUnlocker(
            tls_file_path=self.dir_name + "/",
            tls_file_name="tls.cert",
            grpc_host="127.0.0.1",
            grpc_port="10009",
            network=self.lndnetwork.lower(),
            output="json-none-included",
            is_wallet_unlocker=True
        )

        logfile = self.dir_name + '/logs/bitcoin/' + self.lndnetwork.lower() + '/lnd.log'
        file_exists = os.path.exists(logfile)
        print("checking logs file")
        while not file_exists:
            time.sleep(5)
            file_exists = os.path.exists(logfile)
        print("Start follow lnd logs")

        follow = LogFollower(open(logfile))

        # read existing lines
        ready_for_unlock = False
        for line in follow:
            print(line)
            if line.find("Waiting for wallet encryption password. Use `lncli create` to create a wallet") != -1:
                ready_for_unlock = True

        # continue reading log file

        while not ready_for_unlock:
            for line in follow:
                print(line)
                if line.find("Waiting for wallet encryption password. Use `lncli create` to create a wallet") != -1:
                    ready_for_unlock = True

        passphrase = None
        password = os.getenv("LND_PASSWORD")
        #print("lnd pass by default :" + password)
        user_passphrase = self.redis_store.get(self.podname + "-passphrase")
        unlock_password = password
        if user_passphrase != None:
            total_wait_loop = 0
            # if it is non custodial then we need to keep waiting until we get that
            # passphrase  from redis before proceeding
            while user_passphrase is None:
                print("could not get user passphrase. will wait until it comes in")
                # wait 30 seconds and check again
                time.sleep(5)
                user_passphrase = self.redis_store.get(self.podname + "-passphrase")
                total_wait_loop += 1
                # send kafka message so  user can get notification to unlock wallet.
                if total_wait_loop == 10:
                    self.send_unlock_fail_message(self.podname)

            # now we have gotten  passphrase from redis we can continue
            data = self.cipher_api.decrypt(user_passphrase.decode("utf-8"), 'AEAD')
            self.cipher_password = base64.b64decode(data).decode("utf-8")
            passphrase = self.cipher_password.encode()
            password = password + "_" + self.cipher_password

        if os.path.exists(self.dir_name + '/data/chain/bitcoin/' + self.lndnetwork.lower()
                          + '/readonly.macaroon'):
            self.is_new_node = False

        try:
            # initialize and create wallet if is new node else unlock
            if self.is_new_node:
                if self.restore_node == '0':
                    geen_seed = wallet_un_locker.genseed(passphrase, None)
                    cipher_seed_mnemonic = geen_seed.cipher_seed_mnemonic
                else:
                    seed = self.redis_store.get(self.podname + "-seed")
                    if seed is None:
                        print("restoration seed is empty")
                        return False, False

                    cipher_seed_mnemonic = seed.split(",")

                processed_seed = ','.join(cipher_seed_mnemonic)

                # only save seed to file if non custodial
                if self.lnd_non_custodial_value == "1":
                    self.save_to_file("geen_seed", processed_seed)

                self.redis_store.set_with_expiry(self.podname + "-seed", processed_seed,
                                                     self.lnd_seed_exp_seconds)
                print("seed sets in Redis with expiry time : ", self.lnd_seed_exp_seconds )

                wallet_un_locker.initwallet(unlock_password.encode(), cipher_seed_mnemonic,
                                            passphrase, None, None)

                time.sleep(30)
                print("wallet creation successful")

            else:
                print("unlocking wallet")
                result = self.unlock_wallet(unlock_password, wallet_un_locker)
                print("unlocking wallet result : " + str(result))
                if not result:
                    result = self.unlock_wallet(password, wallet_un_locker)
                    print("unlocking wallet result : " + str(result))
                return result, self.is_new_node

            return True, self.is_new_node

        except grpc._channel._InactiveRpcError as e:
            print("grpc Exception: " + str(e))
            if e != None:
                        # initializing substrings
                sub1 = "grpc_status:"
                sub2 = ","

                # getting index of substrings
                estring = e.debug_error_string()
                idx1 = estring.index(sub1)
                res = estring[idx1 + len(sub1) + 1: 1]
                print(res + "Result of error and status")
                # status = json.loads(e.debug_error_string())
                if len(res) == 1:
                    if res == '2':
                        result = self.unlock_wallet(password, wallet_un_locker)

                        return result, False

                print("Exception {}".format(e))

            return False, self.is_new_node

    def unlock_wallet(self, password, wallet_unlocker):
        try:
            if password != None :
                response = wallet_unlocker.unlockwallet(password.encode(), None, None)
                print(response)

                print("Unlock successful")
                return response
            else:
                print("Password is None for unlock wallet")
                return False
        except grpc._channel._InactiveRpcError as e:
            print("grpc Exception: " + str(e))
            return False

    def save_to_file(self, filename, content):
        file_name = self.dir_name + f"/{filename}"
        file = open(file_name, 'w')
        file.write(str(content))
        file.close()

    def create_key_send_conf(self):
        if self.key_send_enabled == '1':
            return f'''
        #allows lnd send and receive payments using pubkey
        accept-amp=true
        accept-keysend=true
            '''
        return ""

    def create_btcd_connection_conf(self):

        self.lndnetwork = self.lndnetwork.lower()

        wenv = self.wenv

        if wenv is None :
            wenv = 'developmnet'

        if self.subscription == "K8_NEUTRINO" and wenv != 'development':
            fee_estimate = 'neutrino.feeurl=https://nodes.lightning.computer/fees/v1/btc-fee-estimates.json'
            port_neutrino = 8333
            if self.lndnetwork == 'testnet':
                port_neutrino = 18333
                fee_estimate = 'neutrino.feeurl=https://nodes.lightning.computer/fees/v1/btctestnet-fee-estimates.json'
            return f'''
    [Bitcoin]
        bitcoin.active=1
        bitcoin.{self.lndnetwork}=1
        bitcoin.node=neutrino
        bitcoin.defaultchanconfs=3
    [Neutrino]
        
        neutrino.addpeer={self.rpchost}:{port_neutrino}
        {fee_estimate}
        
        # neutrino.addpeer=btcd-testnet.lightning.computer
        # neutrino.addpeer=lnd.bitrefill.com:18333
        # neutrino.addpeer=faucet.lightning.community
        
    '''
        else :
            if self.rpchost == "null":
                self.rpchost = os.getenv("BTC_RPCHOST")
            if self.rpcuser == "null":
                self.rpcuser = os.getenv("BTC_RPCUSER")
            if self.rpcpass == "null":
                self.rpcpass = os.getenv("BTC_RPCPASS")
            return f'''
    [Bitcoin]
        bitcoin.active=1
        bitcoin.{self.lndnetwork}=1
        bitcoin.node=bitcoind
        bitcoin.defaultchanconfs=3
    [Bitcoind]
        bitcoind.rpcuser={self.rpcuser}
        bitcoind.rpcpass={self.rpcpass}
        bitcoind.zmqpubrawblock=tcp://{self.rpchost}:29088
        bitcoind.zmqpubrawtx=tcp://{self.rpchost}:29099
        bitcoind.rpchost={self.rpchost}:853
        
        bitcoin.chanreservescript="0 if (chanAmt < 4500000) else chanAmt//100"
        
    '''

    def create_db_config(self):
        if self.usepostgres == '1':
            user = os.getenv("LND_DB_USER")
            password = os.getenv("LND_DB_PASS")
            host = os.getenv("LND_DB_HOST")
            port = os.getenv("LND_DB_PORT")
            return f'''
    [postgres]
        db.postgres.dsn=postgresql://{user}:{password}@{host}:{port}/{str(self.podname)}?sslmode=disable
        db.postgres.timeout=0
        db.postgres.maxconnections=0
    [db]
        db.backend=postgres
        '''
        return ""

    def get_external_host(self):

        externalhost = self.podname + ".ln.lqwd.tech"

        wenv = self.wenv
        if wenv is not None and wenv == 'stage':
            externalhost = self.podname + ".ln-stage.lqwd.tech"

        return externalhost

    def get_external_ip(self):
        self.external_ip = self.external_ip

    def tor_enable_create(self):
        if self.tor_enable == '1111':
            tor_pass = ''.join(random.choice(string.ascii_letters) for i in range(8))
            tor_pass = tor_pass.join(random.choice(string.digits) for i in range(6))
            tor_hash_pass = "tor --hash-password " + tor_pass
            tor_hash_pass_result = os.popen(tor_hash_pass).read()
            postString = tor_hash_pass_result.split("\n")
            tor_file = open(self.dir_name + "/torrc", 'w')
            content = f'''
                    ControlPort 9051
                    SOCKSPort 9050
                    HashedControlPassword {postString[1]}'''
            tor_file.write(content)
            tor_file.close()
            print(postString[1])
            return f'''
    [tor]
        tor.active=1
        tor.v3=1
        tor.password={tor_pass}
        tor.skip-proxy-for-clearnet-targets=true
        tor.streamisolation=false 
                   '''
        else:
            return ""

    def rename_old_log_files(self):
        # checking if old log file exist
        # if yes rename it.
        old_logfile = self.dir_name + '/logs/bitcoin/' + self.lndnetwork + '/lnd.log'
        file_exists = os.path.exists(old_logfile)
        print("checking if old file exist = ", old_logfile, file_exists)
        if file_exists:
            dt = time.strftime("%Y%m%d-%H%M%S")
            new_logfile = self.dir_name + '/logs/bitcoin/' + self.lndnetwork + '/lnd' + dt + '.old_logs'
            os.rename(old_logfile, new_logfile)
            print("old file renamed to ", new_logfile)

    def create_lnd_config(self):
        self.rename_old_log_files()
        # checking if old config file exist
        # if yes, checking if we have force update it.
        conf_file = self.dir_name + '/lnd.conf'
        file_exists = os.path.exists(conf_file)
        force_update = self.force_update_config
        if file_exists and force_update == 1:
            print("Config file exit and force update is true", file_exists, force_update)
            dt = time.strftime("%Y%m%d-%H%M%S")
            new_conf_file = self.dir_name + '/lnd' + dt + '.conf'
            os.rename(conf_file, new_conf_file)

        file_exists = os.path.exists(conf_file)
        if file_exists:
            return self.dir_name

        if self.usepostgres == '1':
            checker = db_checker.check_and_create_db(self.podname)
        if not checker:
            exit("DB Error")
        self.get_external_ip()
        db_config = self.create_db_config()
        btcd_connection_config = self.create_btcd_connection_conf()
        key_send_conf = self.create_key_send_conf()
        external_host = self.get_external_host()
        lnd_port_number = self.get_lnd_port()
        Path(self.dir_name).mkdir(parents=True, exist_ok=True)

        if self.dev:
            print("Main folder for LND node: " + self.dir_name)

        file_name = self.dir_name + "/lnd.conf"
        file = open(file_name, 'w')

        watchtower = self.watchtower

        lnd_min_channel_size = self.lnd_min_channel_size

        if lnd_min_channel_size is None:
            lnd_min_channel_size = 10000

        tor_params = self.tor_enable_create()

        content = f'''
    [Application Options]
        datadir={self.dir_name}/data
        logdir={self.dir_name}/logs
        #debuglevel=debug
        maxlogfiles=3
        maxlogfilesize=10
        maxpendingchannels=10
    
        protocol.option-scid-alias=true
        protocol.zero-conf=true
        restlisten=0
        accept-keysend=true
        debuglevel=info,CNCT=debug
        externalip={self.external_ip}:{lnd_port_number}
        alias=LQWD-Breez-lnd
        
        
        #Path to TLS certificate for lnd's RPC and REST services.
        tlscertpath={self.dir_name}/tls.cert
    
        #Path to TLS private key for lnd's RPC and REST services.
        tlskeypath={self.dir_name}/tls.key
    
    
        tlsextraip={self.external_ip}
        tlsextradomain={external_host}
        tlsextradomain={self.podname}.lqwd-lnd
        listen=0.0.0.0:9735
        restlisten=0.0.0.0:8080
        rpclisten=0.0.0.0:10009
    
        #The number of peers that we should receive new graph updates from. This option
        #can be tuned to save bandwidth for light clients or routing nodes. (default: 3)
        numgraphsyncpeers=5
    
        #The color of the node in hex format, used to customize node appearance in
        #intelligence services.
        color=#3399FF
        
        # The smallest channel size (in satoshis) that we should accept. Incoming
        # channels smaller than this will be rejected, default value 20000.
        minchansize={lnd_min_channel_size}
        {key_send_conf}
        
    {db_config}
    
    {btcd_connection_config}
    
    [autopilot]
        autopilot.active=false
        autopilot.maxchannels=16
        autopilot.allocation=0.1
    [Watchtower]
        watchtower.active={watchtower}
    [routerrpc]
       routerrpc.minrtprob=0.01
       routerrpc.apriorihopprob=0.6
       routerrpc.aprioriweight=0.5
       routerrpc.penaltyhalflife=1h
       routerrpc.attemptcost=100
       
   {tor_params}    
             '''

        file.write(content)
        file.close()
        wenv = self.wenv
        if wenv is not None and wenv == 'development':
            print(content)

        return self.dir_name


    def create_monitor_config(self):
        monitor_config = {'kafka_host': os.getenv("KAFKA_HOST"), 'schema_host': os.getenv("SCHEMA_HOST"),
                          'user_kafka': os.getenv("KAFKA_USER"), 'sasl_mechanism': "PLAIN",
                          'user_kafka_pass': os.getenv("KAFKA_PASSWORD"), 'security_protocol': "SASL_PLAINTEXT",
                          'kafka_co_topic': os.getenv("KAFKA_CO_TOPIC"), 'kafka_pro_topic': os.getenv("KAFKA_PRO_TOPIC"),
                          'monitor_node_name': os.getenv("LND_PODNAME"), 'monitor_node_host': "localhost",
                          'monitor_node_port': "8080", 'monitor_node_network': os.getenv("LND_NETWORK"),
                          'monitor_debug': os.getenv("DEBUG"), 'kafka_co_group_id': "334", 'kafka_offset_reset': "earliest"}

        return monitor_config



