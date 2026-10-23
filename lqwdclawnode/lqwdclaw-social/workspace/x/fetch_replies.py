import requests
import json
import sys
import os
import time
from datetime import datetime

from x_client import get_valid_tokens

# Define constants
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
                    # Silently ignore lines that are not valid JSON
                    pass
    return replied_ids

def fetch_and_process_mentions():
    try:
        tokens = get_valid_tokens()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        
        # Get user info to find our own user ID
        me_resp = requests.get(f"{API_BASE}/users/me", headers=headers)
        if me_resp.status_code != 200:
            print(f"Error fetching user info: {me_resp.status_code} - {me_resp.text}")
            return
        
        user_id = me_resp.json()["data"]["id"]
        
        # Fetch mentions, including author and reply-to info for context
        url = f"{API_BASE}/users/{user_id}/mentions?expansions=author_id,in_reply_to_user_id&tweet.fields=conversation_id,created_at,text,public_metrics,reply_settings"
        mentions_resp = requests.get(url, headers=headers)
        
        if mentions_resp.status_code != 200:
            print(f"Error fetching mentions: {mentions_resp.status_code} - {mentions_resp.text}")
            return
            
        data = mentions_resp.json()
        replied_ids = get_replied_ids()
        
        eligible_replies = []
        if "data" in data:
            for tweet in data["data"]:
                # Filter out tweets we've already replied to or are older than 48 hours
                # Also filter out non-technical or non-relevant content based on REPLY_ELIGIBILITY_RULES
                if tweet["id"] not in replied_ids and (time.time() - get_timestamp_from_twitter_time(tweet["created_at"])) < (48 * 60 * 60):
                    # Basic filtering based on REPLY_ELIGIBILITY_RULES (can be expanded)
                    text_lower = tweet["text"].lower()
                    if (
                        "lightning" in text_lower or "bitcoin" in text_lower or "node" in text_lower or "lsp" in text_lower or "liquidity" in text_lower or "routing" in text_lower or "protocol" in text_lower or "agent" in text_lower or "transaction" in text_lower
                    ) and not (
                        "meme" in text_lower or "trolling" in text_lower or "gm" in text_lower or "scam" in text_lower or "$ " in text_lower or "http" in text_lower and "moltbook.com" not in text_lower and "agents-relay.com" not in text_lower and "lokuli.com" not in text_lower
                    ):
                        eligible_replies.append(tweet)

            data["data"] = eligible_replies
            data["meta"]["result_count"] = len(eligible_replies)

        print(json.dumps(data, indent=2))

    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        sys.exit(1)

def get_timestamp_from_twitter_time(twitter_time_str):
    # Twitter time is typically ISO 8601 format, e.g., '2026-03-05T16:41:36.000Z'
    # We need to parse it into a Unix timestamp for comparison
    try:
        # Remove the timezone info and parse
        # Added a check for '.' to split correctly, in case it's not always present
        if '.' in twitter_time_str:
            dt_object = datetime.strptime(twitter_time_str.split('.')[0], '%Y-%m-%dT%H:%M:%S')
        else:
            dt_object = datetime.strptime(twitter_time_str.split('Z')[0], '%Y-%m-%dT%H:%M:%S')
        return int(dt_object.timestamp())
    except ValueError:
        # Fallback if parsing fails, return a very old timestamp to ensure it's filtered out
        return 0 

if __name__ == "__main__":
    fetch_and_process_mentions()