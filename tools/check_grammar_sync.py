"""Keep the TextMate grammar in sync with the normative RTL grammar (plan §5, phase 1).

This repository is the canonical home of the RTL tmLanguage grammars, while the
normative grammar `RTL.g4` lives in jRegTab (a pinned verbatim copy is vendored
here in `grammar/`). Two things can drift, and this check catches both:

1. Pin integrity (offline, always): the SHA-256 of `grammar/RTL.g4` must equal
   the `sha256:` recorded in `grammar/UPSTREAM`. Catches any local edit of the
   vendored copy. (Ported from pyregtab's tools/check_grammar_sync.py.)
2. Keyword coverage: every keyword token of `RTL.g4` must be matched by some
   pattern of `syntaxes/rtl.tmLanguage.json`, and every keyword-looking word in
   the tmLanguage must exist in `RTL.g4`. Catches a grammar re-sync that was not
   accompanied by a tmLanguage update, and stale keywords left in the tmLanguage.
3. Upstream cross-check (opt-in): with a `JREGTAB_TOKEN` env var that can read
   the private jRegTab repo, fetch the grammar at the pinned commit and assert
   byte-identity with the vendored copy.

Exit code 0 = in sync, 1 = drift detected.

Usage: python tools/check_grammar_sync.py
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRAMMAR = ROOT / "grammar" / "RTL.g4"
UPSTREAM = ROOT / "grammar" / "UPSTREAM"
TMLANGUAGE = ROOT / "syntaxes" / "rtl.tmLanguage.json"
REPO = "regtab/jregtab"

# Words that look like keywords inside tmLanguage regexes but are regex/scope
# machinery, not RTL tokens.
TM_NOISE = {"A", "Z"}


def parse_pin(text: str) -> dict[str, str]:
    pin: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        key, _, value = line.partition(":")
        pin[key.strip()] = value.strip()
    return pin


def check_pin() -> bool:
    pin = parse_pin(UPSTREAM.read_text(encoding="utf-8"))
    expected_hash = pin.get("sha256")
    if not pin.get("commit") or not expected_hash:
        print("FAIL: grammar/UPSTREAM must record both 'commit:' and 'sha256:'")
        return False
    local_hash = hashlib.sha256(GRAMMAR.read_bytes()).hexdigest()
    if local_hash != expected_hash:
        print(
            "FAIL: grammar/RTL.g4 has drifted from the pinned hash.\n"
            f"  recorded (grammar/UPSTREAM): {expected_hash}\n"
            f"  actual   (grammar/RTL.g4):   {local_hash}\n"
            "  If you intentionally re-synced the grammar, update the sha256 in "
            "grammar/UPSTREAM and the tmLanguage grammars in the same commit."
        )
        return False
    print(f"OK: grammar/RTL.g4 matches pinned sha256 ({expected_hash[:12]}…)")
    return True


def g4_keywords() -> set[str]:
    """Keyword tokens of RTL.g4: quoted uppercase-word literals ('NORM', 'R', …)."""
    text = GRAMMAR.read_text(encoding="utf-8")
    # Strip comments so keywords mentioned in prose are not picked up.
    text = re.sub(r"//[^\n]*", "", text)
    return set(re.findall(r"'([A-Z][A-Z0-9_]*)'", text))


def tm_match_regexes() -> list[str]:
    """All 'match'/'begin'/'end' regex sources of the .rtl tmLanguage."""
    doc = json.loads(TMLANGUAGE.read_text(encoding="utf-8"))
    out: list[str] = []

    def walk(node: object) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ("match", "begin", "end") and isinstance(value, str):
                    out.append(value)
                else:
                    walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(doc)
    return out


def covered_by_tm(kw: str, regexes: list[str]) -> bool:
    word = rf"(?<![A-Za-z0-9_]){re.escape(kw)}(?![A-Za-z0-9_])"
    for rx in regexes:
        if re.search(word, rx):
            return True
        # Single-letter keywords (R, C, P) may sit in a character class: [CRP]
        if len(kw) == 1:
            for cls in re.findall(r"\[([^\]]*)\]", rx):
                if kw in cls:
                    return True
    return False


def tm_keywords(regexes: list[str]) -> set[str]:
    """Keyword-looking words (≥2 chars, all-caps) used in tmLanguage regexes."""
    words: set[str] = set()
    for rx in regexes:
        # Character classes ([CRP], [A-Za-z0-9_]) are letter sets, not words.
        rx = re.sub(r"\[[^\]]*\]", "", rx)
        words.update(
            w
            for w in re.findall(r"(?<![A-Za-z0-9_])([A-Z][A-Z0-9_]+)(?![A-Za-z0-9_])", rx)
            if w not in TM_NOISE
        )
    return words


def check_coverage() -> bool:
    ok = True
    keywords = g4_keywords()
    regexes = tm_match_regexes()

    missing = sorted(kw for kw in keywords if not covered_by_tm(kw, regexes))
    if missing:
        print(
            "FAIL: keyword tokens of grammar/RTL.g4 not covered by "
            f"syntaxes/rtl.tmLanguage.json: {', '.join(missing)}"
        )
        ok = False
    else:
        print(f"OK: all {len(keywords)} RTL.g4 keyword tokens are covered by the tmLanguage")

    stale = sorted(tm_keywords(regexes) - keywords)
    if stale:
        print(
            "FAIL: tmLanguage matches keywords that do not exist in grammar/RTL.g4 "
            f"(stale after a grammar change?): {', '.join(stale)}"
        )
        ok = False
    else:
        print("OK: tmLanguage contains no keywords unknown to RTL.g4")
    return ok


def check_upstream() -> bool:
    token = os.environ.get("JREGTAB_TOKEN")
    pin = parse_pin(UPSTREAM.read_text(encoding="utf-8"))
    commit = pin["commit"]
    upstream_path = pin.get("path", "src/main/antlr4/ru/icc/regtab/rtl/RTL.g4")
    if not token:
        print(
            "NOTE: JREGTAB_TOKEN not set — skipping the upstream byte-for-byte "
            f"cross-check against {REPO}@{commit[:12]}. The offline hash check above "
            "still guarantees the copy is unchanged since it was pinned."
        )
        return True

    url = f"https://raw.githubusercontent.com/{REPO}/{commit}/{upstream_path}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            upstream_bytes = resp.read()
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: could not fetch upstream grammar from {url}: {e}")
        return False

    if upstream_bytes != GRAMMAR.read_bytes():
        print(
            f"FAIL: grammar/RTL.g4 differs from {REPO}@{commit[:12]}:{upstream_path}. "
            "Re-copy the upstream grammar, update grammar/UPSTREAM and the tmLanguage."
        )
        return False
    print(f"OK: grammar/RTL.g4 is byte-identical to {REPO}@{commit[:12]}")
    return True


def main() -> int:
    ok = check_pin()
    ok = check_coverage() and ok
    ok = check_upstream() and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
