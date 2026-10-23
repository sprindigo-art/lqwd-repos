
import os

import lnd
import config
import cipherservice

def main():
    print("Starting LND node....")

    lnd_config = config.read_config("lnd.ini", "lnd")
    debug = False

    if lnd_config['wenv'] == 'development':
        debug = True
    if debug:
        print(lnd_config)

    lnd_object = lnd.Lnd(lnd_config, debug)
    lnd_config['dir_name'] = lnd_object.get_dir_name()

   
    print("Running get info command")

    lnd_object.get_macaroon()

    lnd_info = lnd_object.get_info()

    if lnd_info is not None:
        lnd_config['lnd_pubkey'] = lnd_info['identity_pubkey']

    print(f"LND node started successfully in {lnd_config['lndnetwork']}")

    print("Uploading LND node files to cipher service")
    cipher_password = lnd_object.get_cipher_password()

    lnd_config["cipher_password"] = cipher_password

    cipher = cipherservice.CipherService(lnd_config, debug)

    macaroon_files = cipher.upload_lnd_files_to_db()



if __name__ == "__main__":
    main()