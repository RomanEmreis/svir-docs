#!/usr/bin/env python3
"""Check the built site for what the Docusaurus build itself lets through.

Run after `npm run build`:

1. No unparsed admonitions. A `:::note Title` that the MDX parser did not
   take as a directive is rendered as a paragraph starting with `:::`, and
   the build succeeds. (With the v4 future flags, a title goes in brackets:
   `:::note[Title]`.)
2. Every English docs page has a Russian one, with the same heading IDs, so
   that an anchor link works in both locales. Translated headings keep the
   English ID with `{/* #id */}`.
3. The code in a translation is the English code. Only the prose is
   translated; a Rust block that differs is a translation that fell behind.

Usage: python3 ci/check-site.py [--build build]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

HEADING_ID = re.compile(r'<h[2-4] class="anchor[^"]*" id=([^ >]+)')
FENCE = re.compile(r"^```rust([^\n]*)\n(.*?)^```", re.S | re.M)
LOCALES = ["ru"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", default="build", type=Path)
    args = ap.parse_args()

    problems: list[str] = []

    for page in sorted(args.build.rglob("*.html")):
        if re.search(r"<p>:::", page.read_text(encoding="utf-8")):
            problems.append(f"{page}: an admonition was not parsed (title in brackets?)")

    english = sorted((args.build / "docs").rglob("*.html"))
    for locale in LOCALES:
        for en in english:
            rel = en.relative_to(args.build)
            other = args.build / locale / rel
            if not other.is_file():
                problems.append(f"{rel}: no {locale} page")
                continue
            en_ids = HEADING_ID.findall(en.read_text(encoding="utf-8"))
            other_ids = HEADING_ID.findall(other.read_text(encoding="utf-8"))
            if en_ids != other_ids:
                missing = sorted(set(en_ids) - set(other_ids))
                extra = sorted(set(other_ids) - set(en_ids))
                problems.append(f"{locale}/{rel}: heading IDs differ; missing {missing}, extra {extra}")

        source = Path(f"i18n/{locale}/docusaurus-plugin-content-docs/current")
        for en in sorted(Path("docs").rglob("*.md")):
            other = source / en.relative_to("docs")
            if not other.is_file():
                problems.append(f"{en}: no {locale} translation")
                continue
            if FENCE.findall(en.read_text(encoding="utf-8")) != FENCE.findall(
                other.read_text(encoding="utf-8")
            ):
                problems.append(f"{other}: its Rust code differs from {en}")

    for problem in problems:
        print(problem)
    if problems:
        print(f"\nFAIL - {len(problems)} problem(s)")
        return 1
    print(f"OK - {len(english)} docs page(s) in {1 + len(LOCALES)} locale(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
