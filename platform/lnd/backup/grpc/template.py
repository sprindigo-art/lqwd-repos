# python3

import rpc_pb2 as ln
import rpc_pb2_grpc as lnrpc
import walletunlocker_pb2 as walletrpc
import walletunlocker_pb2_grpc as walletunlockerstub
import grpc
import os
import codecs
from rpc_pb2 import FeeReportResponse

# Library of helper functions to interact with LND node.
# Docs reference: https://api.lightning.community/?python#lnd-grpc-api-reference

class Wallet():
    # init with tls/ssl connection and a macaroon used for RPC authentication
    def __init__(self):
        # Lnd cert is at ~/.lnd/tls.cert on Linux and
        # ~/Library/Application Support/Lnd/tls.cert on Mac
        self.cert = open(os.path.expanduser('~/.lnd/tls.cert'), 'rb').read()
        self.creds = grpc.ssl_channel_credentials(self.cert)
        self.channel = grpc.secure_channel('localhost:10009', self.creds)
        self.walletstub = walletunlockerstub.WalletUnlockerStub(self.channel)
        # with open(os.path.expanduser('~/.lnd/data/chain/bitcoin/mainnet/admin.macaroon'), 'rb') as f:
        #     self.macaroon_bytes = f.read()
        #     self.macaroon = codecs.encode(self.macaroon_bytes, 'hex')

    def change_password(self, old, new):
        request = walletrpc.ChangePasswordRequest(
            current_password=old,
            new_password=new,
        )
        response = self.walletstub.ChangePassword(request)
        return response

    def unlock(self, passwd):
        request = walletrpc.UnlockWalletRequest(
            wallet_password=passwd,
        )
        response = self.walletstub.UnlockWallet(request)
        return response


class Lnd():
    # init with tls/ssl connection and a macaroon used for RPC authentication
    def __init__(self):
        # Lnd cert is at ~/.lnd/tls.cert on Linux and
        # ~/Library/Application Support/Lnd/tls.cert on Mac
        self.cert = open(os.path.expanduser('~/.lnd/tls.cert'), 'rb').read()
        self.creds = grpc.ssl_channel_credentials(self.cert)
        self.channel = grpc.secure_channel('localhost:10009', self.creds)
        self.stub = lnrpc.LightningStub(self.channel)
        # self.walletstub = lnrpc.WalletUnlockerStub(self.channel)
        with open(os.path.expanduser('~/.lnd/data/chain/bitcoin/mainnet/admin.macaroon'), 'rb') as f:
            self.macaroon_bytes = f.read()
            self.macaroon = codecs.encode(self.macaroon_bytes, 'hex')

    def channel_balance(self):
        request = ln.ChannelBalanceRequest()
        response = self.stub.ChannelBalance(request, metadata=[('macaroon', self.macaroon)])
        return response

    def connect_peer(self, address, p):
        request = ln.ConnectPeerRequest(
            addr= address,
            perm = p,
        )
        response = self.stub.ConnectPeer(request, metadata=[('macaroon', self.macaroon)])
        return response

    def fee_report(self):
        request = ln.FeeReportRequest()
        response = self.stub.FeeReport(request, metadata=[('macaroon', self.macaroon)])
        a = FeeReport2(response)
        return a #response

    def gen_seed(self, passphrase, entropy):
        request = ln.GenSeedRequest(
            aezeed_passphrase= passphrase,
            seed_entropy = entropy
        )
        response = self.walletstub.GenSeed(request)
        return response

    def get_info(self):
        request = ln.GetInfoRequest()
        response = self.stub.GetInfo(request, metadata=[('macaroon', self.macaroon)])
        return response

    def get_node_info(self, node_id):
        request = ln.NodeInfoRequest(
            pub_key=node_id
        )
        response = self.stub.GetNodeInfo(request, metadata=[('macaroon', self.macaroon)])
        return response

    def list_channels(self, active, inactive, public, private):
        request = ln.ListChannelsRequest(
            active_only = active,
            inactive_only = inactive,
            public_only = public,
            private_only = private
        )
        response = self.stub.ListChannels(request, metadata=[('macaroon', self.macaroon)])
        return response

    def new_address(self):
        request = ln.NewAddressRequest()
        response = self.stub.NewAddress(request, metadata=[('macaroon', self.macaroon)])
        return response

    def open_channel(self, sats, pubkey, amt):
        request = ln.OpenChannelRequest(
            sat_per_byte = sats,
            node_pubkey_string = pubkey,
            local_funding_amount = amt
        )
        response = self.stub.OpenChannel(request, metadata=[('macaroon', self.macaroon)])
        return response

    def subscribe_channel_balance(self):
        request = ln.ChannelBackupSubscription()
        response = self.stub.SubscribeChannelBackups(request, metadata=[('macaroon', self.macaroon)])
        return response

    def utxos(self):
        request = ln.ListUnspentRequest()
        response = self.stub.ListUnspent(request, metadata=[('macaroon', self.macaroon)])
        return response

    def wallet_balance(self):
        request = ln.WalletBalanceRequest()
        response = self.stub.WalletBalance(request, metadata=[('macaroon', self.macaroon)])
        return response




class FeeReport2(FeeReportResponse):

    def __init__(self, other):
        super(__init__(other))

    def __str__(self):
        super(__str__(self))
        if self.day_fee_sum == 0:
            print("day_fee_sum: 0")

    def fake(self):
        pass

    


# main method used for testing
def main():
    # Due to updated ECDSA generated tls.cert we need to let gprc know that
    # we need to use that cipher suite otherwise there will be a handhsake
    # error when we communicate with the lnd rpc server.
    os.environ["GRPC_SSL_CIPHER_SUITES"] = 'HIGH+ECDSA'
    #initiate the class instance for tests
    lnd_i = Lnd()
    # balance = lnd_i.wallet_balance()
    # print(balance)
    feereport = lnd_i.fee_report()
    feereport.day_fee_sum = 3#feereport.day_fee_sum + 1 -1

    print(feereport)# or 0)
    print(feereport.day_fee_sum)


    # lnd_w = Wallet()
    # current_password = "testpassword1"
    # current_password_bytes = str.encode(current_password)
    # new_password = "testpassword2"
    # new_password_bytes = str.encode(new_password)
    # change = lnd_w.change_password(current_password_bytes, new_password_bytes)
    # print(change)
    # unlock = lnd_w.unlock(current_password_bytes)
    # print(unlock)

# Calls main method when run from command line
if __name__ == "__main__": main()
