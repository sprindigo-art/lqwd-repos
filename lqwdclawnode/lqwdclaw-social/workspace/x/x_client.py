import os
import json
import requests
import sys
import time

TOKEN_FILE = "/opt/openclaw/workspace/x/x_tokens.json"
TOKEN_URL = "https://api.x.com/2/oauth2/token"
API_BASE = "https://api.x.com/2"

CLIENT_ID = os.environ.get("X_CLIENT_ID", "").strip()
CLIENT_SECRET = os.environ.get("X_CLIENT_SECRET", "").strip()

# Refresh a little early to avoid race conditions
REFRESH_SKEW_SECONDS = 120


def load_tokens():
    with open(TOKEN_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_tokens(tokens):
    with open(TOKEN_FILE, "w", encoding="utf-8") as f:
        json.dump(tokens, f, indent=2)


def normalize_tokens(tokens):
    now = int(time.time())

    if "obtained_at" not in tokens:
        tokens["obtained_at"] = now

    if "expires_at" not in tokens:
        expires_in = int(tokens.get("expires_in", 0) or 0)
        if expires_in > 0:
            tokens["expires_at"] = int(tokens["obtained_at"]) + expires_in

    return tokens


def needs_refresh(tokens):
    expires_at = tokens.get("expires_at")
    if not expires_at:
        return "refresh_token" in tokens and bool(tokens["refresh_token"])

    return int(time.time()) >= int(expires_at) - REFRESH_SKEW_SECONDS


def refresh_tokens(tokens):
    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        return tokens

    if not CLIENT_ID or not CLIENT_SECRET:
        raise RuntimeError("Missing X_CLIENT_ID or X_CLIENT_SECRET in environment")

    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }

    response = requests.post(
        TOKEN_URL,
        data=data,
        auth=(CLIENT_ID, CLIENT_SECRET),
        timeout=30,
    )

    if response.status_code != 200:
        raise RuntimeError(
            f"Token refresh failed: {response.status_code} {response.text}"
        )

    new_tokens = response.json()

    # Merge instead of replacing everything
    merged = dict(tokens)
    merged.update(new_tokens)

    # Preserve refresh token if X does not rotate it in this response
    if "refresh_token" not in new_tokens and refresh_token:
        merged["refresh_token"] = refresh_token

    merged["obtained_at"] = int(time.time())
    merged = normalize_tokens(merged)

    save_tokens(merged)
    return merged


def get_valid_tokens():
    tokens = load_tokens()
    tokens = normalize_tokens(tokens)

    if needs_refresh(tokens):
        tokens = refresh_tokens(tokens)

    return tokens



def post_tweet(text, reply_to=None):
    tokens = get_valid_tokens()

    payload = {"text": text}
    if reply_to:
        payload["reply"] = {"in_reply_to_tweet_id": str(reply_to)}

    response = requests.post(
        f"{API_BASE}/tweets",
        json=payload,
        headers={
            "Authorization": f"Bearer {tokens['access_token']}",
            "Content-Type": "application/json",
        },
        timeout=30,
    )

    try:
        body = response.json()
    except Exception:
        body = {"raw": response.text}

    return {
        "status_code": response.status_code,
        "body": body,
    }

def search_tweets(query, max_results=10):
    tokens = get_valid_tokens()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    # Ensure query is properly URL-encoded
    encoded_query = requests.utils.quote(query)

    # Construct the URL for searching recent tweets
    # tweet.fields can be expanded based on requirements, starting with basic ones
    url = f"{API_BASE}/tweets/search/recent?query={encoded_query}&max_results={max_results}&tweet.fields=created_at,author_id,public_metrics,conversation_id,reply_settings"

    response = requests.get(url, headers=headers, timeout=30)

    if response.status_code != 200:
        print(f"Error searching tweets: {response.status_code}")
        print(response.text)
        sys.exit(1)
        
    return response.json()
