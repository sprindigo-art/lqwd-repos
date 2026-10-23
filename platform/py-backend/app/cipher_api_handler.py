from datetime import datetime, timedelta

import requests
from requests.auth import HTTPBasicAuth
from config_client import ConfigServerClient


class CipherAPIHandler:

    def __init__(self):
        self.accessToken = None
        self.accessTokenExp = None
        self.config = ConfigServerClient.get_instance()

    def get_access_token(self):

        print("Getting access token from server for client " + config.clientId)
        res = requests.post(config.tokenURL, verify=False, data={'grant_type': 'client_credentials'},
                            auth=HTTPBasicAuth(config.clientId, config.clientSecret))
        print(res)

        if res.status_code != 200:
            return None

        print(res.url)
        print(res.content)
        print(res.text)
        self.accessTokenExp = datetime.now() + timedelta(seconds=res.json()["expires_in"])
        self.accessToken = res.json()["access_token"]

        return self.accessToken

    def get_access_token_from_cache(self):
        if self.accessToken is None or self.accessTokenExp is None:
            print("No access token in cache")
            return self.get_access_token()
        if self.accessTokenExp.date() < datetime.now():
            return self.get_access_token()

        return self.accessToken

    def decrypt(self, file_name, node_name):

        access_token = self.get_access_token_from_cache()

        if access_token is None:
            return None

        url = "{}/api/v1/decrypt".format(self.config.cipher_base_url)
        headers = {"Authorization": "Bearer {}".format(access_token)}

        res = requests.post(url,
                            verify=False, json={'requestType': 'INTERNAL_FILE_NAME_AND_NODE',
                                                'fileName': file_name,
                                                'nodeName': node_name},
                            headers=headers)

        if res.status_code != 200:
            return None

        return res.json()["data"]
