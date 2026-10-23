import rpc_pb2 as ln
import rpc_pb2_grpc as lnrpc
import grpc
import os
import codecs
import requests

cert_path = os.path.expanduser('~/.lnd/tls.cert')
cert = open(cert_path, 'rb').read()
creds = grpc.ssl_channel_credentials(cert)
channel = grpc.secure_channel('localhost:10009', creds)
stub = lnrpc.LightningStub(channel)
with open(os.path.expanduser('~/.lnd/data/chain/bitcoin/mainnet/admin.macaroon'), 'rb') as f:
    macaroon_bytes = f.read()
    macaroon = codecs.encode(macaroon_bytes, 'hex')
    request = ln.FeeReportRequest()
    response = stub.FeeReport(request, metadata=[('macaroon', macaroon)])
    print("GRPC - response\n")
    print(response)
    print("+++++++")
    print(response.day_fee_sum)
    print("+++++++\n")
    

    headers = {'Grpc-Metadata-macaroon': macaroon}
    url = "https://localhost:8080/v1/fees"
    r = requests.get(url, headers=headers, verify=cert_path)
    print("REST - response")
    print(r.json())

