import * as path from "path";
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

interface CellRole {
  row: number;
  col: number;
  role: "value" | "attribute" | "auxiliary";
}

interface MatchFixtureResult {
  table: string[][];
  cells: CellRole[];
  schema: string[];
  records: (string | null)[][];
  matched: boolean;
  error?: string;
}

/** One live preview panel per pattern document. */
export class PreviewManager {
  private panels = new Map<string, vscode.WebviewPanel>();
  private fixtures = new Map<string, string>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly client: () => LanguageClient | undefined,
    context: vscode.ExtensionContext
  ) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === "rtl" && this.panels.has(e.document.uri.toString())) {
          clearTimeout(this.timer);
          this.timer = setTimeout(() => void this.refresh(e.document.uri), 300);
        }
      })
    );
  }

  async open(patternUri: vscode.Uri, fixturePath: string): Promise<void> {
    this.fixtures.set(patternUri.toString(), fixturePath);
    const key = patternUri.toString();
    if (!this.panels.has(key)) {
      const panel = vscode.window.createWebviewPanel(
        "rtlPreview",
        `RTL Preview: ${path.basename(patternUri.fsPath)}`,
        vscode.ViewColumn.Beside,
        { enableScripts: false }
      );
      panel.onDidDispose(() => this.panels.delete(key));
      this.panels.set(key, panel);
    }
    await this.refresh(patternUri);
    this.panels.get(key)?.reveal(vscode.ViewColumn.Beside, true);
  }

  private async refresh(patternUri: vscode.Uri): Promise<void> {
    const key = patternUri.toString();
    const panel = this.panels.get(key);
    const fixture = this.fixtures.get(key);
    const client = this.client();
    if (!panel || !fixture || !client) {
      return;
    }
    try {
      const result = await client.sendRequest<MatchFixtureResult>("rtl/matchFixture", {
        patternUri: key,
        fixturePath: fixture,
      });
      panel.webview.html = render(result, path.basename(fixture));
    } catch (e) {
      panel.webview.html = render(
        { table: [], cells: [], schema: [], records: [], matched: false, error: String(e) },
        path.basename(fixture)
      );
    }
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function render(r: MatchFixtureResult, fixtureName: string): string {
  const roleOf = new Map<string, string>();
  for (const c of r.cells) {
    roleOf.set(`${c.row},${c.col}`, c.role);
  }
  const tableRows = r.table
    .map(
      (row, i) =>
        "<tr>" +
        row
          .map((cell, j) => {
            const role = roleOf.get(`${i},${j}`) ?? "unmatched";
            return `<td class="${role}">${esc(cell) || "&nbsp;"}</td>`;
          })
          .join("") +
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
  .value { background: rgba(64, 160, 64, 0.35); }
  .attribute { background: rgba(64, 128, 224, 0.35); }
  .auxiliary { background: rgba(224, 160, 32, 0.35); }
  .unmatched { opacity: 0.6; }
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
