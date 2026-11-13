#!/usr/bin/env python3
"""Check the Smart Desk HTTP interfaces from a Mac using Python's standard library."""

import argparse
from datetime import date, datetime
from html.parser import HTMLParser
import ipaddress
import json
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


MODES = {"github", "clock", "stats", "pomodoro", "message", "countdown", "solana"}
LEGACY_FIXTURE_MODES = ("github", "clock", "stats", "pomodoro", "message")
MAX_BODY = 1_000_000


class CheckFailed(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.entries = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("src"):
            self.entries.append(("JavaScript", attrs["src"]))
        elif tag == "link" and "stylesheet" in attrs.get("rel", "").lower().split():
            if attrs.get("href"):
                self.entries.append(("CSS", attrs["href"]))


def require(condition, message):
    if not condition:
        raise CheckFailed(message)


def fetch(url, expected_status=200, body=None):
    payload = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if payload is not None else {}
    request = Request(url, data=payload, headers=headers)
    path = urlsplit(url).path or "/"
    try:
        response = build_opener(NoRedirect()).open(request, timeout=8)
    except HTTPError as error:
        response = error
    except URLError as error:
        raise CheckFailed(f"{request.get_method()} {path}: {error.reason}") from error

    with response:
        require(response.code == expected_status,
                f"{request.get_method()} {path}: HTTP {response.code}, expected {expected_status}")
        content = response.read(MAX_BODY + 1)
        require(len(content) <= MAX_BODY, f"{path}: response exceeds check limit")
        return response.headers, content


def read_json(url, expected_status=200, body=None, no_store=False):
    headers, content = fetch(url, expected_status, body)
    path = urlsplit(url).path
    require(headers.get_content_type() == "application/json", f"{path}: expected JSON content type")
    if no_store:
        require("no-store" in headers.get("Cache-Control", "").lower(), f"{path}: expected no-store")
    try:
        result = json.loads(content)
    except (ValueError, UnicodeError) as error:
        raise CheckFailed(f"{path}: invalid JSON") from error
    require(isinstance(result, dict), f"{path}: expected JSON object")
    return result


def has_fields(obj, fields, label):
    require(isinstance(obj, dict), f"{label}: expected object")
    missing = set(fields) - obj.keys()
    require(not missing, f"{label}: missing {', '.join(sorted(missing))}")


def check_ip(value):
    if value is not None:
        require(isinstance(value, str), "wifi.ip: expected IP string or null")
        ipaddress.ip_address(value)


def check_timer(timer):
    has_fields(timer, ("phase", "state", "remainingSeconds", "focusMinutes", "breakMinutes"),
               "pomodoro")
    require(timer["phase"] in ("focus", "break"), "pomodoro.phase: invalid phase")
    require(timer["state"] in ("idle", "running", "paused", "completed"), "pomodoro.state: invalid")
    for name in ("focusMinutes", "breakMinutes"):
        require(type(timer[name]) is int and timer[name] > 0, f"pomodoro.{name}: invalid duration")
    require(type(timer["remainingSeconds"]) is int and timer["remainingSeconds"] >= 0,
            "pomodoro.remainingSeconds: invalid countdown")


def check_status(status):
    has_fields(status, ("deviceName", "mode", "wifi", "uptimeSeconds", "firmwareVersion", "time",
                        "github", "pomodoro"), "status")
    require(status["mode"] in MODES, "status.mode: unknown mode")
    require(type(status["uptimeSeconds"]) is int and status["uptimeSeconds"] >= 0,
            "status.uptimeSeconds: invalid")
    wifi = status["wifi"]
    has_fields(wifi, ("connected", "ip", "hostname", "provisioning"), "wifi")
    require(type(wifi["connected"]) is bool and type(wifi["provisioning"]) is bool,
            "wifi: expected boolean flags")
    check_ip(wifi["ip"])
    require(wifi["hostname"] is None or isinstance(wifi["hostname"], str),
            "wifi.hostname: expected string or null")
    if wifi["connected"]:
        require(wifi["ip"] is not None, "wifi.ip: expected address while connected")
    clock = status["time"]
    has_fields(clock, ("synced", "epochSeconds", "timezone", "utcOffsetMinutes"), "time")
    require(clock["timezone"] == "Asia/Ho_Chi_Minh" and clock["utcOffsetMinutes"] == 420,
            "time: expected Asia/Ho_Chi_Minh (UTC+7)")
    require(type(clock["synced"]) is bool, "time.synced: expected boolean")
    if clock["synced"]:
        require(type(clock["epochSeconds"]) is int and clock["epochSeconds"] > 0,
                "time.epochSeconds: expected positive epoch when synced")
    else:
        require(clock["epochSeconds"] is None, "time.epochSeconds: expected null before sync")
    check_github_status(status["github"])
    check_timer(status["pomodoro"])


def check_message(message):
    has_fields(message, ("text", "alignment", "color", "size"), "message")
    require(message["alignment"] in ("left", "center", "right"), "message.alignment: invalid")
    require(isinstance(message["color"], str) and re.fullmatch("#[0-9a-fA-F]{6}", message["color"]),
            "message.color: expected RGB hex")
    require(type(message["size"]) is int and 1 <= message["size"] <= 4, "message.size: invalid")


def check_config(config):
    has_fields(config, ("deviceName", "githubUsername", "githubProxyUrl", "theme", "startupMode",
                        "clockShowSeconds", "rotation", "message"), "config")
    require(config["startupMode"] in MODES, "config.startupMode: unknown mode")
    require(config["theme"] in ("dark", "light"), "config.theme: unknown theme")
    require(type(config["clockShowSeconds"]) is bool, "config.clockShowSeconds: expected boolean")
    rotation = config["rotation"]
    has_fields(rotation, ("enabled", "intervalSeconds", "modes"), "rotation")
    require(type(rotation["enabled"]) is bool, "rotation.enabled: expected boolean")
    require(type(rotation["intervalSeconds"]) is int and 30 <= rotation["intervalSeconds"] <= 600,
            "rotation.intervalSeconds: out of range")
    modes = rotation["modes"]
    require(isinstance(modes, list) and all(mode in MODES for mode in modes),
            "rotation.modes: invalid mode list")
    require((2 if rotation["enabled"] else 1) <= len(set(modes)) == len(modes),
            "rotation.modes: too few or duplicate modes")
    check_message(config["message"])


def check_public_fields(value):
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = re.sub("[^a-z]", "", key.lower())
            require(not any(term in normalized for term in ("password", "token", "secret", "credential")),
                    "public response includes a credential-shaped key")
            check_public_fields(child)
    elif isinstance(value, list):
        for child in value:
            check_public_fields(child)


def check_levels(levels):
    require(isinstance(levels, str) and re.fullmatch("[0-4]{364}", levels),
            "levels: expected 364 ASCII digits in 0–4")


def check_github_status(github):
    has_fields(github, ("state", "lastSync", "error"), "GitHub status")
    state = github["state"]
    require(state in ("demo", "loading", "live", "stale", "error"), "GitHub: unknown state")
    require(github["error"] is None or isinstance(github["error"], str),
            "GitHub: expected string or null error")
    if state in ("live", "stale"):
        last_sync = github["lastSync"]
        require(isinstance(last_sync, str) and last_sync.endswith("Z"),
                "GitHub: expected UTC lastSync on live/stale data")
        datetime.fromisoformat(last_sync[:-1] + "+00:00")
    else:
        require(github["lastSync"] is None, "GitHub: expected no timestamp before sync")


def check_github(github):
    check_github_status(github)
    has_fields(github, ("username", "totalContributions", "currentStreak", "repositoryCount",
                        "levels"), "GitHub")
    if github["state"] in ("demo", "live", "stale"):
        check_levels(github["levels"])
        for name in ("totalContributions", "currentStreak"):
            require(type(github[name]) is int and github[name] >= 0, f"GitHub.{name}: invalid")
    else:
        require(github["levels"] == "" and github["totalContributions"] is None
                and github["currentStreak"] is None, "GitHub: expected empty data before sync")
    repos = github["repositoryCount"]
    require(repos is None or (type(repos) is int and repos >= 0), "GitHub.repositoryCount: invalid")


def check_assets(base):
    headers, html = fetch(base + "/")
    require(headers.get_content_type() == "text/html", "dashboard: expected HTML")
    assets = Assets()
    assets.feed(html.decode("utf-8"))
    require({kind for kind, _ in assets.entries} == {"JavaScript", "CSS"},
            "dashboard: expected JS and CSS assets in the HTML")
    for kind, href in assets.entries:
        url = urljoin(base + "/", href)
        target = urlsplit(url)
        origin = urlsplit(base)
        require((target.scheme, target.netloc) == (origin.scheme, origin.netloc),
                f"dashboard: {kind} asset points off-device")
        headers, content = fetch(url)
        accepted = ("text/css",) if kind == "CSS" else ("text/javascript", "application/javascript")
        require(headers.get_content_type() in accepted and bool(content.strip()),
                f"dashboard: invalid {kind} response for {target.path}")
    print(f"PASS dashboard index and {len(assets.entries)} same-origin assets")


def check_device(base, exercise_fixture):
    for path, checker in (("/api/status", check_status), ("/api/config", check_config),
                          ("/api/github", check_github)):
        result = read_json(base + path, no_store=True)
        check_public_fields(result)
        checker(result)
        print(f"PASS {path}")
    check_assets(base)
    if exercise_fixture:
        headers, _ = fetch(base + "/api/status")
        require(headers.get("X-SmartDesk-Fixture") == "1", "write target lacks fixture header")
        exercise_device_fixture(base)


def exercise_device_fixture(base):
    def post(path, payload):
        result = read_json(base + path, body=payload, no_store=True)
        require(result.get("ok") is True, f"{path}: expected ok=true")
        return result

    for mode in LEGACY_FIXTURE_MODES:
        require(post("/api/display", {"mode": mode}).get("mode") == mode,
                "/api/display: response mode mismatch")
        require(read_json(base + "/api/status").get("mode") == mode,
                "/api/status: mode did not change")
    config = post("/api/config", {"rotation": {"enabled": False}, "theme": "light"})
    require(config["config"]["theme"] == "light", "/api/config: theme did not change")
    message = {"text": "Fixture verification", "alignment": "right", "color": "#ABCDEF", "size": 3}
    require(post("/api/message", message).get("message") == message, "/api/message: save mismatch")
    require(read_json(base + "/api/config")["message"] == message, "/api/config: message mismatch")
    for action, state in (("reset", "idle"), ("start", "running"), ("pause", "paused"),
                          ("start", "running"), ("reset", "idle")):
        timer = post("/api/pomodoro", {"action": action}).get("pomodoro")
        check_timer(timer)
        require(timer["state"] == state, f"/api/pomodoro: {action} did not transition to {state}")
    error = read_json(base + "/api/display", 400, body={"mode": "invalid"})
    require(error.get("ok") is False, "/api/display: expected validation error")
    require(read_json(base + "/api/status")["mode"] == "message",
            "/api/display: invalid request changed mode")
    print("PASS fixture-only mode, config, message, timer and input validation commands")


def check_proxy(url, username):
    response = read_json(url + "?" + urlencode({"username": username}))
    check_public_fields(response)
    has_fields(response, ("v", "username", "start", "asOf", "levels", "total", "streak", "repos"),
               "proxy")
    require(type(response["v"]) is int and response["v"] == 1, "proxy: unsupported version")
    require(isinstance(response["username"], str) and response["username"].lower() == username.lower(),
            "proxy: returned username differs")
    for name in ("start", "asOf"):
        require(isinstance(response[name], str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", response[name]),
                f"proxy.{name}: expected YYYY-MM-DD")
    start = date.fromisoformat(response["start"])
    as_of = date.fromisoformat(response["asOf"])
    require(start.weekday() == 6 and 357 <= (as_of - start).days <= 363,
            "proxy: expected first Sunday and asOf in week 52")
    check_levels(response["levels"])
    elapsed = (as_of - start).days + 1
    require(set(response["levels"][elapsed:]) <= {"0"}, "proxy: future days must be empty")
    total, streak, repos = response["total"], response["streak"], response["repos"]
    require(type(total) is int and total >= 0, "proxy.total: expected non-negative integer")
    require(type(streak) is int and 0 <= streak <= elapsed, "proxy.streak: out of range")
    active_days = response["levels"][:elapsed]
    if active_days[-1] == "0":
        active_days = active_days[:-1]
    expected_streak = len(active_days.rsplit("0", 1)[-1])
    require(streak == expected_streak, "proxy.streak: differs from consecutive contribution days")
    require(repos is None or (type(repos) is int and repos >= 0), "proxy.repos: invalid count")
    print("PASS proxy 52×7 schema and UTC calendar bounds")
    error = read_json(url + "?" + urlencode({"username": "!invalid"}), 400)
    require(error.get("error") == "invalid_username", "proxy: expected invalid_username")
    print("PASS proxy invalid username validation")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    device = commands.add_parser("device")
    device.add_argument("origin")
    device.add_argument("--exercise-fixture", action="store_true",
                        help="send writes to a local disposable fixture")
    proxy = commands.add_parser("proxy")
    proxy.add_argument("endpoint")
    proxy.add_argument("--username", default="octocat")
    proxy.add_argument("--fixture-http", action="store_true", help="allow HTTP on a loopback fixture")
    args = parser.parse_args()
    try:
        raw_url = args.origin if args.command == "device" else args.endpoint
        url = urlsplit(raw_url)
        require(url.scheme in ("http", "https") and url.hostname and not url.username
                and url.password is None and not url.query and not url.fragment,
                "use an HTTP(S) URL without credentials, query or fragment")
        loopback = url.hostname in ("localhost", "127.0.0.1", "::1")
        if args.command == "device":
            require(url.path in ("", "/"), "device URL must be an origin")
            require(not args.exercise_fixture or loopback, "fixture writes require a loopback URL")
            check_device(raw_url.rstrip("/"), args.exercise_fixture)
        else:
            require(url.scheme == "https" or (args.fixture_http and loopback), "proxy must use HTTPS")
            check_proxy(raw_url, args.username)
    except (CheckFailed, KeyError, TypeError, ValueError, OSError) as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
