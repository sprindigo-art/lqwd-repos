import lnd
import config
import cipherservice
import time


# main method
def main():
    print("Start run lnd !!!")

    lnd_config = config.read_config("lnd.ini", "lnd")
    save_to_db = False
    debug = False
    if  lnd_config['wenv'] == 'development':
        debug = True
    if debug:
        print(lnd_config)
    if lnd_config['scenario'] == 'lnd':
        lnd_object = lnd.Lnd(lnd_config, debug)
        lnd_config['dir_name'] = lnd_object.get_dir_name()

        wallet_ready = lnd_object.unlock_create_wallet()
        if wallet_ready:
            print("wallet created")
            print("Wait 5 secs for rpc service to start before running Get Info command")
            time.sleep(5)

            lnd_object.get_macaroon()
            lnd_info = lnd_object.get_info()
            lnd_config['lnd_pubkey'] = lnd_info['identity_pubkey']

            save_to_db = True
            if debug:
                print("lnd node started")
        else:
            print("could not get wallet ready")

    if save_to_db:
        cipher = cipherservice.CipherService(lnd_config, debug)
        cipher.upload_lnd_files_to_db()

# Calls main method when run from command line
if __name__ == "__main__":
    main()
