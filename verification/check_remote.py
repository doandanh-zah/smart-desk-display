#!/usr/bin/env python3
"""Check Smart Desk remote authentication and optionally an authorized mode round trip."""

import argparse
import json
from getpass import GetPassWarning, getpass
from http.cookiejar import CookieJar
import re
import secrets
import time
import warnings
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPCookieProcessor, ProxyHandler, Request, build_opener

from check_http import CheckFailed, NoRedirect, require



class Client:
    def __init__(self, origin):
        self.origin = origin
        self.cookies = CookieJar()
        self.opener = build_opener(ProxyHandler({}), HTTPCookieProcessor(self.cookies), NoRedirect())
        self.csrf = None

    def api(self, path, status, body=None, *, origin=None, csrf=True, cookie=None):
        headers = {}
        if body is not None:
            headers["Content-Type"] = "application/json"
            headers["Origin"] = origin or self.origin
            if self.csrf and csrf:
                headers["X-CSRF-Token"] = self.csrf
        if cookie:
            headers["Cookie"] = cookie
        request = Request(self.origin + path, data=json.dumps(body).encode() if body is not None else None,
                          headers=headers)
        try:
            response = self.opener.open(request, timeout=10)
        except HTTPError as error:
            response = error
        with response:
            require(response.code == status, f"{request.get_method()} {path}: HTTP {response.code}, expected {status}")
            require(response.headers.get_content_type() == "application/json", f"{path}: expected JSON")
            require("no-store" in response.headers.get("Cache-Control", "").lower(), f"{path}: expected no-store")
            require(response.headers.get("Access-Control-Allow-Origin") is None, f"{path}: unexpected CORS header")
            return json.load(response), response.headers


def unauthenticated(client):
    require(client.api("/api/auth/session", 200)[0] == {"authenticated": False}, "anonymous session unexpected")
    client.api("/api/admin/state", 401)
    client.api("/api/admin/commands", 401, {"id": secrets.token_hex(16), "type": "display", "payload": {"mode": "clock"}})
    print("PASS anonymous session and protected admin read/write")


def login(client, password):
    data, headers = client.api("/api/auth/login", 200, {"password": password})
    require(data.get("authenticated") is True, "login did not authenticate")
    client.csrf = data.get("csrfToken")
    require(isinstance(client.csrf, str) and bool(client.csrf), "login missing CSRF token")
    cookie = headers.get("Set-Cookie", "")
    for attr in ("secure", "httponly", "samesite"):
        require(re.search(r"(?:^|;\s*)" + attr + r"(?:=|;|$)", cookie, re.I), "session cookie missing " + attr)
    require("=" in cookie.partition(";")[0], "missing session cookie value")
    require(client.api("/api/auth/session", 200)[0].get("authenticated") is True, "session cookie not recognized")
    print("PASS login, protected session cookie and session lookup")
    return cookie.partition(";")[0]


def logout(client, previous_cookie):
    require(client.api("/api/auth/logout", 200, {})[0].get("ok") is True, "logout did not succeed")
    require(client.api("/api/auth/session", 200)[0] == {"authenticated": False}, "logout did not clear browser session")
    anonymous = Client(client.origin)
    anonymous.api("/api/admin/state", 401, cookie=previous_cookie)
    print("PASS logout invalidates the previous session server-side")


def mode_command(mode):
    return {"id": secrets.token_hex(16), "type": "display", "payload": {"mode": mode}}


def send_mode(client, payload):
    command, _ = client.api("/api/admin/commands", 202, payload)
    require(command["command"]["id"] == payload["id"], "queue returned another command ID")
    deadline = time.monotonic() + 110
    while time.monotonic() < deadline:
        result, _ = client.api("/api/admin/commands/" + payload["id"], 200)
        current = result["command"]
        if current["state"] == "applied":
            require(current["ack"]["id"] == payload["id"] and current["ack"]["result"] == "applied",
                    "ACK does not match the command")
            print(f"PASS command {payload['id']} applied for mode {payload['payload']['mode']}")
            return current
        require(current["state"] == "queued", f"command {payload['id']} ended in {current['state']}")
        time.sleep(2)
    raise CheckFailed(f"command {payload['id']} did not ACK")


