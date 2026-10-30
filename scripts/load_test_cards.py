#!/usr/bin/env python3
"""
load_test_cards.py
---
python scripts/load_test_cards.py --count 100000 --base-url http://localhost:3000
---

Load-testing helper: ensures a "sample" pod exists, then creates a
bunch of test cards inside it via the same HTTP API the frontend uses
(POST /api/admin/cards), so each card gets a real, unique slug/title
and a sensible position -- exactly like a card created through the UI.

Requires the server to be running (e.g. `make server`).

Usage:
    python scripts/load_test_cards.py [--count 100000] [--base-url http://localhost:3000]

Environment variables (fall back to aspen.env's own defaults):
    ASPEN_ADMIN_EMAIL     (default: admin@mail.internal)
    ASPEN_ADMIN_PASSWORD  (default: password)
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE_URL = "http://localhost:3000"
DEFAULT_POT_NAME = "sample"
DEFAULT_CARD_COUNT = 100000


def api_request(base_url, method, path, token=None, body=None, params=None):
    """Sends one JSON API request and returns the decoded response body."""
    url = base_url + path
    if params:
        url += "?" + urllib.parse.urlencode(params)

    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", token)

    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} failed ({err.code}): {detail}") from err


def authenticate(base_url, email, password):
    """Logs in as a superuser and returns the auth token."""
    result = api_request(
        base_url,
        "POST",
        "/api/collections/_superusers/auth-with-password",
        body={"identity": email, "password": password},
    )
    return result["token"]


def find_or_create_pod(base_url, token, name):
    """Returns the id of the pod with `name`, creating it if missing."""
    result = api_request(
        base_url,
        "GET",
        "/api/collections/pods/records",
        token=token,
        params={"filter": f'name="{name}"'},
    )
    if result["items"]:
        return result["items"][0]["id"]

    created = api_request(
        base_url,
        "POST",
        "/api/collections/pods/records",
        token=token,
        body={
            "name": name,
            "title": name.capitalize(),
            "done": False,
            "position": 0,
        },
    )
    return created["id"]


def create_cards(base_url, token, pod_id, count):
    """Creates `count` test cards in `pod_id` via the admin cards API,
    so each one gets a real, unique slug/title and position -- the
    same logic a card created through the UI goes through."""
    for i in range(1, count + 1):
        api_request(
            base_url,
            "POST",
            "/api/admin/cards",
            token=token,
            body={"pod": pod_id, "titleCandidate": f"Test Card {i}"},
        )
        if i % 100 == 0 or i == count:
            print(f"created {i}/{count} cards")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--pod-name", default=DEFAULT_POT_NAME)
    parser.add_argument("--count", type=int, default=DEFAULT_CARD_COUNT)
    parser.add_argument(
        "--email", default=os.environ.get("ASPEN_ADMIN_EMAIL", "admin@mail.internal")
    )
    parser.add_argument(
        "--password", default=os.environ.get("ASPEN_ADMIN_PASSWORD", "password")
    )
    args = parser.parse_args()

    token = authenticate(args.base_url, args.email, args.password)
    pod_id = find_or_create_pod(args.base_url, token, args.pod_name)
    print(f"using pod '{args.pod_name}' ({pod_id})")

    create_cards(args.base_url, token, pod_id, args.count)


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as err:
        print(err, file=sys.stderr)
        sys.exit(1)
