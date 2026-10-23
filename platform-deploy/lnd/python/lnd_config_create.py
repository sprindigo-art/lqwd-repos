import lnd
import config


# main method
def main():
    print("Creating lnd/breezlnd config file run lnd !!!")
    debug = True
    lnd_config = config.read_config("lnd.ini", "lnd")

    if debug:
        print(lnd_config)

    if lnd_config['scenario'] == 'lnd':
        lnd_object = lnd.Lnd(lnd_config, debug)
        lnd_dir = lnd_object.create_lnd_config()
        print("Lnd config created in " + lnd_dir)

    if lnd_config['scenario'] == 'breezlnd':
        lnd_object = lnd.Lnd(lnd_config, debug)
        lnd_dir = lnd_object.create_lnd_config()
        print("Breez Lnd config created in " + lnd_dir)


# Calls main method when run from command line
if __name__ == "__main__":
    main()
