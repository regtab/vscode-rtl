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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  registerPreview(context);
  const serverPath = findServer(context);
  if (!serverPath) {
    // Fallback (plan §3.3): the declarative layer still works; hint in the
    // status bar that compile diagnostics are unavailable on this platform.
    const status = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right
    );
    status.text = "RTL: highlighting only";
    status.tooltip =
      "The rtl-lsp language server is not bundled for this platform and " +
      '"rtl.server.path" is not set. Syntax highlighting and snippets work; ' +
      "compile diagnostics are disabled.";
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
    return;
  }

  const serverOptions: ServerOptions = { command: serverPath };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ language: "rtl" }],
  };
  client = new LanguageClient(
    "rtl",
    "RTL Language Server",
    serverOptions,
    clientOptions
  );
  await client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}

/** Live match preview (plan §5, phase 4; phase 5 step 0 adds host-language
 * string literals): commands + CodeLens. */
function registerPreview(context: vscode.ExtensionContext): void {
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
        if (!client) {
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
