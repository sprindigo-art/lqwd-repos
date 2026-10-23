#!/usr/bin/env python3
"""
Research cache updater for LQWDClaw.
Usage:
    python3 update_cache.py <section> <json_data>
    python3 update_cache.py mempool '{"fastestFee":4,"halfHourFee":3,"hourFee":2}'
    python3 update_cache.py web_search '{"query":"Lightning Network","results":["..."]}'
    python3 update_cache.py monitoring_dashboard '{"total_btc":2648.89}'
    python3 update_cache.py node_data '{"channels":23,"capacity":"4.2 BTC"}'
    python3 update_cache.py x_search '{"tweets":[...]}'
    python3 update_cache.py moltbook_feeds '{"hot":[...]}'

Reads:
    python3 update_cache.py --read <section>
    python3 update_cache.py --read mempool
    python3 update_cache.py --read-all
    python3 update_cache.py --check <section> <max_age_seconds>
"""

import json
import sys
import time

CACHE = "/opt/openclaw/workspace/research_cache.json"


def load_cache():
    try:
        with open(CACHE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_cache(cache):
    with open(CACHE, "w") as f:
        json.dump(cache, f, indent=2)


def update_section(section, data):
    cache = load_cache()
    cache[section] = {
        "cached_at": int(time.time()),
        "data": data
    }
    save_cache(cache)
    print(json.dumps({"ok": True, "section": section, "cached_at": cache[section]["cached_at"]}))


def read_section(section):
    cache = load_cache()
    s = cache.get(section, {})
    if not s:
        print(json.dumps({"ok": False, "error": "section not found"}))
        return
    age = int(time.time()) - s.get("cached_at", 0)
    print(json.dumps({"ok": True, "section": section, "age_seconds": age, "data": s.get("data")}))


def read_all():
    cache = load_cache()
    now = int(time.time())
    summary = {}
    for k, v in cache.items():
        cached_at = v.get("cached_at", 0)
        summary[k] = {
            "age_seconds": now - cached_at if cached_at else None,
            "has_data": v.get("data") is not None
        }
    print(json.dumps(summary, indent=2))


def check_freshness(section, max_age):
    cache = load_cache()
    s = cache.get(section, {})
    cached_at = s.get("cached_at", 0)
    age = int(time.time()) - cached_at if cached_at else 999999
    is_fresh = age < max_age
    print(json.dumps({"section": section, "fresh": is_fresh, "age_seconds": age, "max_age": max_age}))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: update_cache.py <section> <json_data>")
        print("       update_cache.py --read <section>")
        print("       update_cache.py --read-all")
        print("       update_cache.py --check <section> <max_age_seconds>")
        sys.exit(1)

    if sys.argv[1] == "--read" and len(sys.argv) >= 3:
        read_section(sys.argv[2])
    elif sys.argv[1] == "--read-all":
        read_all()
    elif sys.argv[1] == "--check" and len(sys.argv) >= 4:
        check_freshness(sys.argv[2], int(sys.argv[3]))
    elif len(sys.argv) >= 3:
        section = sys.argv[1]
        try:
            data = json.loads(sys.argv[2])
        except json.JSONDecodeError:
            # Treat as plain string
            data = sys.argv[2]
        update_section(section, data)
    else:
        print("Error: need section and data arguments")
        sys.exit(1)
