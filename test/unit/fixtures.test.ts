import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  directivePaths,
  expandTemplate,
  pairExpected,
} from "../../client/src/fixturesCore";

describe("directivePaths", () => {
  const dir = path.resolve("/proj/solutions");

  it("resolves fixture and expected directives against the pattern dir", () => {
    const text = "// fixture: ../data/in.csv\n// expected: ../data/out.csv\n[ [VAL] ]";
    assert.deepStrictEqual(directivePaths(text, dir, "fixture"), [
      path.resolve(dir, "../data/in.csv"),
    ]);
    assert.deepStrictEqual(directivePaths(text, dir, "expected"), [
      path.resolve(dir, "../data/out.csv"),
    ]);
  });

  it("keeps directive order and ignores non-directive comments", () => {
    const text = "// fixture: a.csv\n// just a comment\n  //fixture: b.csv\n";
    assert.deepStrictEqual(directivePaths(text, dir, "fixture"), [
      path.join(dir, "a.csv"),
      path.join(dir, "b.csv"),
    ]);
    assert.deepStrictEqual(directivePaths(text, dir, "expected"), []);
  });

  it("substitutes ${workspaceFolder} when given", () => {
    const ws = path.resolve("/proj");
    const text = "// fixture: ${workspaceFolder}/data/in.csv";
    assert.deepStrictEqual(directivePaths(text, dir, "fixture", ws), [
      path.join(ws, "data", "in.csv"),
    ]);
  });

  it("falls back to the pattern dir for ${workspaceFolder} outside a workspace", () => {
    const text = "// fixture: ${workspaceFolder}/data/in.csv";
    assert.deepStrictEqual(directivePaths(text, dir, "fixture"), [
      path.join(dir, "data", "in.csv"),
    ]);
  });
});

describe("pairExpected", () => {
  const inputs = ["/f/input_1.csv", "/f/input_2.csv", "/f/input_3.csv"];
  const expecteds = ["/f/expected_1.csv", "/f/expected_2.csv", "/f/expected_3.csv"];

  it("pairs sorted lists positionally", () => {
    assert.strictEqual(pairExpected(inputs[1], inputs, expecteds), expecteds[1]);
  });

  it("a single expected file serves every input", () => {
    assert.strictEqual(pairExpected(inputs[2], inputs, ["/f/gold.csv"]), "/f/gold.csv");
  });

  it("an input outside the list gets no expected", () => {
    assert.strictEqual(pairExpected("/elsewhere.csv", inputs, expecteds), undefined);
  });
});

describe("expandTemplate", () => {
  let dir: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtl-fixtures-"));
    for (const f of ["input_1.csv", "input_2.csv", "expected_1.csv", "expected_2.csv"]) {
      fs.writeFileSync(path.join(dir, f), "");
    }
  });

  it("substitutes ${basename} and ${dir}", () => {
    const pattern = path.join(dir, "task_001.rtl");
    assert.deepStrictEqual(expandTemplate("${dir}/${basename}.csv", pattern, undefined), [
      path.join(dir, "task_001.csv"),
    ]);
  });

  it("expands a trailing * glob to sorted existing files", () => {
    const pattern = path.join(dir, "task.rtl");
    assert.deepStrictEqual(expandTemplate("${dir}/input_*.csv", pattern, undefined), [
      path.join(dir, "input_1.csv"),
      path.join(dir, "input_2.csv"),
    ]);
    assert.deepStrictEqual(expandTemplate("${dir}/expected_*.csv", pattern, undefined), [
      path.join(dir, "expected_1.csv"),
      path.join(dir, "expected_2.csv"),
    ]);
  });

  it("uses ${workspaceFolder} when given", () => {
    const pattern = path.join(dir, "sub", "task.rtl");
    assert.deepStrictEqual(
      expandTemplate("${workspaceFolder}/input_*.csv", pattern, dir),
      [path.join(dir, "input_1.csv"), path.join(dir, "input_2.csv")]
    );
  });

  it("applies a snippet-style ${basename/…/…/} transform", () => {
    const pattern = path.join(dir, "RtlTask001Test.java");
    assert.deepStrictEqual(
      expandTemplate("${dir}/${basename/RtlTask(.+)Test/task_$1/}.csv", pattern, undefined),
      [path.join(dir, "task_001.csv")]
    );
  });

  it("supports transform flags and escaped slashes", () => {
    const pattern = path.join(dir, "a-b-c.rtl");
    assert.deepStrictEqual(
      expandTemplate("${dir}/${basename/-/_/g}.csv", pattern, undefined),
      [path.join(dir, "a_b_c.csv")]
    );
    assert.deepStrictEqual(
      expandTemplate("${dir}/${basename/a\\/x/y/}.csv", pattern, undefined),
      [path.join(dir, "a-b-c.csv")] // pattern "a/x" does not match — basename unchanged
    );
  });

  it("leaves an invalid transform regex untouched in the path", () => {
    const pattern = path.join(dir, "task.rtl");
    const out = expandTemplate("${dir}/${basename/(/x/}.csv", pattern, undefined);
    assert.strictEqual(out.length, 1);
    assert.ok(out[0].includes("${basename")); // separators may be normalized
  });
});
