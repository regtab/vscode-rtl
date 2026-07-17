const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vscode = require("vscode");

async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = check();
    if (result) {
      return result;
    }
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe("RTL extension smoke", () => {
  let file;

  before(() => {
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rtl-e2e-")), "bad.rtl");
  });

  it("activates on .rtl and publishes a compile diagnostic", async () => {
    fs.writeFileSync(file, "[ [VAL : ->REC] ]\n");
    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc);
    assert.strictEqual(doc.languageId, "rtl");

    const ext = vscode.extensions.getExtension("regtab.rtl");
    assert.ok(ext, "extension regtab.rtl not found");
    await waitFor(() => ext.isActive, 15000);

    const diags = await waitFor(() => {
      const d = vscode.languages.getDiagnostics(doc.uri);
      return d.length > 0 ? d : undefined;
    }, 20000);
    assert.strictEqual(diags.length, 1);
    assert.match(diags[0].message, /expected/i);
    assert.strictEqual(diags[0].range.start.line, 0);
    assert.strictEqual(diags[0].range.start.character, 3);
  });

  it("clears diagnostics once the pattern is fixed (EXT is permissive)", async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit((edit) =>
      edit.replace(
        new vscode.Range(0, 0, doc.lineCount, 0),
        "[ [EXT('custom') ? VAL : ST*->REC] ]+\n"
      )
    );
    await waitFor(
      () => vscode.languages.getDiagnostics(doc.uri).length === 0 || undefined,
      20000
    );
  });

  it("shows the canonical form in a read-only side view", async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit((edit) =>
      edit.replace(
        new vscode.Range(0, 0, doc.lineCount, 0),
        "// fixture: t.csv\n[ [VAL : ST*->REC] ]+\n"
      )
    );
    await vscode.commands.executeCommand("rtl.showCanonicalForm");
    const view = await waitFor(
      () =>
        vscode.window.visibleTextEditors.find(
          (e) => e.document.uri.scheme === "rtl-canonical"
        ),
      20000
    );
    assert.strictEqual(view.document.languageId, "rtl");
    const canon = view.document.getText();
    assert.ok(canon.includes("REC"), canon);
    // Canonicalization drops comments — that is why it is not a formatter.
    assert.ok(!canon.includes("fixture"), canon);
  });
});
