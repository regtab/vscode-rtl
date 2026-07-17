import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { findRtlLiterals, RtlLiteral } from "./literals";

/** Diagnostics for RTL embedded in Python/Java string literals (plan §5,
 * phase 5 step 1): each extracted literal is compiled via the `rtl/check`
 * custom request, and the returned ranges — expressed in the coordinates of
 * the extracted text — are mapped back into the host document through the
 * literal's offset map (unescaping and text-block indent stripping make the
 * extraction non-1:1). */

/** Shape of `tower_lsp::lsp_types::Diagnostic` we consume. */
interface LspDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  message: string;
}

const DEBOUNCE_MS = 400;

export function registerEmbeddedDiagnostics(
  context: vscode.ExtensionContext,
  ensureServer: () => Promise<LanguageClient | undefined>
): void {
  const collection = vscode.languages.createDiagnosticCollection("rtl-embedded");
  const timers = new Map<string, NodeJS.Timeout>();

  const check = async (doc: vscode.TextDocument) => {
    const literals = findRtlLiterals(doc.getText(), doc.languageId);
    if (literals.length === 0) {
      collection.delete(doc.uri);
      return;
    }
    // A literal present means RTL is actually in use in this host file —
    // that justifies starting the server (same lazy rule as diagnostics
    // for .rtl documents and preview requests).
    const client = await ensureServer();
    if (!client) {
      return;
    }
    const version = doc.version;
    const diags: vscode.Diagnostic[] = [];
    for (const lit of literals) {
      let reported: LspDiagnostic[];
      try {
        reported = await client.sendRequest<LspDiagnostic[]>("rtl/check", {
          text: lit.text,
        });
      } catch {
        return; // server gone; the restart will trigger a fresh pass
      }
      for (const d of reported) {
        diags.push(remap(doc, lit, d));
      }
    }
    if (doc.version !== version) {
      return; // edited meanwhile — the newer scheduled pass owns the result
    }
    collection.set(doc.uri, diags);
  };

  const schedule = (doc: vscode.TextDocument) => {
    if (doc.languageId !== "python" && doc.languageId !== "java") {
      return;
    }
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        void check(doc);
      }, DEBOUNCE_MS)
    );
  };

  context.subscriptions.push(
    collection,
    vscode.workspace.onDidOpenTextDocument(schedule),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      timers.delete(doc.uri.toString());
      collection.delete(doc.uri);
    })
  );
  vscode.workspace.textDocuments.forEach(schedule);
}

/** Translate a diagnostic from extracted-text coordinates into a host-file
 * range via the literal's offset map. */
function remap(
  doc: vscode.TextDocument,
  lit: RtlLiteral,
  d: LspDiagnostic
): vscode.Diagnostic {
  const clamp = (k: number) => Math.max(0, Math.min(k, lit.map.length - 1));
  const startOff = lit.map[clamp(offsetIn(lit.text, d.range.start))];
  const endOff = lit.map[clamp(offsetIn(lit.text, d.range.end))];
  const range = new vscode.Range(
    doc.positionAt(startOff),
    doc.positionAt(Math.max(endOff, startOff + 1))
  );
  const diag = new vscode.Diagnostic(range, d.message, vscode.DiagnosticSeverity.Error);
  diag.source = "rtl";
  return diag;
}

/** (line, character) → offset within `text`, clamped to its bounds. */
function offsetIn(
  text: string,
  pos: { line: number; character: number }
): number {
  let off = 0;
  let line = 0;
  while (line < pos.line) {
    const nl = text.indexOf("\n", off);
    if (nl < 0) {
      return text.length;
    }
    off = nl + 1;
    line += 1;
  }
  const lineEnd = text.indexOf("\n", off);
  const len = (lineEnd < 0 ? text.length : lineEnd) - off;
  return off + Math.min(pos.character, len);
}
