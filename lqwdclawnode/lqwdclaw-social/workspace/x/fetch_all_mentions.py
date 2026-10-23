import requests
import json
import sys
import os

from x_client import get_valid_tokens

TOKEN_FILE = "/opt/openclaw/workspace/x/x_tokens.json"
REPLY_LOG = "/opt/openclaw/workspace/x/x_reply.log"
API_BASE = "https://api.x.com/2"

def get_replied_ids():
    replied_ids = set()
    if os.path.exists(REPLY_LOG):
        with open(REPLY_LOG, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    data = json.loads(line.strip())
                    if "tweet_id" in data:
                        replied_ids.add(data["tweet_id"])
                except json.JSONDecodeError:
                    pass
    return replied_ids

def fetch_and_process_mentions():
    try:
        tokens = get_valid_tokens()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        
        me_resp = requests.get(f"{API_BASE}/users/me", headers=headers)
        if me_resp.status_code != 200:
            print(f"Error fetching user info: {me_resp.status_code} - {me_resp.text}")
            return
        
        user_id = me_resp.json()["data"]["id"]
        
        url = f"{API_BASE}/users/{user_id}/mentions?expansions=author_id,in_reply_to_user_id&tweet.fields=conversation_id,created_at,text,public_metrics,reply_settings&max_results=20"
        mentions_resp = requests.get(url, headers=headers)
        
        if mentions_resp.status_code != 200:
            print(f"Error fetching mentions: {mentions_resp.status_code} - {mentions_resp.text}")
            return
            
        data = mentions_resp.json()
        replied_ids = get_replied_ids()
        
        unreplied = []
        if "data" in data:
            for tweet in data["data"]:
                if tweet["id"] not in replied_ids:
                    unreplied.append(tweet)

        for t in unreplied:
            print(f"ID: {t['id']}\nText: {t['text']}\nDate: {t['created_at']}\n---")
            
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        sys.exit(1)

if __name__ == "__main__":
    fetch_and_process_mentions()
