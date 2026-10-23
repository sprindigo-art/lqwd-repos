import lnd
import os


# main method
def main():
    print("Creating lnd config file ...")
    debug = os.getenv("DEBUG")

    lnd_object = lnd.Lnd(debug)
    lnd_dir = lnd_object.create_lnd_config()
    print("Lnd config created in " + lnd_dir)


# Calls main method when run from command line
if __name__ == "__main__":
    main()
