#!/usr/local/bin/python3
import sys, os

sys.path.insert(0, os.path.abspath(os.path.join('../../scripts/', '.')))

from datetime import datetime, timedelta
import requests
from requests.auth import HTTPBasicAuth
from config.config import ConfigLND as Config


class CipherAPIHandler:

    def __init__(self):
        self.accessToken = None
        self.accessTokenExp = None
        self.tokenURL = Config.tokenURL
        self.clientId = Config.clientId
        self.clientSecret = Config.clientSecret
        self.cipherServiceURL = Config.cipherServiceURL

    def get_access_token(self):

        res = requests.post(self.tokenURL, verify=False, data={'grant_type': 'client_credentials'},
                            auth=HTTPBasicAuth(self.clientId, self.clientSecret))

        if res.status_code != 200:
            return None

        self.accessTokenExp = datetime.now() + timedelta(seconds=res.json()["expires_in"])
        self.accessToken = res.json()["access_token"]

        return self.accessToken

    def get_access_token_from_cache(self):
        if self.accessToken is None or self.accessTokenExp is None:
            return self.get_access_token()
        if self.accessTokenExp.date() < datetime.now():
            return self.get_access_token()

        return self.accessToken

    def decrypt_macaroon(self, lnd_id):

        access_token = self.get_access_token_from_cache()

        if access_token is None:
            return None

        url = "{}/api/v1/decrypt".format(self.cipherServiceURL)
        headers = {"Authorization": "Bearer {}".format(access_token)}
        json = {'requestType': 'INTERNAL', 'fileId': lnd_id}
        print(url, headers, json)

        res = requests.post(url, verify=False, json={'requestType': 'INTERNAL_FILE_ID', 'fileId': lnd_id},
                            headers=headers)
        print(res, res.json())
        if res.status_code != 200:
            return None

        return res.json()["data"]

    def upload_lnd_details(self, files, lnd_config):

        access_token = self.get_access_token_from_cache()

        if access_token is None:
            return None

        url = "{}/api/v1/savefile".format(self.cipherServiceURL)
        headers = {"Authorization": "Bearer {}".format(access_token)}

        res = requests.post(url,
                            verify=False, json={'files': files,
                                                'nodeName': lnd_config['podname'],
                                                'network': lnd_config['lndnetwork'],
                                                'domain': lnd_config['rpchost'] + "." + lnd_config['podname'],
                                                'pubkey': lnd_config['lnd_pubkey'],
                                                'watchtower': lnd_config['watchtower'],
                                                'rpchost': lnd_config['rpchost'],
                                                'status': 'active',
                                                'rpcpass': lnd_config['rpcpass'],
                                                'rpcuser': lnd_config['rpcuser'],
                                                'key': ''},
                            headers=headers)

        print(res.text)
        return res.status_code
