"""Generate the rtl-lsp hover dictionary from pyregtab's docs/rtl-reference.md.

The reference is the single source of truth for token semantics (plan §5,
phase 3 item 1). This script harvests its Markdown tables and emits
`server/src/hover_data.rs`; when the reference changes upstream, re-run and
commit the regenerated file in the same PR.

Usage:
    python tools/gen_hover_data.py [path/to/rtl-reference.md]

Default reference path: ../pyregtab/docs/rtl-reference.md (sibling checkout,
same layout the server's path dependency uses).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_REF = ROOT.parent / "pyregtab" / "docs" / "rtl-reference.md"
OUT = ROOT / "server" / "src" / "hover_data.rs"


def tables_after(md: str, heading: str) -> list[list[tuple[str, ...]]]:
    """All tables between `heading` and the next heading of the same level."""
    level = heading.split(" ")[0]
    start = md.index("\n" + heading)
    rest = md[start + 1 :]
    end = re.search(rf"\n{level} ", rest)
    section = rest[: end.start()] if end else rest
    tables: list[list[tuple[str, ...]]] = []
    current: list[tuple[str, ...]] = []
    for line in section.splitlines():
        if line.startswith("|"):
            cells = tuple(c.strip() for c in line.strip("|").split("|"))
            if all(re.fullmatch(r"-*", c.replace(" ", "")) for c in cells):
                continue  # separator row
            current.append(cells)
        elif current:
            tables.append(current[1:])  # drop the header row
            current = []
    if current:
        tables.append(current[1:])
    return tables


def strip_md(cell: str) -> str:
    return cell.strip().strip("`")


def main() -> int:
    ref = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_REF
    md = ref.read_text(encoding="utf-8")

    # token -> list of (title, body) sections; multiple meanings are merged.
    entries: dict[str, list[tuple[str, str]]] = {}

    def add(token: str, title: str, body: str) -> None:
        entries.setdefault(token.upper(), []).append((title, body))

    # --- Settings prefix -------------------------------------------------
    for syntax, effect in tables_after(md, "## Settings prefix")[0]:
        name = re.match(r"[A-Z]+", strip_md(syntax)).group(0)
        add(name, f"Setting `{strip_md(syntax)}`", effect)

    # --- Item derivation directives --------------------------------------
    atomic = tables_after(md, "### Atomic — `contSpec`")
    for syntax, meaning in atomic[0]:
        for name in re.findall(r"[A-Z]+|_", strip_md(syntax)):
            add(name, f"Item derivation directive `{name}`", meaning)

    # --- Extractors -------------------------------------------------------
    for syntax, effect in atomic[1]:
        name = re.match(r"[A-Z]+", strip_md(syntax)).group(0)
        add(name, f"String extractor `{strip_md(syntax)}`", effect)

    # --- Actions ----------------------------------------------------------
    ops: dict[str, list[str]] = {}
    for op, syntax, effect in tables_after(md, "## Action specifications")[0]:
        name = re.match(r"[A-Z]+", strip_md(op)).group(0)
        ops.setdefault(name, []).append(f"`{strip_md(syntax)}` — {effect}")
    for name, forms in ops.items():
        add(name, f"Interpretation action `{name}`", "\n\n".join(forms))

    # --- Provider constraints ----------------------------------------------
    prov = tables_after(md, "### Cell-derived provider (tblProvSpec)")
    # prov[0]: traversal order, prov[1]: spatial, prov[2]: positional,
    # prov[3]: content, prov[4]: cardinality (per current reference layout).
    for token, cond in prov[1]:
        add(
            strip_md(token),
            f"Spatial constraint `{strip_md(token)}`",
            f"Candidate cells relative to the anchor *a*: `{strip_md(cond)}`",
        )
    positional: dict[str, list[str]] = {}
    for token, cond in prov[2]:
        letter = strip_md(token)[0]
        positional.setdefault(letter, []).append(
            f"`{strip_md(token)}` — `{strip_md(cond)}`"
        )
    kind = {"C": "column", "R": "row", "P": "position-in-record"}
    for letter, forms in positional.items():
        add(
            letter,
            f"Positional constraint `{letter}…` ({kind[letter]})",
            "\n\n".join(forms),
        )
    for token, cond in prov[3]:
        name = strip_md(token)
        m = re.fullmatch(r"!?([A-Z]+).*", name)
        if not m or m.group(1) in ("TAG",):  # tags hover on '#'
            continue
        add(
            m.group(1),
            f"Content constraint `{name}`",
            f"`{strip_md(cond)}`",
        )

    # --- EXT ---------------------------------------------------------------
    ext_rows = tables_after(md, "## External Python bindings — `EXT('name')`")[0]
    ext_doc = "\n\n".join(
        f"{strip_md(pos)} → **{strip_md(kind_)}** ({strip_md(call)})"
        for pos, kind_, call in ext_rows
    )
    add(
        "EXT",
        "External binding `EXT('name')`",
        "Resolved against host-runtime `Bindings` at compile time; while "
        "editing standalone files it is treated as always-true.\n\n" + ext_doc,
    )

    # --- Quantifiers ---------------------------------------------------------
    quant_rows = tables_after(md, "## Pattern structure")[0]
    quant_doc = "\n\n".join(
        f"`{strip_md(s)}` — {m}" for s, m in quant_rows if strip_md(s) != "*(absent)*"
    )

    # --- Punctuation / structure -------------------------------------------
    order_doc = "\n\n".join(
        f"`{strip_md(s)}` — {strip_md(o)}"
        for s, o in prov[0]
        if strip_md(s) != "*(absent)*"
    )
    card_doc = "\n\n".join(
        f"`{strip_md(s)}` — {m}" for s, m in prov[4] if strip_md(s) != "*(absent)*"
    )
    punct: list[tuple[str, str, str]] = [
        ("->", "Action arrow `providers->OP`", "Applies the interpretation action `OP` to the anchor item, with candidate items supplied by the providers."),
        ("#", "Tag `#'name'`", "User-defined tag attached to an item; `#'t'` in a constraint position matches tagged items, `!#'t'` — untagged."),
        ("@", "Constant AVP `@'ATTR'='VALUE'`", "Context-derived provider: a constant attribute–value pair."),
        ("$", "Fragment `$NAME`", "Named fragment: declared in the preamble (`$N=[…]` / `$N={…}`), referenced as `[$N]` / `{$N}`. Expansion is a syntactic substitution."),
        ("?", "Quantifier / condition marker", quant_doc + "\n\nAfter a cell match condition, `?` separates the condition from the content specification."),
        ("*", "Quantifier `*` / cardinality", quant_doc + "\n\nProvider cardinality:\n\n" + card_doc),
        ("+", "Quantifier `+`", quant_doc),
        ("{N}", "Quantifier `{n}` / cardinality", quant_doc + "\n\nProvider cardinality:\n\n" + card_doc),
        ("^", "Traversal order", order_doc),
        ("..", "Range `a..b`", "Positional range: `C1..3`, `R+1..`, `P0..2`. An open end (`a..`) is unbounded."),
    ]
    for tok, title, body in punct:
        add(tok, title, body)

    # --- Emit --------------------------------------------------------------
    def esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace("\"", "\\\"")

    lines = [
        "//! Hover dictionary — @generated by tools/gen_hover_data.py from",
        "//! pyregtab docs/rtl-reference.md. Do not edit; re-run the script",
        "//! when the reference changes.",
        "",
        "/// (token, markdown). Word tokens are upper-case; punctuation as-is.",
        "pub static HOVER: &[(&str, &str)] = &[",
    ]
    for token in sorted(entries):
        parts = [f"**{title}**\n\n{body}" for title, body in entries[token]]
        doc = "\n\n---\n\n".join(parts)
        lines.append(f'    ("{esc(token)}", "{esc(doc)}"),')
    lines.append("];")
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {OUT} ({len(entries)} tokens) from {ref}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
