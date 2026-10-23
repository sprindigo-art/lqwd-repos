import base64
import glob
import time
import os

import cipher_api_handler


class CipherService:

    def __init__(self, lnd_config, debug):

        self.lnd_config = lnd_config
        self.cipher_api_handler = cipher_api_handler.CipherAPIHandler()
        self.dev = debug
        if lnd_config is not None:
            self.dir_name = lnd_config['dir_name']

    def do_upload(self, files):
        return self.cipher_api_handler.upload_lnd_details(files, self.lnd_config)

    def upload_lnd_files_to_db(self):

        files = [{"fileName": self.dir_name + '/tls.key',
                  "encryptBeforeSave": False,
                  "fileType": "file",
                  "data": None
                  }, {"fileName": self.dir_name + '/tls.cert',
                      "encryptBeforeSave": False,
                      "fileType": "file",
                      "data": None
                      }, {"fileName": self.dir_name + '/geen_seed',
                          "encryptBeforeSave": False,
                          "fileType": "file",
                          "data": None
                          }]

        macaroon_files = []
        am = True
        i = 1
        while am:
            print("check files if exist save to DB")
            print(self.dir_name + '/data/chain/bitcoin/' + self.lnd_config['lndnetwork'] + '/admin.macaroon')
            if os.path.exists(
                    self.dir_name + '/data/chain/bitcoin/' + self.lnd_config['lndnetwork'] + '/admin.macaroon'):
                am = False
                macaroon_files = glob.glob(
                    self.dir_name + '/data/chain/bitcoin/' + self.lnd_config['lndnetwork'] + '/*.macaroon')
            else:
                print(" files not found... wait...")
                time.sleep(10)
                i = i + 1
                print(i)
                if i > 8:
                    am = False

        for file in macaroon_files:
            files.append({"fileName": file,
                          "encryptBeforeSave": True,
                          "fileType": "file",
                          "data": None
                          })

        for file in files:
            f = open(file["fileName"], "rb")
            file_string = f.read()
            content_bytes = base64.b64encode(file_string)
            base64_string = str(content_bytes, "utf-8")
            file["data"] = base64_string

        status_code = self.do_upload(files)

        if status_code != 200:
            print(f"An error occurred when uploading lnd files, status is: {status_code}")

        print("Saving to DB done")

    def get_macaroon_and_tls_cert(self, service_address):

        admin_macaroon = self.cipher_api_handler.decrypt(service_address, "admin.macaroon")
        tls_cert = self.cipher_api_handler.decrypt(service_address, "tls.cert")

        if admin_macaroon is not None:
            self.create_macaroon_or_tls_file("admin.macaroon", admin_macaroon)

        if tls_cert is not None:
            self.create_macaroon_or_tls_file("tls.cert", tls_cert)

        return admin_macaroon, tls_cert