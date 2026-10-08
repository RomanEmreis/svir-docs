#!/usr/bin/env python3
"""Compile the Rust snippets in docs/ and skill/ against the svir crate.

Every `rust` fence on this site is meant to be a complete set of items: the
pages promise code that builds. So, unlike a site where snippets lean on
illustrative helpers, the default here is to check every block, and a block
opts out instead of in.

Docusaurus ignores unknown words in a code fence's metastring and does not
render them, so in docs/ the opt-out and the feature list live there:

    ```rust skip
    ```rust features="schemars"

`skill/` is read by a model rather than rendered, so its fences stay plain and
a block says the same with an HTML comment on the line before it:

    <!-- snippet: skip -->
    <!-- snippet: features="schemars" -->

The comment form works in docs/ too and wins over the metastring.

A block is compiled as-is, with `fn main() {}` appended when it has no `fn
main` of its own, and in test mode, so that a `#[tokio::test]` in a snippet is
checked too. Unused items are allowed: a snippet that shows one function is
still a complete crate.

Features
--------
Snippets are compiled with svir's `schemars` and `tracing` features on top of
the defaults, which is the set the skill promises. A block that names its own
`features` gets those on top of the defaults instead. Blocks that need
different feature sets are compiled in separate crates, since Cargo unifies
features across a workspace.

Usage: python3 ci/check-snippets.py [--docs-dir docs] [--keep]
Env:   SVIR_VERSION (default "0.1.5"), or SVIR_PATH to a local checkout
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FENCE = re.compile(r"^```rust([^\n]*)\n(.*?)^```", re.S | re.M)
# An optional directive on the line immediately above a fence.
DIRECTIVE = re.compile(r"<!--\s*snippet:([^>]*?)-->\s*\n\Z", re.S)
SVIR_VERSION = os.environ.get("SVIR_VERSION", "0.1.5")
SVIR_PATH = os.environ.get("SVIR_PATH")
DEFAULT_FEATURES = "schemars tracing"

HEADER = "#![allow(unused, dead_code, clippy::all)]\n"


def parse_meta(meta: str) -> tuple[bool, str | None]:
    """Return (skip, features) from a fence metastring or a directive body."""
    skip = re.search(r"(^|\s)skip(\s|$)", meta) is not None
    m = re.search(r'features="([^"]*)"', meta)
    return skip, (m.group(1) if m else None)


def directive_before(text: str, start: int) -> tuple[bool, str | None] | None:
    m = DIRECTIVE.search(text, 0, start)
    return parse_meta(m.group(1)) if m else None


def render(body: str) -> str:
    if re.search(r"^\s*(async\s+)?fn main\s*\(", body, re.M):
        return HEADER + body
    return HEADER + body + "\nfn main() {}\n"


def collect(docs_dir: Path) -> list[dict]:
    snippets = []
    for md in sorted(list(docs_dir.rglob("*.md")) + list(docs_dir.rglob("*.mdx"))):
        text = md.read_text(encoding="utf-8")
        for idx, m in enumerate(FENCE.finditer(text)):
            skip, features = parse_meta(m.group(1))
            directive = directive_before(text, m.start())
            if directive is not None:
                skip, features = directive[0], directive[1] or features
            if skip:
                continue
            line = text.count("\n", 0, m.start()) + 1
            snippets.append(
                {
                    "name": re.sub(r"[^a-z0-9_]", "_", f"{md.parent.name}_{md.stem}_{idx}".lower()),
                    "origin": f"{md}:{line}",
                    "features": DEFAULT_FEATURES if features is None else features,
                    "source": render(m.group(2)),
                }
            )
    return snippets


def svir_dependency(features: str) -> str:
    feature_list = ", ".join(f'"{f}"' for f in features.split())
    source = f'path = "{SVIR_PATH}"' if SVIR_PATH else f'version = "{SVIR_VERSION}"'
    return f"svir = {{ {source}, features = [{feature_list}] }}\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs-dir", default="docs", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the scratch crates")
    args = ap.parse_args()

    snippets = collect(args.docs_dir)
    if not snippets:
        print("no snippets to check")
        return 0

    by_features: dict[str, list[dict]] = {}
    for s in snippets:
        by_features.setdefault(s["features"], []).append(s)

    against = f"path {SVIR_PATH}" if SVIR_PATH else f"svir {SVIR_VERSION}"
    print(f"checking {len(snippets)} snippet(s) in {len(by_features)} crate(s) against {against}\n")
    root = Path(tempfile.mkdtemp(prefix="svir-snippets-"))
    failed = []

    try:
        for features, group in sorted(by_features.items()):
            crate = root / (re.sub(r"[^a-z0-9]+", "_", features) or "default")
            (crate / "src" / "bin").mkdir(parents=True)
            (crate / "Cargo.toml").write_text(
                "[package]\n"
                'name = "snippets"\n'
                'version = "0.0.0"\n'
                'edition = "2024"\n\n'
                "[dependencies]\n"
                + svir_dependency(features)
                + 'tokio = { version = "1", features = ["full"] }\n'
                'serde = { version = "1", features = ["derive"] }\n'
                'serde_json = "1"\n'
                'schemars = "1"\n'
                'bytes = "1"\n'
                'futures-core = "0.3"\n'
                'futures-util = "0.3"\n'
                'tracing = "0.1"\n'
                'tracing-subscriber = "0.3"\n\n'
                # detach from any enclosing workspace
                "[workspace]\n",
                encoding="utf-8",
            )
            for s in group:
                (crate / "src" / "bin" / f"{s['name']}.rs").write_text(
                    f"// from {s['origin']}\n{s['source']}", encoding="utf-8"
                )
                print(f"  [{features or 'default'}] {s['origin']}")

            proc = subprocess.run(
                # Test mode, so that `#[test]` functions in a snippet are
                # compiled too rather than configured away.
                ["cargo", "test", "--no-run", "--manifest-path", str(crate / "Cargo.toml")],
                capture_output=True,
                text=True,
            )
            if proc.returncode != 0:
                failed.append(features or "default")
                print(f"\n--- FAILED: features = {features or 'default'} ---")
                print(proc.stderr)
            else:
                # warnings are worth surfacing but are not a gate
                warns = [l for l in proc.stderr.splitlines() if l.startswith("warning")]
                if warns:
                    print("    (warnings)")
                    for w in warns[:10]:
                        print(f"      {w}")
    finally:
        if args.keep:
            print(f"\nscratch crates kept at {root}")
        else:
            shutil.rmtree(root, ignore_errors=True)

    if failed:
        print(f"\nFAIL - {len(failed)} crate(s) did not compile: {', '.join(failed)}")
        return 1
    print(f"\nOK - all {len(snippets)} snippet(s) compiled")
    return 0


if __name__ == "__main__":
    sys.exit(main())
