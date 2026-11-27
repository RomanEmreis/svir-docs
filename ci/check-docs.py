#!/usr/bin/env python3
"""Check the rules in CONTRIBUTING.md that a script can check.

1. One svir version. Every `svir` dependency written on the site or in the
   skill, the version CI compiles the snippets against, the default of
   `check-snippets.py`, the skill's `svir-version`, the version the Agent
   Skill page shows, the release the intro page describes, and the current
   release named on the Migration page agree with `SVIR_VERSION` in
   `.github/workflows/ci.yml`. A release bump that missed a file fails here.

2. No version history in the guides. They describe the current release; what
   changed and when lives on the Migration page and the Agent Skill page. A
   "Since 0.1.4" or "Upgrading from" in a guide fails here, in either locale.
   The skill in `skill/` is exempt: its notes help an agent upgrade old code.

3. Both locales have the same pages. A page added to `docs/` without its
   Russian translation (or the other way round) fails here.

Usage: python3 ci/check-docs.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EN = ROOT / "docs"
RU = ROOT / "i18n" / "ru" / "docusaurus-plugin-content-docs" / "current"
SKILL = ROOT / "skill"
CI_YML = ROOT / ".github" / "workflows" / "ci.yml"
SNIPPETS = ROOT / "ci" / "check-snippets.py"

# Pages whose subject is version history. Rule 2 skips them, and rule 1 skips
# them too, since an upgrade note may quote the version being left behind.
HISTORY_PAGES = {
    EN / "reference" / "migration.md",
    RU / "reference" / "migration.md",
    EN / "agent-skill.md",
    RU / "agent-skill.md",
    SKILL / "svir" / "references" / "migration.md",
}

# `svir = "0.2"` and `svir = { version = "0.2", ... }`
DEPENDENCY = re.compile(r'^\s*(svir)\s*=\s*(?:\{[^}\n]*?version\s*=\s*)?"([^"]+)"', re.M)

HISTORY = [
    re.compile(p, re.I)
    for p in (
        r"\bsince (?:svir |v|version )?0\.\d+",
        r"\bupgrading from\b",
        r"\b(?:before|prior to|as of|until|starting (?:with|from)) (?:svir |v|version )?0\.\d+",
        r"\b(?:added|changed|removed|deprecated|introduced) in (?:svir |v|version )?0\.\d+",
        r"\b(?:in|on|from|for) (?:svir )?0\.\d+\.\d+",
        r"\blocked on 0\.\d+",
        r"(?<![\w.])(?:в|на|для) (?:svir )?0\.\d+\.\d+",
        r"(?:начиная )?с версии 0\.\d+",
        r"\bначиная с (?:svir )?0\.\d+",
        r"\bдо версии 0\.\d+",
        r"\b(?:добавлен[аоы]?|изменен[аоы]?|изменён|удален[аоы]?|удалён|появил(?:ся|ась|ось|ись)) в (?:версии |svir )?0\.\d+",
    )
]


def minor(version: str) -> str:
    """`0.2.1` and `0.2` are both release line `0.2`."""
    return ".".join(version.split(".")[:2])


def expected_version() -> str:
    m = re.search(r'SVIR_VERSION:\s*"([^"]+)"', CI_YML.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit(f"{CI_YML.relative_to(ROOT)}: SVIR_VERSION not found")
    return minor(m.group(1))


def pages(locale: Path) -> list[Path]:
    return sorted(locale.rglob("*.md"))


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def first(pattern: str, path: Path) -> str | None:
    if not path.exists():
        return None
    m = re.search(pattern, path.read_text(encoding="utf-8"))
    return m.group(1) if m else None


def check_versions(expected: str) -> list[str]:
    problems = []

    default = first(r'SVIR_VERSION", "([^"]+)"', SNIPPETS)
    if not default or minor(default) != expected:
        problems.append(f"{rel(SNIPPETS)}: default SVIR_VERSION is {default}, expected {expected}")

    skill_md = SKILL / "svir" / "SKILL.md"
    skill_version = first(r'svir-version:\s*"([^"]+)"', skill_md)
    if not skill_version or minor(skill_version) != expected:
        problems.append(f"{rel(skill_md)}: svir-version is {skill_version}, expected {expected}.x")

    for locale in (EN, RU):
        page = locale / "agent-skill.md"
        shown = first(r'svir-version:\s*"([^"]+)"', page)
        if shown != skill_version:
            problems.append(f"{rel(page)}: shows svir-version {shown}, SKILL.md says {skill_version}")

        page = locale / "reference" / "migration.md"
        current = first(r"\*\*([0-9]+\.[0-9]+)\*\*", page)
        if current != expected:
            problems.append(f"{rel(page)}: current release is {current}, expected {expected}")

        page = locale / "intro.md"
        described = first(r"\*\*svir ([0-9]+\.[0-9]+)\*\*", page)
        if described != expected:
            problems.append(f"{rel(page)}: describes svir {described}, expected {expected}")

    for md in [*pages(EN), *pages(RU), *sorted(SKILL.rglob("*.md"))]:
        if md in HISTORY_PAGES:
            continue
        text = md.read_text(encoding="utf-8")
        for dep in DEPENDENCY.finditer(text):
            name, version = dep.groups()
            if version != expected:
                line = text.count("\n", 0, dep.start()) + 1
                problems.append(f"{rel(md)}:{line}: {name} = \"{version}\", expected \"{expected}\"")

    return problems


def check_history() -> list[str]:
    problems = []
    for md in [*pages(EN), *pages(RU)]:
        if md in HISTORY_PAGES:
            continue
        in_code = False
        for n, line in enumerate(md.read_text(encoding="utf-8").splitlines(), 1):
            if line.lstrip().startswith(("```", "~~~")):
                in_code = not in_code
                continue
            if in_code:
                continue
            for pattern in HISTORY:
                m = pattern.search(line)
                if m:
                    problems.append(f"{rel(md)}:{n}: version history \"{m.group(0)}\"")
                    break
    return problems


def check_locales() -> list[str]:
    en = {p.relative_to(EN) for p in pages(EN)}
    ru = {p.relative_to(RU) for p in pages(RU)}
    return [f"{rel(RU / p)}: missing (docs/ has it)" for p in sorted(en - ru)] + [
        f"{rel(EN / p)}: missing (the Russian locale has it)" for p in sorted(ru - en)
    ]


def main() -> int:
    expected = expected_version()
    sections = [
        (f"One svir version ({expected})", check_versions(expected)),
        ("No version history outside Migration", check_history()),
        ("Same pages in en and ru", check_locales()),
    ]
    failed = False
    for title, problems in sections:
        print(f"{'FAIL' if problems else 'ok  '}  {title}")
        for p in problems:
            print(f"      {p}")
        failed |= bool(problems)
    if failed:
        print("\nSee CONTRIBUTING.md for the rules behind these checks.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
