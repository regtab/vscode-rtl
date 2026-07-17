import * as fs from "fs";
import * as path from "path";

/** Pure fixture-binding helpers (no `vscode` import — unit-testable and
 * shared between the preview and the Test Explorer). */

/** `// <kind>: path` directive values resolved against `dir`, in order.
 * `${workspaceFolder}` in a value substitutes to `workspaceFolder` (falling
 * back to `dir` outside a workspace) — for host files nested deep away from
 * their fixtures, where a relative path would be a `../../..` chain. */
export function directivePaths(
  rtlText: string,
  dir: string,
  kind: "fixture" | "expected",
  workspaceFolder?: string
): string[] {
  const rx = new RegExp(String.raw`^\s*//\s*${kind}:\s*(.+?)\s*$`, "gm");
  return [...rtlText.matchAll(rx)].map((m) =>
    path.resolve(dir, m[1].replace(/\$\{workspaceFolder\}/g, workspaceFolder ?? dir))
  );
}

/** The expected file paired with `inputPath`: a single expected serves every
 * input; otherwise the sorted lists pair positionally (plan §5, phase 4
 * item 5 — mirrors the harness convention `input_k.csv` ↔ `expected_k.csv`). */
export function pairExpected(
  inputPath: string,
  inputs: string[],
  expecteds: string[]
): string | undefined {
  if (expecteds.length === 1) {
    return expecteds[0];
  }
  const i = inputs.indexOf(inputPath);
  return i >= 0 ? expecteds[i] : undefined;
}

/** Substitute ${basename}/${dir}/${workspaceFolder} and expand a trailing
 * `*` glob segment (magic in directory segments is not supported). */
export function expandTemplate(
  template: string,
  patternPath: string,
  workspaceFolder: string | undefined
): string[] {
  const dir = path.dirname(patternPath);
  const substituted = template
    .replace(/\$\{basename\}/g, path.basename(patternPath, path.extname(patternPath)))
    .replace(/\$\{dir\}/g, dir)
    .replace(/\$\{workspaceFolder\}/g, workspaceFolder ?? dir);
  const abs = path.isAbsolute(substituted)
    ? path.normalize(substituted)
    : path.resolve(dir, substituted);

  const base = path.basename(abs);
  if (!base.includes("*")) {
    return [abs];
  }
  const parent = path.dirname(abs);
  if (parent.includes("*") || !fs.existsSync(parent)) {
    return [];
  }
  const rx = new RegExp(
    "^" + base.split("*").map(escapeRegex).join(".*") + "$"
  );
  return fs
    .readdirSync(parent)
    .filter((f) => rx.test(f))
    .sort()
    .map((f) => path.join(parent, f));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
