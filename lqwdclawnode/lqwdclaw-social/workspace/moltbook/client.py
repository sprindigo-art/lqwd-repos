import json
import os
from typing import Any, Dict, Optional

import requests


class MoltbookClient:
    """
    Minimal Moltbook API client.
    Auth: Bearer API key to https://www.moltbook.com/api/v1/*
    """

    def __init__(
        self,
        api_base: str,
        api_key: Optional[str] = None,
        credentials_path: Optional[str] = None,
        timeout_s: int = 30,
    ):
        self.api_base = api_base.rstrip("/")
        self.timeout_s = timeout_s

        # Priority:
        # 1) explicit api_key arg
        # 2) env var MOLTBOOK_API_KEY
        # 3) credentials_path JSON file (default /data/moltbook_credentials.json)
        self.api_key = api_key or os.getenv("MOLTBOOK_API_KEY", "").strip()

        if not self.api_key:
            cred_path = credentials_path or os.getenv(
                "MOLTBOOK_CREDENTIALS_PATH", "/data/moltbook_credentials.json"
            )
            self.api_key = self._load_api_key_from_file(cred_path)

        if not self.api_key:
            raise ValueError(
                "Missing Moltbook API key. Set MOLTBOOK_API_KEY or provide credentials_path "
                "with a JSON containing {\"api_key\": \"moltbook_xxx\"}."
            )

        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            }
        )

    def _load_api_key_from_file(self, path: str) -> str:
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            key = (data.get("api_key") or "").strip()
            return key
        except FileNotFoundError:
            return ""
        except Exception:
            # If the file exists but is malformed, fail closed (no guessing)
            return ""

    def _url(self, path: str) -> str:
        if not path.startswith("/"):
            path = "/" + path
        return f"{self.api_base}{path}"

    # ---- Agent endpoints ----

    def register_agent(self, name: str, description: str) -> Dict[str, Any]:
        r = self.session.post(
            self._url("/agents/register"),
            json={"name": name, "description": description},
            timeout=self.timeout_s,
        )
        r.raise_for_status()
        return r.json()

    def status(self) -> Dict[str, Any]:
        r = self.session.get(self._url("/agents/status"), timeout=self.timeout_s)
        r.raise_for_status()
        return r.json()

    def me(self) -> Dict[str, Any]:
        r = self.session.get(self._url("/agents/me"), timeout=self.timeout_s)
        r.raise_for_status()
        return r.json()

    # ---- Home / feed ----

    def home(self) -> Dict[str, Any]:
        r = self.session.get(self._url("/home"), timeout=self.timeout_s)
        r.raise_for_status()
        return r.json()

    def feed(self, limit: int = 25, sort: str = "hot", filter_: Optional[str] = None) -> Dict[str, Any]:
        params: Dict[str, Any] = {"limit": int(limit)}
        if sort:
            params["sort"] = sort
        if filter_:
            params["filter"] = filter_
        r = self.session.get(self._url("/feed"), params=params, timeout=self.timeout_s)
        r.raise_for_status()
        return r.json()

    def post_detail(self, post_id: str) -> Dict[str, Any]:
        r = self.session.get(self._url(f"/posts/{post_id}"), timeout=self.timeout_s)
        r.raise_for_status()
        return r.json()

    def post_comments(self, post_id: str, sort: str = "best") -> Dict[str, Any]:
        r = self.session.get(
            self._url(f"/posts/{post_id}/comments"),
            params={"sort": sort},
            timeout=self.timeout_s,
        ) 
        r.raise_for_status()
        return r.json()

    # ---- Actions ----

    def create_post(self, submolt_name: str, title: str, content: str = "", url: str = "", type_: str = "text") -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "submolt_name": submolt_name,
            "title": title,
            "type": type_,
        }
        if content:
            payload["content"] = content
        if url:
            payload["url"] = url
        r = self.session.post(self._url("/posts"), json=payload, timeout=self.timeout_s)
        r.raise_for_status()
        return r.json()

    def create_comment(self, post_id: str, content: str) -> Dict[str, Any]:
        r = self.session.post(
            self._url(f"/posts/{post_id}/comments"),
            json={"content": content},
            timeout=self.timeout_s,
        )
        r.raise_for_status()
        return r.json()

    def upvote_post(self, post_id: str) -> Dict[str, Any]:
        # Some platforms use /upvote or /vote. We'll implement /upvote first;
        # if Moltbook differs, we'll adjust after the first error response.
        r = self.session.post(self._url(f"/posts/{post_id}/upvote"), timeout=self.timeout_s)
        r.raise_for_status()
        return r.json()

    def follow_agent(self, agent_name: str) -> Dict[str, Any]:
        r = self.session.post(self._url(f"/agents/{agent_name}/follow"), timeout=self.timeout_s)
        r.raise_for_status()
        return r.json()

    # ---- Backwards-compat aliases (cycle.py compatibility) ----

    def get_feed(self, sort: str = "hot", limit: int = 25, filter_: Optional[str] = None):
        resp = self.feed(limit=limit, sort=sort, filter_=filter_)
        # Normalize to list[post]
        if isinstance(resp, list):
            return resp
        if isinstance(resp, dict):
            if isinstance(resp.get("posts"), list):
                return resp["posts"]
            if isinstance(resp.get("data"), list):
                return resp["data"]
        return []

    def get_home(self) -> Dict[str, Any]:
        return self.home()
