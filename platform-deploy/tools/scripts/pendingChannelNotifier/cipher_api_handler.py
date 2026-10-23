from datetime import datetime, timedelta

import requests
from requests.auth import HTTPBasicAuth
import os


class CipherAPIHandler:

    def __init__(self):
        self.accessToken = None
        self.accessTokenExp = None
        self.tokenURL = os.getenv("TOKEN_URL")
        self.clientId = os.getenv("CLIENT_ID")
        self.clientSecret = os.getenv("CLIENT_SECRET")
        self.cipherServiceURL = os.getenv("CIPHER_URL")
        self.dlaServiceURL = os.getenv("DLA_BASE_URL")

    def get_access_token(self):

        res = requests.post(self.tokenURL, verify=False, data={'grant_type': 'client_credentials'},
                            auth=HTTPBasicAuth(self.clientId, self.clientSecret))

        if res.status_code != 200:
            print(res.content)
            print(res.url)
            print(res.json())
            return None

        self.accessTokenExp = datetime.now() + timedelta(seconds=res.json()["expires_in"])
        self.accessToken = res.json()["access_token"]

        return self.accessToken

    def get_access_token_from_cache(self):
        if self.accessToken is None or self.accessTokenExp is None:
            return self.get_access_token()
        if self.accessTokenExp.date() < datetime.now():
            return self.get_access_token()

        print("retrieved access token successfully")
        return self.accessToken

    def decrypt_macaroon(self, file_name, node_name):

        access_token = self.get_access_token_from_cache()

        if access_token is None:
            return None

        url = "{}/api/v1/decrypt".format(self.cipherServiceURL)
        headers = {"Authorization": "Bearer {}".format(access_token)}

        res = requests.post(url,
                            verify=False, json={'requestType': 'INTERNAL_FILE_NAME_AND_NODE',
                                                'fileName': file_name,
                                                'nodeName': node_name},
                            headers=headers)

        print(f"decrypt response status: {res.status_code}")

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

        print(f"upload response status: {res.status_code}")
        return res.status_code

    def get_cipher_seed_details(self, node_name):

        access_token = self.get_access_token_from_cache()

        if access_token is None:
            return None

        url = "{}/kubernetes/lnd_node/get_seed_details/{}".format(self.dlaServiceURL, node_name)
        headers = {"Authorization": "Bearer {}".format(access_token)}

        print(access_token)
        res = requests.get(url,
                           verify=False,
                           headers=headers)

        print(f"decrypt response status: {res.content}")

        if res.status_code != 200:
            return None, None

        return res.json()["data"]["cipherSeedCommaSeperated"], res.json()["data"]["passphrase"]