def round_trip(client):
    state = client.api("/api/admin/state", 200)[0]
    require(state["connection"] == "online", "device must be online for a command round trip")
    require(state["status"]["pomodoro"]["state"] != "running", "defer QA while Pomodoro is running")
    require(not state["config"]["rotation"]["enabled"], "defer QA while auto-rotation is active")
    original = state["status"]["mode"]
    require(state["config"]["startupMode"] == original, "current and startup mode differ")
    current_command = state.get("command")
    require(not current_command or current_command["state"] != "queued", "another command is pending")
    test_mode = "clock" if original != "clock" else "github"
    timer_before = state["status"]["pomodoro"]
    test = mode_command(test_mode)
    try:
        send_mode(client, test)
        wait_for_mode(client, test_mode)
    finally:
        state = client.api("/api/admin/state", 200)[0]
        latest = state.get("command")
        if latest and latest["id"] == test["id"]:
            require(latest["state"] != "queued",
                    "the QA command may still be queued; verify its terminal state before restoring")
            if state["status"]["mode"] == test_mode and state["config"]["startupMode"] == test_mode:
                send_mode(client, mode_command(original))
                wait_for_mode(client, original)
        elif state["status"]["mode"] == test_mode:
            raise CheckFailed("another command intervened; verify the current mode before restoring")
    require(client.api("/api/admin/state", 200)[0]["status"]["pomodoro"] == timer_before,
            "timer state changed during QA")


def wait_for_mode(client, mode):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        state = client.api("/api/admin/state", 200)[0]
        if state["status"]["mode"] == mode and state["config"]["startupMode"] == mode:
            print(f"PASS device snapshot and startup mode report {mode}")
            return
        time.sleep(2)
    raise CheckFailed(f"snapshot did not report mode {mode}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("origin")
    parser.add_argument("--expect-unconfigured", action="store_true", help="verify fail-closed setup state")
    parser.add_argument("--login", action="store_true", help="read password interactively and test login/logout")
    parser.add_argument("--wrong-password", action="store_true", help="one rejected login attempt")
    parser.add_argument("--round-trip", action="store_true", help="enqueue a mode change, then restore the original mode")
    args = parser.parse_args()
    origin = args.origin.rstrip("/")
    parsed = urlsplit(origin)
    require(parsed.scheme == "https" and parsed.hostname and not parsed.username and parsed.password is None
            and not parsed.path and not parsed.query and not parsed.fragment, "expected canonical HTTPS origin")
    require(not args.round_trip or args.login, "round trip requires --login")
    client = Client(origin)
    if args.expect_unconfigured:
        require(not (args.login or args.wrong_password), "setup probe does not attempt login")
        for path in ("/api/auth/session", "/api/admin/state"):
            data, _ = client.api(path, 503)
            require(data.get("error", {}).get("code") == "setup_required", f"{path}: expected setup_required")
        print("PASS public API fails closed before setup")
        return
    unauthenticated(client)
    if args.wrong_password:
        data, _ = client.api("/api/auth/login", 401, {"password": secrets.token_urlsafe(32)})
        require(data.get("error", {}).get("code") == "invalid_credentials", "wrong password response is unexpected")
        print("PASS one wrong-password attempt rejected")
    if args.login:
        with warnings.catch_warnings():
            warnings.simplefilter("error", GetPassWarning)
            try:
                password = getpass("Admin password: ")
            except GetPassWarning as error:
                raise CheckFailed("an interactive terminal with hidden input is required") from error
        previous_cookie = login(client, password)
        del password
        try:
            client.api("/api/admin/state", 200)
            data, _ = client.api("/api/auth/logout", 403, {}, origin="https://fixture.invalid")
            require(data.get("ok") is False, "foreign-origin mutation was not rejected")
            data, _ = client.api("/api/auth/logout", 403, {}, csrf=False)
            require(data.get("ok") is False, "mutation without CSRF was not rejected")
            print("PASS origin and CSRF checks")
            if args.round_trip:
                round_trip(client)
        finally:
            logout(client, previous_cookie)


if __name__ == "__main__":
    try:
        main()
    except (CheckFailed, OSError, ValueError, KeyError, TypeError) as error:
        raise SystemExit(f"FAIL {error}")
