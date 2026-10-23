#!/usr/bin/env python3

import base64
import hashlib
import json
import os
import secrets
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

import requests


CLIENT_ID = os.environ.get("X_CLIENT_ID", "").strip()
CLIENT_SECRET = os.environ.get("X_CLIENT_SECRET", "").strip()

REDIRECT_URI = os.environ.get(
    "X_REDIRECT_URI",
    "http://127.0.0.1:8080/callback"
).strip()

SCOPES = [
    "tweet.read",
    "tweet.write",
    "users.read",
    "follows.write",
    "offline.access"
]

AUTH_URL = "https://x.com/i/oauth2/authorize"
TOKEN_URL = "https://api.x.com/2/oauth2/token"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def generate_pkce():
    verifier = b64url(secrets.token_bytes(32))
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    return verifier, challenge


class CallbackHandler(BaseHTTPRequestHandler):
    code = None
    state = None
    error = None

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if "error" in params:
            CallbackHandler.error = params["error"][0]

        if "code" in params:
            CallbackHandler.code = params["code"][0]

        if "state" in params:
            CallbackHandler.state = params["state"][0]

        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()

        self.wfile.write(
            b"Authorization received. You can close this window."
        )


def start_callback_server(port):
    server = HTTPServer(("127.0.0.1", port), CallbackHandler)
    server.handle_request()


def build_auth_url(state, challenge):

    params = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": " ".join(SCOPES),
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256"
    }

    return AUTH_URL + "?" + urllib.parse.urlencode(params)


def exchange_token(code, verifier):

    data = {
        "grant_type": "authorization_code",
        "redirect_uri": REDIRECT_URI,
        "code": code,
        "code_verifier": verifier
    }

    headers = {
        "Content-Type": "application/x-www-form-urlencoded"
    }

    auth = None

    if CLIENT_SECRET:
        auth = (CLIENT_ID, CLIENT_SECRET)
    else:
        data["client_id"] = CLIENT_ID

    response = requests.post(
        TOKEN_URL,
        data=data,
        headers=headers,
        auth=auth,
        timeout=30
    )

    if response.status_code != 200:
        print("\nTOKEN EXCHANGE FAILED")
        print("Status:", response.status_code)
        print("Response body:", response.text)
        response.raise_for_status()

    return response.json()


def redact(value):
    if not value:
        return "NONE"

    if len(value) < 12:
        return "***"

    return value[:6] + "..." + value[-4:]


def main():

    verifier, challenge = generate_pkce()
    state = b64url(secrets.token_bytes(16))

    parsed = urllib.parse.urlparse(REDIRECT_URI)
    port = parsed.port or 80

    thread = threading.Thread(
        target=start_callback_server,
        args=(port,),
        daemon=True
    )

    thread.start()

    url = build_auth_url(state, challenge)

    print("\nOpen this URL in your browser and approve access:\n")
    print(url)
    print("\nWaiting for callback:", REDIRECT_URI)

    for _ in range(600):

        if CallbackHandler.error:
            raise SystemExit("OAuth error: " + CallbackHandler.error)

        if CallbackHandler.code:
            break

        time.sleep(0.25)

    if not CallbackHandler.code:
        raise SystemExit("Timeout waiting for OAuth callback")

    if CallbackHandler.state != state:
        raise SystemExit("State mismatch. Possible CSRF attempt.")

    tokens = exchange_token(CallbackHandler.code, verifier)

    output_path = "/opt/openclaw/workspace/x/x_tokens.json"

    with open(output_path, "w") as f:
        json.dump(tokens, f, indent=2)

    os.chmod(output_path, 0o600)

    print("\nTokens saved to:", output_path)

    print("\nAccess token:", redact(tokens.get("access_token")))
    print("Refresh token:", redact(tokens.get("refresh_token")))
    print("Expires in:", tokens.get("expires_in"))


if __name__ == "__main__":
    main()
