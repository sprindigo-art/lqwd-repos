# python3
import base64
import codecs
import configparser
import json
import requests

# Library of helper functions to interact with LND node.
# Tech reference doc: https://api.lightning.community/rest/index.html?python#lnd-rest-api-reference
# For speed and better throughput using grpc is advised: https://api.lightning.community/?python#lnd-grpc-api-reference

class Lnd:
    # init with tls/ssl connection and a macaroon used for RPC authentication
    def __init__(self):
        config = configparser.ConfigParser()
        config.readfp(open(r'python_connect.conf'))
        self.cert_path = config.get("users", "tony") + config.get("default-path", "cert")
        self.macaroon = codecs.encode(open((config.get("users", "tony") + config.get("default-path", "macaroon")), 'rb').read(), 'hex')
        self.headers = {'Grpc-Metadata-macaroon': self.macaroon}
        self.nodeIP = config.get("default-path", "nodeIP")
        self.port = config.get("default-path", "port")


    def channel_backup(self):
        url = self.nodeIP + ":" + self.port + '/v1/channels/backup'
        r = requests.get(url, headers=self.headers, verify=self.cert_path)
        return r.json()

    def channel_backup_verify(self, single_backup, multi_backup):
        url = self.nodeIP + ":" + self.port + '/v1/channels/backup/verify'
        data = {
            'single_chan_backups': single_backup,  # array of single chan backups
            'multi_chan_backup': multi_backup,
        }
        r = requests.post(url, headers=self.headers, verify=self.cert_path, data=json.dumps(data))
        return r.json()

    def close_channel(self, funding_tx, output_index, sat_per_byte):
        url = self.nodeIP + ":" + self.port + '/v1/channels/' + funding_tx + "/" + output_index + \
        "?sat_per_byte=" + sat_per_byte
        print(url)
        r = requests.delete(url, headers=self.headers, verify=self.cert_path)
        return r.status_code

        # or r.raise_for_status()
        # json.decoder.JSONDecodeError: Extra data: line 2 column 1 (char 85)
        # TODO: fix the error, I think DELETE returns only status, not the payload

    def connect_peer(self, address, perm):
        url = self.nodeIP + ":" + self.port + '/v1/peers'
        data =  {
            'perm': perm,
            'addr': address
        }
        r = requests.post(url, headers=self.headers, verify=self.cert_path, data=json.dumps(data))
        return r.json()

    def decode_payment_request(self, pay_req):
        url = self.nodeIP + ":" + self.port + '/v1/payreq/' + pay_req
        r = requests.get(url, headers=self.headers, verify=self.cert_path)
        return r.json()

    def describe_graph(self):
        url = self.nodeIP + ":" + self.port + '/v1/graph/'
        r = requests.get(url, headers=self.headers, verify=self.cert_path)
        return r.json()

    def disconnect_peer(self, pubkey):
        url = self.nodeIP + ":" + self.port + '/v1/peers/' + pubkey
        r = requests.delete(url, headers=self.headers, verify=self.cert_path)
        return r.json()

    def forwarding_info(self, start_time, end_time, num_max_events, index_offset):
        url = self.nodeIP + ":" + self.port + '/v1/switch'
        data = {
            'start_time': start_time,  # string
            'end_time': end_time,  # string
            'num_max_events': num_max_events,  # int
            'index_offset': index_offset,
        }
        r = requests.post(url, headers=self.headers, verify=self.cert_path, data=json.dumps(data))
        return r.json()

    def gen_seed(self):
        url = self.nodeIP + ":" + self.port + '/v1/genseed'
        r = requests.get(url, verify=self.cert_path)
        print(r.json())

    def get_chain_info(self, chan_id):
        url = self.nodeIP + ":" + self.port + '/v1/graph/edge/' + chan_id
        r = requests.get(url, headers=self.headers, verify=self.cert_path)
        return r.json()

    def get_info(self):
        url = self.nodeIP + ":" + self.port + '/v1/getinfo'
        r = requests.get(url, headers=self.headers, verify=self.cert_path)
        return r.json()

    def get_feereport(self):
        url = self.nodeIP + ":" + self.port + '/v1/fees'
        r = requests.get(url, headers=self.headers, verify=self.cert_path)
        return r.json()
        
    def get_nodeinfo(self, pub_key):
        url = self.nodeIP + ":" + self.port + '/v1/node/' + pub_key
        r = requests.get(url, headers=self.headers, verify=self.cert_path)
        return r.json()

    def init_wallet(self):
        pass

    # Lists dictionary values of all the channels currently opened from the node.
    def list_channels(self):
        url = self.nodeIP + ":" + self.port + '/v1/channels'
        r = requests.get(url, headers=self.headers, verify=self.cert_path)
        return r.json()

    # Lists dictionary values of all the channels with a "closed" status
    # (non-available channels settled on the bitcoin layer).
    def list_channels_closed(self):
        url = self.nodeIP + ":" + self.port + '/v1/channels/closed'
        r = requests.get(url, headers=self.headers, verify=self.cert_path)
        return r.json()

    # Lists dictionary values of all the channels with a "pending" status
    # (during opening - waiting for 3 confirmations).
    def list_channels_pending(self):
        url = self.nodeIP + ":" + self.port + '/v1/channels/pending'
        r = requests.get(url, headers=self.headers, verify=self.cert_path)
        return r.json()

    def list_peers(self):
        url = self.nodeIP + ":" + self.port + '/v1/peers'
        r = requests.get(url, headers=self.headers, verify=self.cert_path)
        return r.json()

    def lookup_invoice(self, r_hash):
        url = self.nodeIP + ":" + self.port + '/v1/invoice/' + r_hash
        r = requests.get(url, headers=self.headers, verify=self.cert_path)
        return r.json()

    def new_address(self):
        url = self.nodeIP + ":" + self.port + '/v1/newaddress'
        r = requests.get(url, headers=self.headers, verify=self.cert_path)
        return r.json()

    def open_channel(self, pubkey, amt):
        # TODO add more fields and push dict with values as argument (None)
        url = self.nodeIP + ":" + self.port + '/v1/channels'
        private = False
        data = {
            'sat_per_byte': "2",
            'node_pubkey_string': pubkey,
            'local_funding_amount': amt,
            'private': private,
        }
        r = requests.post(url, headers=self.headers, verify=self.cert_path, data=json.dumps(data))
        return r.json()

    def query_routes(self, pub_key, amt):
        url = self.nodeIP + ":" + self.port + '/v1/routes/' + pub_key + "/" + amt
        r = requests.get(url, headers=self.headers, verify=self.cert_path)
        return r.json()

    def send_payment(self, pay_req):
        url = self.nodeIP + ":" + self.port + '/v1/channels/transactions'
        data = {
            "payment_request": pay_req
        }
        r = requests.post(url, headers=self.headers, verify=self.cert_path, data=json.dumps(data))
        return r.json()

    def unlock_wallet(self, password):
        url = self.nodeIP + ":" + self.port + '/v1/unlockwallet'
        data = {
            'wallet_password': base64.b64encode(password.encode()).decode(),
        }
        r = requests.post(url, verify=self.cert_path, data=json.dumps(data))
        return r.json()

    def update_chan_policy(self, glob, chan_point, tld, min_htlc, max_htlc, min_htlc_specified, fee_rate, base_fee):
        url = self.nodeIP + ":" + self.port + '/v1/chanpolicy'
        data = {
                'time_lock_delta': tld,                         # int
                'min_htlc_msat': min_htlc,                      # string
                'max_htlc_msat': max_htlc,                      # string
                'min_htlc_msat_specified': min_htlc_specified,  # bool
                'fee_rate': fee_rate,                           # double (msat)
                'base_fee_msat': base_fee,                      # string (msat)
        }
        if glob:
            data.update({'global': glob})                       # bool
        else:
            data.update({'chan_point:': chan_point})             # chan_point obj

        r = requests.post(url, headers=self.headers, verify=self.cert_path, data=json.dumps(data))
        return r.json()

    def utxos(self):
        url = self.nodeIP + ":" + self.port + '/v1/utxos'
        r = requests.get(url, headers=self.headers, verify=self.cert_path)
        return r.json()

    # Lists on-chain balance
    def wallet_balance(self):
        url = self.nodeIP + ":" + self.port + '/v1/balance/blockchain'
        r = requests.get(url, headers=self.headers, verify=self.cert_path)
        return r.json()

    # Class methods
    # Methods used to initiate specific end-goals:
    # (connect peer -> open channel -> change channel options)
    # (list all opened channels -> close all channels -> force close if not possible)

    # list all opened channels -> close all channels -> force close if not possible (request failed)
    def close_all(self):
        listchannels = self.list_channels()
        print("\nAll channels:")
        for channel in listchannels['channels']:
            print("\n {}".format(channel))
            if channel['active']:
                point_full = channel['channel_point']
                split = point_full.split(":")
                res = self.close_channel(split[0], split[1], "2")
                print(res)
        # TODO: force close is request failed

    def open_to_peer(self, node_id, amount):
        connect = True
        split_id = node_id.split("@")
        addr = {
            'pubkey' : split_id[0],
            'host' : split_id[1]
        }

        # Check available balance
        bal = self.wallet_balance()
        if int(bal['confirmed_balance']) > amount:

            # Open connection to peer
            peers = self.list_peers()

            # Check if peer is already connected
            for peer in peers["peers"]:
                if peer["pub_key"] == addr['pubkey']:
                    connect = False

            # Connect non-connected peer
            if connect == True:
                conn = self.connect_peer(addr, False)
                # print("\nConnection: \n {} \n".format(conn))

            # Open channel
            open = self.open_channel(addr["pubkey"], amount)
            return open

        else:
            return ["OnChain Balance is smaller than needed", bal['confirmed_balance']]



