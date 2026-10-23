import json

import requests
from confluent_kafka import avro
from requests import Session
from retrying import retry

def make_api_call(url, headers, debug, insecure, timeout, cert_path=None):
    if debug:
        print("URL: ", url)
        print("HEADERS: ", headers)
    response = data = None
    session = Session()
    session.headers.update(headers)

    try:
        if insecure:
            verify = False
            response = session.get(url, verify=verify, timeout=timeout)
        else:
            verify = cert_path
            response = session.get(url, verify=verify, timeout=timeout)
        if response:
            data = json.loads(response.text)
        if debug:
            if data:
                print(" DATA from LND: \n", data)

    except Exception as e:
        print(e)
    session.close()
    return response


# get avro schema
@retry(wait_exponential_multiplier=1000, wait_exponential_max=10000)
def get_schema(url, debug=False):
    avro_schema = None
    schema = None
    try:
        schema = requests.get(url)
    except Exception as e:
        if debug:
            print(f"EXCEPTION:  {e}")

    if schema and schema.json()['schema']:
        schema_string = schema.json()['schema']
        avro_schema = avro.loads(schema_string)
    else:
        print(f"ERROR: Schema at %s NOT FOUND!" % url)
        raise Exception(f"ERROR: Schema at %s NOT FOUND!" % url)
    
    return avro_schema
