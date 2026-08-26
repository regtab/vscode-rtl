/** Pure match-preview rendering (no `vscode` import — unit-testable and
 * kept apart from the webview plumbing in `preview.ts`). */

/** One item derived from a table cell, as reported by the server. */
export interface CellRole {
  row: number;
  col: number;
  role: "value" | "attribute" | "auxiliary";
  /** Ordinal of the item within its cell. */
  index: number;
  /** Extracted string (after extractors — may differ from the segment). */
  s: string;
  /** Source segment range in the raw cell text, in code points. */
  span: [number, number];
  tags: string[];
}

/** HTML-escape for both text nodes and quoted attribute values. `"` matters:
 * item tooltips quote the extracted string, and for an empty item the tip is
 * `VALUE[1] → ""` — an unescaped quote would truncate the `title` attribute
 * and leave the zero-width marker with no way to identify itself. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Raw cell text with each item's source segment wrapped in a colored span
 * (plan §5.4 p. 3: granularity is the cell-derived item, not the cell). */
export function renderCell(text: string, items: CellRole[]): string {
  if (items.length === 0) {
    return `<td class="unmatched">${esc(text) || "&nbsp;"}</td>`;
  }
  const chars = [...text]; // code points, matching the server's span units
  const sorted = [...items].sort((a, b) => a.span[0] - b.span[0]);
  let html = "";
  let pos = 0;
  for (const it of sorted) {
    let [from, to] = it.span;
    from = Math.max(from, pos);
    to = Math.min(to, chars.length);
    if (to < from) {
      continue; // overlap — already covered
    }
    if (from > pos) {
      html += `<span class="filler">${esc(chars.slice(pos, from).join(""))}</span>`;
    }
    const tags = it.tags.length ? ` #'${it.tags.join("' #'")}'` : "";
    const tip = `${it.role.toUpperCase()}[${it.index}]${tags} → "${it.s}"`;
    if (to === from) {
      // An empty item — e.g. a token between adjacent delimiters, which
      // pyRegTab 0.5.0 derives instead of dropping. It has no text of its
      // own, so mark it with a zero-content span (width comes from CSS):
      // a placeholder character would misrepresent the cell's contents.
      html += `<span class="${it.role} empty" title="${esc(tip)}"></span>`;
      // Advance past the filler just emitted (`to === from`, so this consumes
      // no cell text); leaving `pos` behind would re-emit that filler for the
      // next item and duplicate characters in the rendered cell.
      pos = to;
      continue;
    }
    html += `<span class="${it.role}" title="${esc(tip)}">${
      esc(chars.slice(from, to).join("")) || "&nbsp;"
    }</span>`;
    pos = to;
  }
  if (pos < chars.length) {
    html += `<span class="filler">${esc(chars.slice(pos).join(""))}</span>`;
  }
  return `<td>${html || "&nbsp;"}</td>`;
}
