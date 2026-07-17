import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";
import { fixtureCandidates, memoKey } from "./fixtures";
import { findRtlLiterals, RtlLiteral } from "./literals";
import { PreviewManager } from "./preview";

let client: LanguageClient | undefined;
let starting: Promise<LanguageClient | undefined> | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Cheap, always: register commands and CodeLens providers. The extension
  // also activates on Python/Java (see activationEvents) so the preview lens
  // shows on RTL string literals — but the server is started lazily below,
  // never merely because a host-language file is open.
  registerPreview(context, () => ensureServer(context));

  // Start the server when RTL is actually used: an open .rtl document (for
  // diagnostics) now or later. Preview requests start it on demand too.
  const startIfRtl = () => {
    if (vscode.workspace.textDocuments.some((d) => d.languageId === "rtl")) {
      void ensureServer(context);
    }
  };
  startIfRtl();
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(startIfRtl)
  );
}

/** Start the rtl-lsp language client once (idempotent). Returns undefined and
 * shows a status-bar hint when no server binary is available (plan §3.3). */
function ensureServer(
  context: vscode.ExtensionContext
): Promise<LanguageClient | undefined> {
  if (client) {
    return Promise.resolve(client);
  }
  if (starting) {
    return starting;
  }
  starting = (async () => {
    const serverPath = findServer(context);
    if (!serverPath) {
      showFallbackStatus(context);
      return undefined;
    }
    const serverOptions: ServerOptions = { command: serverPath };
    const clientOptions: LanguageClientOptions = {
      documentSelector: [{ language: "rtl" }],
    };
    const c = new LanguageClient(
      "rtl",
      "RTL Language Server",
      serverOptions,
      clientOptions
    );
    await c.start();
    client = c;
    return client;
  })();
  return starting;
}

function showFallbackStatus(context: vscode.ExtensionContext): void {
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right
  );
  status.text = "RTL: highlighting only";
  status.tooltip =
    "The rtl-lsp language server is not bundled for this platform and " +
    '"rtl.server.path" is not set. Syntax highlighting and snippets work; ' +
    "diagnostics and match preview are disabled.";
  const show = () => {
    const active =
      vscode.window.activeTextEditor?.document.languageId === "rtl";
    if (active) {
      status.show();
    } else {
      status.hide();
    }
  };
  context.subscriptions.push(
    status,
    vscode.window.onDidChangeActiveTextEditor(show)
  );
  show();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}

/** Live match preview (plan §5, phase 4; phase 5 step 0 adds host-language
 * string literals): commands + CodeLens. */
