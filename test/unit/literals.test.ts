import * as assert from "assert";
import {
  findRtlLiterals,
  stripTextBlockIndent,
  unescapeCommon,
} from "../../client/src/literals";

describe("findRtlLiterals — Python", () => {
  it("double-quoted single-line compile()", () => {
    const lits = findRtlLiterals(`p = RtlCompiler.compile("[ [VAL] ]")`, "python");
    assert.strictEqual(lits.length, 1);
    assert.strictEqual(lits[0].text, "[ [VAL] ]");
    assert.strictEqual(lits[0].form, "compile(…)");
  });

  it("triple-quoted block keeps newlines", () => {
    const src = 'x = RtlCompiler.compile("""\n[ [ATTR]+ ]\n[ [VAL]+ ]+\n""")';
    const lits = findRtlLiterals(src, "python");
    assert.strictEqual(lits.length, 1);
    assert.strictEqual(lits[0].text, "\n[ [ATTR]+ ]\n[ [VAL]+ ]+\n");
  });

  it("unescapes a non-raw literal", () => {
    // Python source: compile("'\\d+'->REC") — the \\d is an escaped backslash.
    const lits = findRtlLiterals('RtlCompiler.compile("\'\\\\d+\'")', "python");
    assert.strictEqual(lits[0].text, "'\\d+'");
  });

  it("keeps a raw literal verbatim", () => {
    const lits = findRtlLiterals(`RtlCompiler.compile(r"'\\d+'")`, "python");
    assert.strictEqual(lits[0].text, "'\\d+'");
  });

  it("finds multiple literals in order", () => {
    const src =
      'RtlCompiler.compile("[ [A] ]")\nRtlCompiler.compile(\'[ [B] ]\')';
    const lits = findRtlLiterals(src, "python");
    assert.deepStrictEqual(
      lits.map((l) => l.text),
      ["[ [A] ]", "[ [B] ]"]
    );
  });

  it("ignores an unterminated single-line literal", () => {
    assert.strictEqual(findRtlLiterals(`RtlCompiler.compile("[ [VAL]`, "python").length, 0);
  });
});

describe("findRtlLiterals — Java", () => {
  it("text block strips incidental indentation", () => {
    const src = [
      "String p = RtlCompiler.compile(\"\"\"",
      "        [ [ATTR]+ ]",
      "        [ [VAL]+ ]+",
      "        \"\"\");",
    ].join("\n");
    const lits = findRtlLiterals(src, "java");
    assert.strictEqual(lits.length, 1);
    assert.strictEqual(lits[0].text, "[ [ATTR]+ ]\n[ [VAL]+ ]+");
  });

  it("@RtlSource annotation, value= form", () => {
    const lits = findRtlLiterals(`@RtlSource(value = "[ [VAL] ]")`, "java");
    assert.strictEqual(lits.length, 1);
    assert.strictEqual(lits[0].form, "@RtlSource(…)");
    assert.strictEqual(lits[0].text, "[ [VAL] ]");
  });

  it("language=RTL marker before a string", () => {
    const lits = findRtlLiterals(`var s = /* language=RTL */ "[ [VAL] ]";`, "java");
    assert.strictEqual(lits[0].form, "language=RTL");
  });

  it("does not double-count a text block as a single-quote hit", () => {
    const src = 'RtlCompiler.compile("""\n[ [VAL] ]\n""")';
    assert.strictEqual(findRtlLiterals(src, "java").length, 1);
  });
});

describe("unescapeCommon", () => {
  it("translates known escapes and keeps unknown ones verbatim", () => {
    assert.strictEqual(unescapeCommon("a\\nb\\tc"), "a\nb\tc");
    assert.strictEqual(unescapeCommon('\\"q\\"'), '"q"');
    assert.strictEqual(unescapeCommon("\\\\d+"), "\\d+"); // escaped backslash
    assert.strictEqual(unescapeCommon("\\w"), "\\w"); // unknown kept
  });

  it("treats a trailing backslash-newline as a line continuation", () => {
    assert.strictEqual(unescapeCommon("a\\\nb"), "ab");
  });
});

describe("stripTextBlockIndent", () => {
  it("uses the minimum indent and drops the closing-line indent", () => {
    const content = "\n    a\n      b\n    ";
    assert.strictEqual(stripTextBlockIndent(content), "a\n  b");
  });

  it("handles a zero-indent block", () => {
    assert.strictEqual(stripTextBlockIndent("\nx\ny\n"), "x\ny");
  });
});
