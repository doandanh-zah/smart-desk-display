#!/usr/bin/env python3
"""Read the v2 Smart Desk mode and integration API from a LAN or fixture origin."""

import argparse
import re
import sys
from urllib.parse import urlsplit

from check_http import CheckFailed, check_public_fields, has_fields, read_json, require

COUNTDOWN_FIELDS = ("kind", "state", "durationSeconds", "targetEpochSeconds", "remainingSeconds")
STATES = {"unavailable", "unsupported", "live", "stale"}
QUOTA_SOURCES = {"codex": ("codex_app_server", {"primary", "secondary"}),
                 "claude": ("claude_code_statusline", {"five_hour", "seven_day"})}


def integer(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def utc_epoch(value):
    return integer(value, 1704067200, 4102444799)


def check_countdown(value):
    has_fields(value, COUNTDOWN_FIELDS, "countdown")
    kind, state = value["kind"], value["state"]
    target, remaining = value["targetEpochSeconds"], value["remainingSeconds"]
    require(kind in ("duration", "target"), "countdown: invalid kind")
    require(state in ("idle", "running", "paused", "completed", "waiting_for_time"),
            "countdown: invalid state")
    require(integer(value["durationSeconds"], 1, 359999), "countdown: duration out of range")
    if kind == "duration":
        require(target is None and state != "waiting_for_time", "countdown duration: unexpected target")
        require(integer(remaining, 0, value["durationSeconds"]), "countdown duration: invalid remaining")
    else:
        require(utc_epoch(target) and state != "paused", "countdown target: invalid epoch or state")
        if state in ("idle", "waiting_for_time"):
            require(remaining is None, "countdown target: unexpected remaining without a running target")
        else:
            require(integer(remaining, 0, 4102444799), "countdown target: invalid remaining")
    if state == "completed":
        require(remaining == 0, "completed countdown must be at zero")


def check_source(value, array_name, cap):
    has_fields(value, ("state", "observedAt", array_name), array_name)
    require(value["state"] in STATES, f"{array_name}: invalid state")
    require(value["observedAt"] is None or utc_epoch(value["observedAt"]), f"{array_name}: invalid time")
    entries = value[array_name]
    require(isinstance(entries, list) and len(entries) <= cap, f"{array_name}: invalid entry count")
    if value["state"] in ("unavailable", "unsupported"):
        require(not entries, f"{array_name}: expected empty unavailable data")
    elif value["state"] in ("live", "stale"):
        require(utc_epoch(value["observedAt"]), f"{array_name}: live/stale data needs a timestamp")
    return entries


def check_calendar(value):
    entries = check_source(value, "events", 3)
    require(value.get("source") == "google_calendar", "calendar source mismatch")
    require(value.get("timeZone") == "Asia/Ho_Chi_Minh", "calendar timezone mismatch")
    for entry in entries:
        fields = {"title", "start", "end", "allDay"}
        has_fields(entry, fields, "calendar event")
        require(set(entry) == fields, "calendar event contains unexpected fields")
        title = entry["title"]
        require(isinstance(title, str) and 0 < len(title.encode("utf-8")) <= 64, "calendar event: invalid title")
        start, end = entry["start"], entry["end"]
        require(utc_epoch(start) and utc_epoch(end) and start < end, "calendar event: invalid time range")
        require(type(entry["allDay"]) is bool, "calendar event: invalid allDay")


def check_quota(value, provider):
    entries = check_source(value, "windows", 2)
    source, ids = QUOTA_SOURCES[provider]
    require(value.get("source") == source and value.get("kind") == "subscription",
            f"{provider}: incorrect source or kind")
    credit = value.get("credit")
    reset_credits = value.get("resetCredits")
    if credit is not None:
        has_fields(credit, ("balance", "unit", "hasCredits", "unlimited", "resetsAt"), "credit")
        require(provider == "codex" and credit["unit"] == "credits", "credit: invalid provider or unit")
        require(type(credit["hasCredits"]) is bool and type(credit["unlimited"]) is bool, "credit: invalid flags")
        balance = credit["balance"]
        require(balance is None or (isinstance(balance, str) and
                re.fullmatch(r"[0-9]{1,18}(?:\.[0-9]{1,8})?", balance)), "credit: invalid balance")
        require(credit["resetsAt"] is None or utc_epoch(credit["resetsAt"]), "credit: invalid reset time")
    if reset_credits is not None:
        has_fields(reset_credits, ("availableCount", "expiresAt"), "reset credits")
        require(provider == "codex" and integer(reset_credits["availableCount"], 0, 65535),
                "reset credits: invalid provider or count")
        require(reset_credits["expiresAt"] is None or utc_epoch(reset_credits["expiresAt"]),
                "reset credits: invalid expiration")
    if value["state"] in ("unavailable", "unsupported"):
        require(credit is None and reset_credits is None, "unavailable quota: unexpected credits")
    seen = set()
    for entry in entries:
        fields = {"id", "windowMinutes", "resetsAt", "usedPercent", "used", "limit", "unit"}
        has_fields(entry, fields, "quota window")
        require(set(entry) == fields, "quota window contains unexpected fields")
        require(entry["id"] in ids - seen, f"{provider}: invalid or duplicate quota window ID")
        seen.add(entry["id"])
        require(entry["windowMinutes"] is None or integer(entry["windowMinutes"], 1, 525600),
                "quota window: invalid duration")
        percent = entry["usedPercent"]
        require(percent is None or (type(percent) in (int, float) and 0 <= percent <= 100),
                "quota window: invalid percent")
        require(entry["resetsAt"] is None or utc_epoch(entry["resetsAt"]), "quota window: invalid reset time")
        require(all(entry[key] is None for key in ("used", "limit", "unit")),
                "quota window: unexpected absolute usage")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("origin")
    raw = parser.parse_args().origin.rstrip("/")
    origin = urlsplit(raw)
    require(origin.scheme in ("http", "https") and origin.hostname and not origin.username
            and origin.password is None and not origin.path and not origin.query and not origin.fragment,
            "expected a device origin")

    def get(path):
        value = read_json(raw + "/api/" + path, no_store=True)
        check_public_fields(value)
        return value

    status = get("status")
    require("countdown" in status, "status: missing countdown")
    check_countdown(status["countdown"])
    check_countdown(get("countdown"))
    print("PASS status and countdown schema")
    integrations = get("integrations")
    require(integrations.get("v") == 1, "integrations: expected version 1")
    has_fields(integrations, ("calendar", "quotas"), "integrations")
    has_fields(integrations["quotas"], QUOTA_SOURCES, "integrations quotas")
    check_calendar(integrations["calendar"])
    check_calendar(get("calendar"))
    print("PASS calendar schema and filtered event fields")
    for provider in ("codex", "claude"):
        check_quota(integrations["quotas"][provider], provider)
        check_quota(get("quota/" + provider), provider)
        print(f"PASS {provider} quota schema and distinct provider ID")


if __name__ == "__main__":
    try:
        main()
    except (CheckFailed, KeyError, TypeError, ValueError, OSError) as error:
        sys.exit(f"FAIL {error}")
