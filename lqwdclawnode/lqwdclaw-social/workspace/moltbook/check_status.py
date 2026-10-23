#!/usr/bin/env python3

import os
from rich import print

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

def main():
    api_base = os.getenv("MOLTBOOK_API_BASE", "https://www.moltbook.com/api/v1")
    api_key = os.getenv("MOLTBOOK_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("MOLTBOOK_API_KEY not set")

    c = MoltbookClient(api_base=api_base, api_key=api_key)
    print(c.status())

if __name__ == "__main__":
    main()
