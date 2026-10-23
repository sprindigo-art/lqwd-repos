from datetime import datetime, timedelta

import requests
from requests.auth import HTTPBasicAuth
import os


class CipherAPIHandler:

    def __init__(self):
        self.accessToken = None
        self.accessTokenExp = None
        self.oauthBaseUrl = os.getenv("OAUTH_BASE_URL")
        self.clientId = os.getenv("CLIENT_ID")
        self.clientSecret = os.getenv("CLIENT_SECRET")
        self.cipherServiceURL = os.getenv("CIPHER_BASE_URL")

    def get_access_token(self):
        print("Debugging getting access token for cipher service")
        print(f"Debugging  oauth url : {self.oauthBaseUrl}")
        print(f"Debugging  oauth client id : {self.clientId}")
        print(f"Debugging  oauth client secret : {self.clientSecret}")

        res = requests.post("{}/oauth/token".format(self.oauthBaseUrl),
                            verify=False, data={'grant_type': 'client_credentials'},
                             auth=HTTPBasicAuth(self.clientId, self.clientSecret))

        print(f"access token response {res}")
        if res.status_code != 200:
            return None

        self.accessTokenExp = datetime.now() + timedelta(seconds=res.json()["expires_in"])
        self.accessToken = res.json()["access_token"]

        return self.accessToken

    def get_access_token_from_cache(self):
        if self.accessToken is None or self.accessTokenExp is None:
            return self.get_access_token()
        print(f"retrieved access token successfully {self.accessTokenExp}")
        if self.accessTokenExp < datetime.now():
            return self.get_access_token()

        print("retrieved access token successfully")
        return self.accessToken

    def decrypt_macaroon(self, file_name, node_name):

        access_token = self.get_access_token_from_cache()

        if access_token is None:
            return None

        print("Debugging sending decrypt request to cipher service")
        print(f"Debugging  cipher url : {self.cipherServiceURL}")

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

    def decrypt(self, encrypted_data, encrypt_method):

        access_token = self.get_access_token_from_cache()

        if access_token is None:
            return None

        print("Debugging sending decrypt request to cipher service")
        print(f"Debugging  cipher url : {self.cipherServiceURL}")

        url = "{}/api/v1/decrypt".format(self.cipherServiceURL)

        headers = {"Authorization": "Bearer {}".format(access_token)}

        res = requests.post(url,
                            verify=False, json={'requestType': 'EXTERNAL',
                                                'input': encrypted_data,
                                                'method': encrypt_method},
                            headers=headers)

        print(f"decrypt response status: {res.json()}")

        if res.status_code != 200:
            return None

        return res.json()["data"]

    def upload_lnd_details(self, files, lnd_config):

        access_token = self.get_access_token_from_cache()

        if access_token is None:
            return None

        print("Debugging sending upload request to cipher service")
        print(f"Debugging  cipher url : {self.cipherServiceURL}")

        url = "{}/api/v1/savefile".format(self.cipherServiceURL)
        headers = {"Authorization": "Bearer {}".format(access_token)}
        upload_file_request = {'files': files,
                               'nodeName': lnd_config['podname'],
                               'network': lnd_config['lndnetwork'],
                               'domain': lnd_config['rpchost'] + "." + lnd_config['podname'],
                               'pubkey': lnd_config['lnd_pubkey'],
                               'watchtower': lnd_config['watchtower'],
                               'rpchost': lnd_config['rpchost'],
                               'status': 'active',
                               'rpcpass': lnd_config['rpcpass'],
                               'rpcuser': lnd_config['rpcuser'],
                               'key': ''
                               }

        if lnd_config["cipher_password"] is not None:
            upload_file_request['password'] = lnd_config["cipher_password"]

        res = requests.post(url,
                            verify=False, json=upload_file_request,
                            headers=headers)

        print(f"upload response is: {res.text}")
        return res.status_code

    def check_node_status(self, node_name):
        access_token = self.get_access_token_from_cache()

        if access_token is None:
            return None

        url = "{}/lndnode/getinfo".format(self.oauthBaseUrl)
        headers = {"Authorization": "Bearer {}".format(access_token)}

        res = requests.post(url,
                            verify=False, data={'lndNodeName': node_name},
                            headers=headers)
        data = res.json()
        return data["status"]

    def update_node_status(self, status, node_name):

        access_token = self.get_access_token_from_cache()

        if access_token is None:
            return None

        url = "{}/lndnode/update".format(self.oauthBaseUrl)
        headers = {"Content-type": "application/json","Authorization": "Bearer {}".format(access_token)}

        res = requests.post(url,
                            verify=False, json={'lndNodeName': node_name,
                                                'status': status},
                            headers=headers)

        print(f"upload response status: {res.status_code}")
        return res.status_code
