import requests
import config
import codecs
import logging
import sys


class Readiness:

    def __init__(self):
        logs_format = '[%(asctime)s] %(levelname)s - %(message)s'
        self.logger = logging.getLogger()
        handler = logging.FileHandler('/proc/1/fd/1', mode='w')
        self.logger.setLevel(logging.DEBUG)
        formatter = logging.Formatter(logs_format)
        handler.setFormatter(formatter)
        self.logger.addHandler(handler)

    def readiness_test(self):

        health_api_response = False

        try:
            lnd_config = config.read_config("lnd.ini", "lnd")
            directory = f"/data/v3/{lnd_config['podname']}/data/chain/bitcoin/" \
                        f"{lnd_config['lndnetwork']}/readonly.macaroon"
            
            file = open(directory, "rb")
            content = file.read()
            headers = {'Grpc-Metadata-macaroon': codecs.encode(content, 'hex')}

            health_api_response = requests.get(f'https://localhost:8080/v1/getinfo', verify=False,
                                               headers=headers,
                                               timeout=5)

            self.logger.info(f"got /health response: {health_api_response.status_code}")

        except Exception as e:
            self.logger.error(f"Could not get /health response, {e}")

        if not health_api_response:
            sys.exit(1)

        self.logger.info("Readiness probe has succeeded!")
        sys.exit(0)


if __name__ == "__main__":
    readiness = Readiness()
    readiness.readiness_test()
