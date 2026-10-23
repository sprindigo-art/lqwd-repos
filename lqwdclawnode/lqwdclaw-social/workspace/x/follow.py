import os
import json
import requests
import sys

TOKEN_FILE = "/opt/openclaw/workspace/x/x_tokens.json"

API_BASE = "https://api.x.com/2"

from x_client import get_valid_tokens

def get_valid_tokens():
    with open(TOKEN_FILE) as f:
        return json.load(f)

def get_user_id(headers):
    me_resp = requests.get(f"{API_BASE}/users/me", headers=headers)
    if me_resp.status_code != 200:
        print(f"Error getting user ID: {me_resp.text}")
        sys.exit(1)
    return me_resp.json()["data"]["id"]

def get_target_id(handle, headers):
    # Remove @ if present
    clean_handle = handle.lstrip('@')
    resp = requests.get(f"{API_BASE}/users/by/username/{clean_handle}", headers=headers)
    if resp.status_code != 200:
        print(f"Error resolving handle {handle}: {resp.text}")
        sys.exit(1)
        
    data = resp.json()
    if "data" not in data:
        print(f"Error: Could not find user {handle}")
        sys.exit(1)
        
    return data["data"]["id"]

def follow_user(handle):
    tokens = get_valid_tokens()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    
    my_id = get_user_id(headers)
    target_id = get_target_id(handle, headers)
    
    url = f"{API_BASE}/users/{my_id}/following"
    data = {"target_user_id": target_id}
    
    resp = requests.post(url, json=data, headers=headers)
    
    if resp.status_code == 200:
        print(json.dumps(resp.json(), indent=2))
    else:
        print(f"Error following user: {resp.status_code}")
        print(resp.text)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 follow.py <handle>")
        sys.exit(1)
        
    handle = sys.argv[1]
    follow_user(handle)