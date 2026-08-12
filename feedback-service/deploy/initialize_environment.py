from __future__ import annotations

import argparse
import os
import secrets
from pathlib import Path


PLACEHOLDER = "replace-with-a-random-server-only-value"


def initialize_environment(template: Path, destination: Path) -> bool:
    if destination.exists():
        return False
    template_text = template.read_text(encoding="utf-8")
    if template_text.count(PLACEHOLDER) != 1:
        raise ValueError("environment template must contain exactly one token placeholder")
    content = template_text.replace(PLACEHOLDER, secrets.token_hex(32), 1)
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as destination_file:
            destination_file.write(content)
            destination_file.flush()
            os.fsync(destination_file.fileno())
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("template", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    created = initialize_environment(args.template, args.destination)
    print("environment_created" if created else "environment_preserved")


if __name__ == "__main__":
    main()
