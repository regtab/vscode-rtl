import * as path from "path";
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { findRtlLiterals } from "./literals";

interface CellRole {
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

interface MatchFixtureResult {
  table: string[][];
  cells: CellRole[];
  schema: string[];
  records: (string | null)[][];
  matched: boolean;
  error?: string;
}

interface Target {
  uri: vscode.Uri;
  fixture: string;
  /** Ordinal of the RTL string literal in a host (Python/Java) document;
   * undefined for plain `.rtl` documents (plan §5, phase 5 step 0). */
  litIndex?: number;
}

/** One live preview panel per pattern (a `.rtl` document or one literal). */
export class PreviewManager {
  private panels = new Map<string, vscode.WebviewPanel>();
  private targets = new Map<string, Target>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly client: () => LanguageClient | undefined,
    context: vscode.ExtensionContext
  ) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        const prefix = e.document.uri.toString();
        const stale = [...this.targets.keys()].filter(
          (k) => k === prefix || k.startsWith(`${prefix}#`)
        );
        if (stale.length) {
          clearTimeout(this.timer);
          this.timer = setTimeout(() => {
            for (const key of stale) {
              void this.refresh(key);
            }
          }, 300);
        }
      })
    );
  }

  static key(uri: vscode.Uri, litIndex?: number): string {
    return litIndex === undefined ? uri.toString() : `${uri.toString()}#lit${litIndex}`;
  }

  async open(target: Target): Promise<void> {
    const key = PreviewManager.key(target.uri, target.litIndex);
    this.targets.set(key, target);
    if (!this.panels.has(key)) {
      const name =
        path.basename(target.uri.fsPath) +
        (target.litIndex === undefined ? "" : ` · literal ${target.litIndex + 1}`);
      const panel = vscode.window.createWebviewPanel(
        "rtlPreview",
        `RTL Preview: ${name}`,
        vscode.ViewColumn.Beside,
        { enableScripts: false }
      );
      panel.onDidDispose(() => {
        this.panels.delete(key);
        this.targets.delete(key);
      });
      this.panels.set(key, panel);
    }
    await this.refresh(key);
    this.panels.get(key)?.reveal(vscode.ViewColumn.Beside, true);
  }

  private async refresh(key: string): Promise<void> {
    const panel = this.panels.get(key);
    const target = this.targets.get(key);
    const client = this.client();
    if (!panel || !target || !client) {
      return;
    }
    const fail = (message: string) => {
      panel.webview.html = render(
        { table: [], cells: [], schema: [], records: [], matched: false, error: message },
        path.basename(target.fixture)
      );
    };
    let patternText: string | undefined;
    if (target.litIndex !== undefined) {
      try {
        const doc = await vscode.workspace.openTextDocument(target.uri);
        const lit = findRtlLiterals(doc.getText(), doc.languageId)[target.litIndex];
        if (!lit) {
          fail(`RTL literal #${target.litIndex + 1} no longer found in the document.`);
          return;
        }
        patternText = lit.text;
      } catch (e) {
        fail(String(e));
        return;
      }
    }
    try {
      const result = await client.sendRequest<MatchFixtureResult>("rtl/matchFixture", {
        patternUri: target.uri.toString(),
        fixturePath: target.fixture,
        patternText,
      });
      panel.webview.html = render(result, path.basename(target.fixture));
    } catch (e) {
      fail(String(e));
    }
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Raw cell text with each item's source segment wrapped in a colored span
 * (plan §5.4 p. 3: granularity is the cell-derived item, not the cell). */
function renderCell(text: string, items: CellRole[]): string {
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
    if (to <= from) {
      continue; // overlap or out of range — already covered
    }
    if (from > pos) {
      html += `<span class="filler">${esc(chars.slice(pos, from).join(""))}</span>`;
    }
    const tags = it.tags.length ? ` #'${it.tags.join("' #'")}'` : "";
    const tip = `${it.role.toUpperCase()}[${it.index}]${tags} → "${it.s}"`;
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

function render(r: MatchFixtureResult, fixtureName: string): string {
  const itemsOf = new Map<string, CellRole[]>();
  for (const c of r.cells) {
    const key = `${c.row},${c.col}`;
    (itemsOf.get(key) ?? itemsOf.set(key, []).get(key)!).push(c);
  }
  const tableRows = r.table
    .map(
      (row, i) =>
        "<tr>" +
        row.map((cell, j) => renderCell(cell, itemsOf.get(`${i},${j}`) ?? [])).join("") +
        "</tr>"
    )
    .join("\n");

  const recHead = r.schema.map((a) => `<th>${esc(a)}</th>`).join("");
  const recRows = r.records
    .map(
      (rec) =>
        "<tr>" +
        rec.map((v) => `<td>${v === null ? "<i>∅</i>" : esc(v)}</td>`).join("") +
        "</tr>"
    )
    .join("\n");

  const status = r.error
    ? `<div class="banner error">${esc(r.error)}</div>`
    : r.matched
      ? `<div class="banner ok">Matched — ${r.records.length} record(s)</div>`
      : `<div class="banner warn">Pattern did not match the table</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
  h3 { margin: 0.6em 0 0.3em; }
  table { border-collapse: collapse; margin: 0.3em 0 1em; }
  td, th { border: 1px solid var(--vscode-editorWidget-border, #666); padding: 2px 8px; font-size: 0.95em; }
  .value { background: rgba(64, 160, 64, 0.35); border-radius: 2px; }
  .attribute { background: rgba(64, 128, 224, 0.35); border-radius: 2px; }
  .auxiliary { background: rgba(224, 160, 32, 0.35); border-radius: 2px; }
  .unmatched, .filler { opacity: 0.6; }
  .banner { padding: 4px 8px; margin: 4px 0; border-radius: 3px; }
  .ok { background: rgba(64, 160, 64, 0.2); }
  .warn { background: rgba(224, 160, 32, 0.2); }
  .error { background: rgba(224, 64, 64, 0.25); white-space: pre-wrap; }
  .legend span { padding: 1px 6px; margin-right: 6px; border-radius: 3px; font-size: 0.85em; }
  .muted { opacity: 0.7; font-size: 0.9em; }
  </style></head><body>
  <div class="muted">Fixture: ${esc(fixtureName)}</div>
  ${status}
  <h3>Table</h3>
  <div class="legend"><span class="value">VAL</span><span class="attribute">ATTR</span><span class="auxiliary">AUX</span><span class="unmatched">unmatched</span></div>
  <table>${tableRows}</table>
  ${
    r.matched
      ? `<h3>Recordset</h3><table><tr>${recHead}</tr>${recRows}</table>`
      : ""
  }
  </body></html>`;
}
