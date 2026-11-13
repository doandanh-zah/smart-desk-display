#!/usr/bin/env python3
"""Verify the Smart Desk Countdown and Calendar APIs and retired quota routes."""

import argparse
import sys
from urllib.parse import urlsplit

from check_http import CheckFailed, check_public_fields, has_fields, read_json, require

COUNTDOWN_FIELDS = ("kind", "state", "durationSeconds", "targetEpochSeconds", "remainingSeconds")
STATES = {"unavailable", "unsupported", "live", "stale"}


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
    has_fields(integrations, ("calendar",), "integrations")
    require("quotas" not in integrations, "integrations: retired quotas projection is present")
    check_calendar(integrations["calendar"])
    check_calendar(get("calendar"))
    print("PASS calendar schema and filtered event fields")
    for provider in ("codex", "claude"):
        removed = read_json(raw + "/api/quota/" + provider, expected_status=404, no_store=True)
        require(removed.get("ok") is False, f"{provider}: expected error for retired route")
    print("PASS retired quota routes return 404")



if __name__ == "__main__":
    try:
        main()
    except (CheckFailed, KeyError, TypeError, ValueError, OSError) as error:
        sys.exit(f"FAIL {error}")
