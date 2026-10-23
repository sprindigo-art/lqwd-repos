from datetime import datetime, timedelta
import requests
from requests.auth import HTTPBasicAuth
import os, base64


def get_access_token():
    tokenURL = os.environ.get('TOKEN_URL')
    clientId = os.environ.get('OAUTH_CLIENT_ID')
    clientSecret = os.environ.get('OAUTH_CLIENT_PASSWORD')
    res = requests.post(tokenURL, verify=False, data={'grant_type': 'client_credentials'},
                            auth=HTTPBasicAuth(clientId, clientSecret))
    if res.status_code != 200:
        return None
    return res.json()["access_token"]


def decrypt_macaroon(access_token, file_name):
    cipherServiceURL = os.environ.get('CIPHER_BASE_URL')
    node_name = os.environ.get('LND_PODNAME')
    headers = {"Authorization": "Bearer {}".format(access_token)}
    res = requests.post(cipherServiceURL, verify=False, json={'requestType': 'INTERNAL_FILE_NAME_AND_NODE',
                                                'fileName': file_name,
                                                'nodeName': node_name},
                                                 headers=headers)
    if res.status_code != 200:
        return None
    return res.json()["data"]


def saveLndFile(file_path, data):
    with open(file_path, "wb") as fh:
        fh.write(base64.decodebytes(bytes(data, 'utf-8')))


def main():
    access_token = get_access_token()
    lndPodName = os.environ.get('LND_PODNAME')
    lit_dir="/data/v3/{}/lndplus".format(lndPodName)
    if access_token != None:
        admin_macaroon = decrypt_macaroon(access_token, "admin.macaroon")
        if admin_macaroon is not None:
            saveLndFile("{}/{}".format(lit_dir, "admin.macaroon"), admin_macaroon)
        tls_cert = decrypt_macaroon(access_token, "tls.cert")
        if tls_cert is not None:
            saveLndFile("{}/{}".format(lit_dir, "tls.cert"), tls_cert)


if __name__ == "__main__":
    main()