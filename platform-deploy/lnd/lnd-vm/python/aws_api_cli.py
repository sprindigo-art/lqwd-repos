import boto3
import base64
from botocore.exceptions import ClientError

def load_secret():
    client = boto3.client('secretsmanager')
    try:
        response = client.get_secret_value(SecretId="lnd_vm_secret")
        if 'SecretString' in response:
            return response['SecretString']
        else:
            decoded_binary_secret = base64.b64decode(response['SecretBinary'])
            return decoded_binary_secret
    except ClientError as e:
        return None
