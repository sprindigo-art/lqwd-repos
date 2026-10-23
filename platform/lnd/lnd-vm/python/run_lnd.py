import json
import os

import lnd
import config
import cipherservice

# main method
import sys
from lnd_notification import Notification


def main():
    print("Starting LND node....")

    lnd_config = config.read_config("lnd.ini", "lnd")
    debug = False

    if os.getenv("WENV") == 'development':
        debug = True
    if debug:
        print(lnd_config)

    lnd_object = lnd.Lnd(lnd_config, debug)
    lnd_config['dir_name'] = lnd_object.get_dir_name()

    success, is_new_node = lnd_object.unlock_create_wallet()

    if not success:
        print("Failed to unlock wallet")
        sys.exit(1)

    print("Node wallet created successfully")

    print("Running get info command")

    lnd_object.get_macaroon()

    lnd_info = lnd_object.get_info()

    print("info is", lnd_info)
    
    if lnd_info is not None:
        lnd_config['lnd_pubkey'] = lnd_info['identity_pubkey']

    print(f"LND node started successfully in {os.getenv('LND_NETWORK')}")

    print("Uploading LND node files to cipher service")
    cipher_password = lnd_object.get_cipher_password()

    lnd_config["cipher_password"] = cipher_password

    cipher = cipherservice.CipherService(lnd_config, debug)

    macaroon_files = cipher.upload_lnd_files_to_db()

    # Delete macaroon files in production
    if os.getenv("LND_NETWORK") == 'production' and macaroon_files is not None:
        for file in macaroon_files:
            if "readonly" not in file:
                os.remove(file)

    print("Notifying interested parties")

    send_node_emails(is_new_node, lnd_config, lnd_info)

    data = get_version_date()

    print(f"Running LND version: {data['lndVersion']}, Script version: {data['scriptVersion']}")

    lnd_object.update_lnd_version(data['lndVersion'], data['scriptVersion'])


def get_version_date():
    f = open('version.json')
    return json.load(f)


def send_node_emails(is_new_node, lnd_config, lnd_info):
    node_data = {
        "node_name": os.getenv("LND_POD_NAME"),
        "network": os.getenv("LND_NETWORK"),
        "watch": os.getenv("WATCHTOWER"),
        "owner": os.getenv("OWNER")
    }
    notification = Notification(lnd_config)
    if is_new_node:
        notification.send_node_created_email(node_data)
    else:
        notification.send_restart_email(lnd_info, node_data)


if __name__ == "__main__":
    main()
