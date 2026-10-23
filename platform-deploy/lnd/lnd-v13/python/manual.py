import json
import os

import lnd

import cipherservice

# main method
import sys
from lnd_notification import Notification

def main():

    print("Starting LND node....")


    debug = os.getenv("DEBUG")

    lnd_object = lnd.Lnd(debug)


    print("Uploading LND node files to cipher service")

    cipher_password = lnd_object.get_cipher_password()

    lnd_config = lnd_object.get_lnd_config()

    print("Running get macaroon file")
    lnd_object.get_macaroon()

    print("Running get info command")
    lnd_info = lnd_object.get_info()

    if lnd_info is not None:
        lnd_pubkey = lnd_info['identity_pubkey']

    lnd_config["lnd_pubkey"] = lnd_pubkey

    lnd_config["cipher_password"] = cipher_password

    cipher = cipherservice.CipherService(lnd_config, debug)

    macaroon_files = cipher.upload_lnd_files_to_db()


if __name__ == "__main__":
    main()