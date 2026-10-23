import os

import lnd
import config
import db_checker


def main():
    debug = True
    lnd_config = config.read_config("lnd.ini", "lnd")

    if os.getenv("WENV") == 'development':
        print(lnd_config)

    lnd_object = lnd.Lnd(lnd_config, debug)
    lnd_dir = lnd_object.create_lnd_config()

    print(f"lnd.conf created in {lnd_dir}")

    if os.getenv("USE_POSTGRES") == '1':
        checker = db_checker.check_and_create_db(os.getenv("LND_POD_NAME"))
        if not checker:
            exit("DB Error")


if __name__ == "__main__":
    main()
