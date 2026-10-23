#!/usr/bin/env python3

import json
import os
import sys

# Add the directory containing MoltbookClient to the Python path
moltbook_client_path = "/opt/openclaw/workspace/moltbook/"
if moltbook_client_path not in sys.path:
    sys.path.insert(0, moltbook_client_path)

from client import MoltbookClient

# Load environment variables from the sourced script
moltbook_env_script = "/opt/openclaw/workspace/moltbook/moltbook_env.sh"
if [ -f "$moltbook_env_script" ]; then
    source "$moltbook_env_script"
else
    echo "Warning: $moltbook_env_script not found. Relying on existing environment variables."
fi

MOLTBOOK_API_BASE = os.getenv("MOLTBOOK_API_BASE", "https://www.moltbook.com/api/v1")

output_file = "/opt/openclaw/workspace/feed.json"

try:
    client = MoltbookClient(api_base=MOLTBOOK_API_BASE)
    # Defaulting to 'hot' sort as seen in client.py's get_feed alias
    feed_data = client.feed(sort="hot", limit=50) # Increased limit for more data

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(feed_data, f, indent=2)
    print(f"Successfully refreshed {output_file}")

except Exception as e:
    print(f"Error refreshing {output_file}: {e}")
    sys.exit(1)
