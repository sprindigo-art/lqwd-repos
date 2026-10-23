import json
import requests
import sys
import argparse
from x_client import get_valid_tokens

parser = argparse.ArgumentParser()
parser.add_argument("--id", required=True)
parser.add_argument("--file", required=True)
args = parser.parse_args()

tokens = get_valid_tokens()
headers = {"Authorization": f"Bearer " + tokens["access_token"]}

with open(args.file) as f:
    reply_text = f.read().strip()

data = {
    "text": reply_text,
    "reply": {
        "in_reply_to_tweet_id": args.id
    }
}

r = requests.post("https://api.x.com/2/tweets", json=data, headers=headers)
print(json.dumps(r.json(), indent=2))
