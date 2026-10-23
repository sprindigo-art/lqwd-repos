import lnd
import config
import db_checker


def main():
    debug = True
    lnd_config = config.read_config("lnd.ini", "lnd")

    if lnd_config['wenv'] == 'development':
        print(lnd_config)

    lnd_object = lnd.Lnd(lnd_config, debug)
    if lnd_object.lnd_config['podname'] != "lnd-885":
        lnd_dir = lnd_object.create_lnd_config()
        print(f"lnd.conf created in {lnd_dir}")
    else:
        print(f" This is rooting node and config file already exits in /data/v3/lnd-885 ")

    if lnd_config['use_postgres'] == '1':
        checker = db_checker.check_and_create_db(lnd_config['podname'])
        if not checker:
            exit("DB Error")


if __name__ == "__main__":
    main()
