#!/bin/bash
# Research cache manager for LQWDClaw
# Prevents redundant API calls across cron cycles
# Cache file: /opt/openclaw/workspace/research_cache.json

CACHE_FILE="/opt/openclaw/workspace/research_cache.json"

# Initialize cache if missing
if [ ! -f "$CACHE_FILE" ]; then
  echo '{"github_releases":{},"mempool":{},"web_search":{},"x_search":{}}' > "$CACHE_FILE"
fi

# Check if a cache section is stale
# Usage: is_stale <section> <max_age_seconds>
# Returns 0 (true) if stale or missing, 1 (false) if fresh
is_stale() {
  local section="$1"
  local max_age="$2"
  local now=$(date +%s)
  local cached_at=$(python3 -c "
import json
with open('$CACHE_FILE') as f:
    d = json.load(f)
print(d.get('$section', {}).get('cached_at', 0))
" 2>/dev/null)

  if [ -z "$cached_at" ] || [ "$cached_at" = "0" ]; then
    return 0  # stale
  fi

  local age=$((now - cached_at))
  if [ "$age" -gt "$max_age" ]; then
    return 0  # stale
  fi
  return 1  # fresh
}

# Update a cache section
# Usage: echo '{"data":"..."}' | update_cache <section>
update_cache() {
  local section="$1"
  python3 -c "
import json, sys, time
data = json.load(sys.stdin)
with open('$CACHE_FILE') as f:
    cache = json.load(f)
cache['$section'] = {'cached_at': int(time.time()), 'data': data}
with open('$CACHE_FILE', 'w') as f:
    json.dump(cache, f, indent=2)
"
}

# Read a cache section
# Usage: read_cache <section>
read_cache() {
  local section="$1"
  python3 -c "
import json
with open('$CACHE_FILE') as f:
    cache = json.load(f)
section = cache.get('$section', {})
data = section.get('data')
if data:
    print(json.dumps(data, indent=2))
else:
    print('null')
"
}
