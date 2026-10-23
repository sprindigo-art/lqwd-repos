import lnd
import config
import cipherservice


# main method
def main():
    print("Start run lnd !!!")

    lnd_config = config.read_config("lnd.ini", "lnd")
    lnd_object = None
    save_to_db = False
    debug = False
    if  lnd_config['wenv'] == 'development':
        debug = True
    if debug:
        print(lnd_config)
    if debug:
        print(lnd_config)
    if lnd_config['scenario'] == 'lnd' or lnd_config['scenario'] == 'breezlnd':
        lnd_object = lnd.Lnd(lnd_config, debug)
        lnd_config['dir_name'] = lnd_object.get_dir_name()

        lnd_object.unlock_create_wallet()
        print("wallet created")

        print("Get Info command")
        lnd_object.get_macaroon()

        lnd_info = lnd_object.get_info()
        
        lnd_config['lnd_pubkey'] = lnd_info['identity_pubkey']

        save_to_db = True
        if debug:
            print("lnd node started in regtest scenario")

    if save_to_db:
        cipher_password = lnd_object.get_cipher_password()
        lnd_config["cipher_password"] = cipher_password
        cipher = cipherservice.CipherService(lnd_config, debug)
        cipher.upload_lnd_files_to_db()

    if save_to_db:
        print("need to getinfo from lndnode")


# Calls main method when run from command line
if __name__ == "__main__":
    main()