function registerPreview(
  context: vscode.ExtensionContext,
  ensureServer: () => Promise<LanguageClient | undefined>
): void {
  const previews = new PreviewManager(() => client, context);
  const lensChanged = new vscode.EventEmitter<void>();

  /** The pattern the command acts on: a `.rtl` document (literal is
   * undefined) or one RTL string literal of a Python/Java document. */
  const resolveLiteral = async (
    doc: vscode.TextDocument,
    litIndex?: number
  ): Promise<{ text: string; index: number } | undefined | null> => {
    if (doc.languageId === "rtl") {
      return undefined;
    }
    const lits = findRtlLiterals(doc.getText(), doc.languageId);
    if (lits.length === 0) {
      void vscode.window.showInformationMessage(
        "No RTL string literals found in this file (RtlCompiler.compile, @RtlSource, language=RTL)."
      );
      return null;
    }
    let n = litIndex;
    if (n === undefined) {
      const editor = vscode.window.activeTextEditor;
      const off = editor ? doc.offsetAt(editor.selection.active) : -1;
      n = lits.findIndex((l) => off >= l.start && off <= l.end);
    }
    if (n === undefined || n < 0) {
      if (lits.length === 1) {
        n = 0;
      } else {
        const picked = await vscode.window.showQuickPick(
          lits.map((l, i) => ({
            label: `${i + 1}: ${l.form}`,
            description: firstLine(l.text),
            index: i,
          })),
          { placeHolder: "Which RTL literal?" }
        );
        if (!picked) {
          return null;
        }
        n = picked.index;
      }
    }
    return { text: lits[n].text, index: n };
  };

  const pickFixture = async (
    doc: vscode.TextDocument,
    literal: { text: string; index: number } | undefined
  ): Promise<string | undefined> => {
    const candidates = fixtureCandidates(doc, context.workspaceState, literal);
    const items: vscode.QuickPickItem[] = candidates.map((p) => ({
      label: path.basename(p),
      description: vscode.workspace.asRelativePath(p),
    }));
    items.push({ label: "Browse…", description: "pick a CSV file" });
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Fixture table for the RTL preview",
    });
    if (!picked) {
      return undefined;
    }
    let fixture: string | undefined;
    if (picked.label === "Browse…") {
      const chosen = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { "CSV tables": ["csv"] },
        defaultUri: vscode.Uri.file(path.dirname(doc.uri.fsPath)),
      });
      fixture = chosen?.[0]?.fsPath;
    } else {
      fixture = candidates[items.indexOf(picked)];
    }
    if (fixture) {
      await context.workspaceState.update(memoKey(doc.uri, literal?.index), fixture);
      lensChanged.fire();
    }
    return fixture;
  };

  const supported = (doc: vscode.TextDocument | undefined): doc is vscode.TextDocument =>
    !!doc && ["rtl", "python", "java"].includes(doc.languageId);

  // Canonical form (plan §5, phase 3 item 5): a read-only side view, not a
  // formatter — canonicalization drops comments (including `// fixture:`)
  // and the authored layout, so it must never touch the source document.
  const canonical = new Map<string, string>();
  const canonicalChanged = new vscode.EventEmitter<vscode.Uri>();

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("rtl-canonical", {
      onDidChange: canonicalChanged.event,
      provideTextDocumentContent: (uri) => canonical.get(uri.toString()) ?? "",
    }),
    vscode.commands.registerCommand(
      "rtl.showCanonicalForm",
      async (args?: { litIndex?: number }) => {
        const doc = vscode.window.activeTextEditor?.document;
        if (!supported(doc)) {
          return;
        }
        const c = await ensureServer();
        if (!c) {
          void vscode.window.showWarningMessage(
            "The canonical form needs the rtl-lsp server (not available on this platform; set rtl.server.path)."
          );
          return;
        }
        const literal = await resolveLiteral(doc, args?.litIndex);
        if (literal === null) {
          return;
        }
        const res = await c.sendRequest<{ text?: string; error?: string }>(
          "rtl/canonicalize",
          { patternUri: doc.uri.toString(), patternText: literal?.text }
        );
        if (res.error !== undefined || res.text === undefined) {
          void vscode.window.showErrorMessage(
            `Cannot canonicalize: ${res.error ?? "no result"}`
          );
          return;
        }
        const base = path.basename(doc.uri.path).replace(/\.[^.]+$/, "");
        const lit = literal ? `.lit${literal.index + 1}` : "";
        const target = vscode.Uri.from({
          scheme: "rtl-canonical",
          path: `/${base}${lit}.canonical.rtl`,
          query: doc.uri.toString(),
        });
        canonical.set(target.toString(), res.text);
        canonicalChanged.fire(target);
        const view = await vscode.workspace.openTextDocument(target);
        await vscode.window.showTextDocument(view, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: true,
        });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "rtl.selectFixture",
      async (args?: { litIndex?: number }) => {
        const doc = vscode.window.activeTextEditor?.document;
        if (!supported(doc)) {
          return;
        }
        const literal = await resolveLiteral(doc, args?.litIndex);
        if (literal === null) {
          return;
        }
        const fixture = await pickFixture(doc, literal);
        if (fixture) {
          await previews.open({ uri: doc.uri, fixture, litIndex: literal?.index });
        }
      }
    ),
    vscode.commands.registerCommand(
      "rtl.previewMatch",
      async (args?: { litIndex?: number }) => {
        const doc = vscode.window.activeTextEditor?.document;
        if (!supported(doc)) {
          return;
        }
        if (!(await ensureServer())) {
          void vscode.window.showWarningMessage(
            "RTL preview needs the rtl-lsp server (not available on this platform; set rtl.server.path)."
          );
          return;
        }
        const literal = await resolveLiteral(doc, args?.litIndex);
        if (literal === null) {
          return;
        }
        const fixture =
          fixtureCandidates(doc, context.workspaceState, literal)[0] ??
          (await pickFixture(doc, literal));
        if (fixture) {
          await previews.open({ uri: doc.uri, fixture, litIndex: literal?.index });
        }
      }
    ),
    vscode.languages.registerCodeLensProvider(
      { language: "rtl" },
      {
        onDidChangeCodeLenses: lensChanged.event,
        provideCodeLenses(doc) {
          const range = new vscode.Range(0, 0, 0, 0);
          const lenses: vscode.CodeLens[] = [];
          const fixture = fixtureCandidates(doc, context.workspaceState)[0];
          if (fixture) {
            lenses.push(
              new vscode.CodeLens(range, {
                title: `▶ Preview with ${path.basename(fixture)}`,
                command: "rtl.previewMatch",
              })
            );
          }
          lenses.push(
            new vscode.CodeLens(range, {
              title: "Select fixture…",
              command: "rtl.selectFixture",
            })
          );
          return lenses;
        },
      }
    ),
    vscode.languages.registerCodeLensProvider(
      [{ language: "python" }, { language: "java" }],
      {
        onDidChangeCodeLenses: lensChanged.event,
        provideCodeLenses(doc) {
          const lenses: vscode.CodeLens[] = [];
          findRtlLiterals(doc.getText(), doc.languageId).forEach(
            (lit: RtlLiteral, i: number) => {
              const pos = doc.positionAt(lit.start);
              const range = new vscode.Range(pos, pos);
              const fixture = fixtureCandidates(doc, context.workspaceState, {
                text: lit.text,
                index: i,
              })[0];
              lenses.push(
                new vscode.CodeLens(range, {
                  title: fixture
                    ? `▶ Preview RTL with ${path.basename(fixture)}`
                    : "▶ Preview RTL…",
                  command: "rtl.previewMatch",
                  arguments: [{ litIndex: i }],
                }),
                new vscode.CodeLens(range, {
                  title: "Select fixture…",
                  command: "rtl.selectFixture",
                  arguments: [{ litIndex: i }],
                })
              );
            }
          );
          return lenses;
        },
      }
    )
  );
}

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.length > 60 ? line.slice(0, 57) + "…" : line;
}

/** Resolve the rtl-lsp binary: the `rtl.server.path` setting wins; otherwise
 * the binary bundled in `bin/` by the platform-specific VSIX. */
function findServer(context: vscode.ExtensionContext): string | undefined {
  const configured = vscode.workspace
    .getConfiguration("rtl")
    .get<string>("server.path");
  if (configured) {
    if (fs.existsSync(configured)) {
      return configured;
    }
    void vscode.window.showWarningMessage(
      `rtl.server.path does not exist: ${configured} — falling back to the bundled server.`
    );
  }
  const exe = process.platform === "win32" ? "rtl-lsp.exe" : "rtl-lsp";
  const bundled = context.asAbsolutePath(path.join("bin", exe));
  return fs.existsSync(bundled) ? bundled : undefined;
}
