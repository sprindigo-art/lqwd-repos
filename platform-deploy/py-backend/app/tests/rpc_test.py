import codecs, json
from requests import Session
from requests.exceptions import ConnectionError, Timeout, TooManyRedirects

# parameters = { 'verify':'False'}

url = 'https://192.168.123.252:8080/v1/getinfo'
macaroon = codecs.encode(open('/Users/albert/.lnd/admin.macaroon', 'rb').read(), 'hex')
headers = {'Grpc-Metadata-macaroon': macaroon}

# r = requests.get(url, headers=headers, verify=False)
# print(r.json())


session = Session()
session.headers.update(headers)

try:
    response = session.get(url, verify=False)
    data = json.loads(response.text)
    print(response)
    print("=======================================================")
    print(data)

except (ConnectionError, Timeout, TooManyRedirects) as e:
    print(e)

session.close()
