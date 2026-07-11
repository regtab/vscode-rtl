// E2E smoke (plan §5, phase 2): launches VS Code with the extension under
// development and runs test/e2e/suite inside it. Requires dist/extension.js
// (npm run build:client) and the server binary in bin/.
const path = require("path");
const { runTests } = require("@vscode/test-electron");

async function main() {
  // When launched from a terminal inside VS Code, this var makes the
  // downloaded Code.exe run as plain Node and reject every CLI option.
  delete process.env.ELECTRON_RUN_AS_NODE;

  const extensionDevelopmentPath = path.resolve(__dirname, "../..");
  const extensionTestsPath = path.resolve(__dirname, "suite");
  try {
    await runTests({
      // Pinned: @vscode/test-electron 2.5.x cannot drive the very latest
      // VS Code builds (their CLI rejects the harness options).
      version: "1.100.0",
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ["--disable-extensions", "--disable-gpu"],
    });
  } catch (err) {
    console.error("e2e tests failed:", err);
    process.exit(1);
  }
}

main();
