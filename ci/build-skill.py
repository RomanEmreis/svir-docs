#!/usr/bin/env python3
"""Package skill/svir/ as static/svir-skill.zip for the docs site.

Runs from npm's `prebuild` / `prestart` hooks, so `npm run build` (locally and
on the deploy workflow) always ships an archive matching the tree in git. The
zip itself is generated, not committed -- see .gitignore.

Entries are written in sorted order with a fixed timestamp so that rebuilding
an unchanged tree produces a byte-identical archive.

Usage: python3 ci/build-skill.py [--source skill/svir] [--out static/svir-skill.zip]
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path

# Any DOS timestamp works; a fixed one is what makes the output reproducible.
FIXED_DATE = (2026, 1, 1, 0, 0, 0)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="skill/svir", type=Path)
    ap.add_argument("--out", default="static/svir-skill.zip", type=Path)
    args = ap.parse_args()

    if not (args.source / "SKILL.md").is_file():
        print(f"error: {args.source}/SKILL.md not found", file=sys.stderr)
        return 1

    # Hidden files (.DS_Store and the like) are the machine's, not the skill's.
    files = sorted(
        p
        for p in args.source.rglob("*")
        if p.is_file() and not any(part.startswith(".") for part in p.relative_to(args.source).parts)
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(args.out, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            # Keep the `svir/` prefix: the directory name has to match the
            # skill's `name`, so unzipping must produce `svir/`, not the files
            # loose in whatever directory the user was standing in.
            arcname = Path(args.source.name) / path.relative_to(args.source)
            info = zipfile.ZipInfo(arcname.as_posix(), date_time=FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, path.read_bytes())

    size_kb = args.out.stat().st_size / 1024
    print(f"{args.out} - {len(files)} file(s), {size_kb:.1f} KiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
