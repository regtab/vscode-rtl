import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";
import { fixtureCandidates, memoKey } from "./fixtures";
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

/** Live match preview (plan §5, phase 4): commands + CodeLens. */
function registerPreview(context: vscode.ExtensionContext): void {
  const previews = new PreviewManager(() => client, context);
  const lensChanged = new vscode.EventEmitter<void>();

  const pickFixture = async (
    doc: vscode.TextDocument
  ): Promise<string | undefined> => {
    const candidates = fixtureCandidates(doc, context.workspaceState);
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
      await context.workspaceState.update(memoKey(doc.uri), fixture);
      lensChanged.fire();
    }
    return fixture;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("rtl.selectFixture", async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (doc?.languageId !== "rtl") {
        return;
      }
      const fixture = await pickFixture(doc);
      if (fixture) {
        await previews.open(doc.uri, fixture);
      }
    }),
    vscode.commands.registerCommand("rtl.previewMatch", async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (doc?.languageId !== "rtl") {
        return;
      }
      if (!client) {
        void vscode.window.showWarningMessage(
          "RTL preview needs the rtl-lsp server (not available on this platform; set rtl.server.path)."
        );
        return;
      }
      const fixture =
        fixtureCandidates(doc, context.workspaceState)[0] ?? (await pickFixture(doc));
      if (fixture) {
        await previews.open(doc.uri, fixture);
      }
    }),
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
    )
  );
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