# main function used for testing
def main():
    lnd_i = Lnd()
    #
    # getinfo = lnd_i.get_info()
    # print("\nGetinfo: \n {} \n".format(getinfo))

    '''
    # init wallet - already done - one time action at the initializng step of creating new instance
    lnd_i.initWallet()
    lnd_i.unlockWallet()
    '''
    # generate a new address to send bitcoin into
    # newaddress = lnd_i.new_address()
    # print("\nNewaddress: \n {} \n".format(newaddress))

    # list utxos - check if the node has any balance to open the channels
    # utxos = lnd_i.utxos()
    # print("\nUtxos: \n {} \n".format(utxos))

    # optional: walletbalance to show sum of utxos balance
    walletbalance = lnd_i.wallet_balance()
    print("\nBalance: \n {} \n".format(walletbalance))

    # if balance not empty we can connect to another peer and open first channel
    # define example node public endpoint

    # pubkey = "0390b5d4492dc2f5318e5233ab2cebf6d48914881a33ef6a9c6bcdbb433ad986d0"
    # ip_addr = "46.229.165.136:9735"
    # addr = {
    #     'pubkey' : pubkey,
    #     'host' : ip_addr
    # }

    # configx = configparser.ConfigParser()
    # configx.readfp(open(r'peers_info.conf'))
    # node_id = configx.get("nodes", "opennode")
    # split_id = node_id.split("@")
    # addr = {
    #     'pubkey' : split_id[0],
    #     'host' : split_id[1]
    # }

    # print result: {} -> success; {error} -> error
    # connectpeer = lnd_i.connect_peer(addr, False)
    # print("\nResult: \n {} \n".format(connectpeer))

    # openchannel = lnd_i.open_channel(split_id[0], "20000")
    # print("\nConnnect Peer: \n {} \n".format(openchannel))

    # TODO: doesn't work - try on a fresh instance
    # genseed = lnd_i.gen_seed()
    # print("\nSeed dict: \n {} \n".format(genseed))

    # listchannels = lnd_i.list_channels()
    # print("\nAll channels:")
    # for channel in listchannels['channels']:
    #     print("\n {}".format(channel))

    # pay_req = "lnbc20n1p0xxgc8pp5ad0alldjyye33k9awrh68zqun6vaek6jprlczqzvyrak3len7r2qdqdvehhygr5dah8jxqrrss9qtzqqqqqq9qsqsp5z75nq2swlq4s2spvp6yhj922yrwrhgfhuy4pnxn8jsjfk865dn5srzjqwryaup9lh50kkranzgcdnn2fgvx390wgj5jd07rwr3vxeje0glcll7dtu0jj6wk9uqqqqlgqqqqqeqqjqxqzunyle27zd4wjcyjdfvrm8l8fesygx29hqwqmerve3hzgdrqjjdmxuwyxnpp8magvcw5enhcd2ml3zeemdwzswkk0gnw3pqv9yp3cq5s00jg"
    # payreq = lnd_i.decode_payment_request(pay_req=pay_req)
    # print("\nPayment request: \n {} \n".format(payreq))

    # send = lnd_i.send_payment(pay_req=pay_req)
    # print("\nPayment sent: \n {} \n".format(send))

    # lnd_i.close_all()

    listchannels = lnd_i.list_channels()
    print("\nAll channels: {}".format(listchannels))

    # listclosed = lnd_i.list_channels_closed()
    # print("\nClosed channels: \n {} \n".format(listclosed))
    #
    listpending = lnd_i.list_channels_pending()
    print("\nPending channels: \n {} \n".format(listpending))
    #
    # closechannel = lnd_i.close_channel(funding_tx="071d9fe66be5c2550ef98b80ea6d0ac67a01d27831425974bfd9676ef28be5b6", output_index="1", sat_per_byte="2")
    # print("\nClosed channel: \n {} \n".format(closechannel))
    #
    # update = lnd_i.update_chan_policy(True, None, 20, "1000", "1000", False, 0.001, "1000")
    # print("\nUpdated channels: \n {} \n".format(update))
    #
    # chandetails = lnd_i.get_chain_info(listchannels['channels'][0]['chan_id'])
    # print("\nDetails of channel: \n {} \n".format(chandetails))
    #

    # listpeers = lnd_i.list_peers()
    # print("\nPeers connected: \n")
    # for peer in listpeers["peers"]:
    #     print(peer)

    # disconnectpeer = lnd_i.disconnect_peer("02a5a95669adcb170dc85a70eef8bdd3e60b459d83bb47b6aac3e17c58faffc919")
    # print("\nDisconected peer: \n {} \n".format(disconnectpeer))

    # unlock = lnd_i.unlock_wallet("testpassword1")
    # print("\nUnlock Wallet: \n {} \n".format(unlock))

    # nodeinfo = lnd_i.get_nodeinfo("0242a4ae0c5bef18048fbecf995094b74bfb0f7391418d71ed394784373f41e4f3")
    # print("\nNode info: \n {} \n".format(nodeinfo))
    # TODO: Fix!

    # graph = lnd_i.describe_graph()
    # print("\nNodes: \n {} \n".format(graph["nodes"]))
    # TODO: FIx! 404 error?

    # open = lnd_i.open_to_peer("0242a4ae0c5bef18048fbecf995094b74bfb0f7391418d71ed394784373f41e4f3@3.124.63.44:9735", 20000)
    # print(open)

    chanbackup = lnd_i.channel_backup()
    print("\nChannel Backup: \n {} \n".format(chanbackup))
    print("\nMulti chan backup: \n {} \n".format(chanbackup['multi_chan_backup']))

    verify = lnd_i.channel_backup_verify(None, chanbackup['multi_chan_backup'])
    print("\nBackup verify: \n {} \n".format(verify))


# Calls main method when run from command line
if __name__ == "__main__": main()