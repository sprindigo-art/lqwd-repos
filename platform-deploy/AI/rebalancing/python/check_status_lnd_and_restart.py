import grpc
import os
import schedule
import subprocess
import time
from lndgrpc import lnrpc

# LND gRPC server connection details
lnd_host = 'localhost:10009'
tls_cert_path = os.path.expanduser('~/.lnd/tls.cert')
macaroon_path = os.path.expanduser('~/.lnd/data/chain/bitcoin/mainnet/admin.macaroon')
wallet_password = 'your_wallet_password'

def get_lnd_node_status():
    # Establish a secure connection with LND gRPC server
    cert = open(tls_cert_path, 'rb').read()
    ssl_creds = grpc.ssl_channel_credentials(cert)
    channel = grpc.secure_channel(lnd_host, ssl_creds)

    # Initialize the LND gRPC stub
    macaroon = open(macaroon_path, 'rb').read()
    macaroon_creds = grpc.metadata_call_credentials(
        lambda context, callback: callback([('macaroon', macaroon)], None)
    )
    channel_creds = grpc.composite_channel_credentials(ssl_creds, macaroon_creds)
    stub = lnrpc.LightningStub(channel)

    # Get the node info
    try:
        response = stub.GetInfo(lnrpc.GetInfoRequest())
        return True, response.synced_to_chain, response.block_height, response.num_active_channels
    except grpc.RpcError as e:
        return False, None, None, None

def check_lnd_node_status():
    # Call the function to retrieve the LND node status
    is_running, synced, block_height, active_channels = get_lnd_node_status()

    if is_running:
        # Print the status
        print(f"Synced to Chain: {synced}")
        print(f"Block Height: {block_height}")
        print(f"Number of Active Channels: {active_channels}")
    else:
        # Start LND
        print("LND node is not running. Starting LND...")
        subprocess.run(['lnd'])

        # Unlock LND wallet
        print("Unlocking LND wallet...")
        subprocess.run(['lncli', 'unlock'], input=wallet_password, text=True)

# Schedule the function to run every 10 minutes
schedule.every(10).minutes.do(check_lnd_node_status)

# Run the scheduler indefinitely
while True:
    schedule.run_pending()
    time.sleep(1)
