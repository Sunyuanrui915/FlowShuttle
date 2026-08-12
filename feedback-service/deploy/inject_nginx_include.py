from __future__ import annotations

import argparse
from pathlib import Path


ANCHOR = "    error_page 404 /404.html;\n"
INCLUDE = "    include /etc/nginx/snippets/flow-shuttle-feedback-locations.conf;\n"


def inject_location_include(source: str) -> str:
    if INCLUDE in source:
        return source
    if source.count(ANCHOR) != 1:
        raise ValueError("expected exactly one HTTPS site insertion anchor")
    return source.replace(ANCHOR, f"{ANCHOR}\n{INCLUDE}", 1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    original = args.source.read_text(encoding="utf-8")
    args.destination.write_text(inject_location_include(original), encoding="utf-8")


if __name__ == "__main__":
    main()
