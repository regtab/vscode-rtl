import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
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
