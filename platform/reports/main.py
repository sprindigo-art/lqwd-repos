import config


def main():
 lnd_config = config.read_config("database.ini", "postgresql")
 print(lnd_config)

 

 # Calls main method when run from command line
if __name__ == "__main__":
    main()
