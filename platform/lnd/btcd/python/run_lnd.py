import btcd
import config

# main method
def main():

    print("Starting creating config file for BTCD !!!")

    lnd_config = config.read_config("lnd.ini", "lnd")
    btcd_object = btcd.BTCD(lnd_config, True)
    btcd_object.create_bitcoind_config()

if __name__ == "__main__":
    main()
