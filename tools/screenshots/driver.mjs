// Minimal CDP driver for the VS Code extension-dev-host window.
// Usage: node driver.mjs <step> [args] [<step> [args] ...]
// Steps:
//   bounds <w> <h>          - resize the OS window
//   palette <command name>  - run a command via Ctrl+Shift+P
//   quickopen <file name>   - open a file via Ctrl+P
//   keys <combo>            - e.g. ctrl+shift+m, ctrl+b, escape, enter
//   type <text>             - insert text into the focused control
//   sleep <ms>
//   shot <file.png>         - capture the page as PNG
import { writeFileSync } from "node:fs";

const PORT = process.env.CDP_PORT ?? "9333";

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(typeof e.data === "string" ? e.data : e.data.toString());
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    };
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error(`cannot connect ${url}`));
    });
    return new Cdp(ws);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
}

const VK = {
  enter: 13, escape: 27, space: 32, tab: 9, down: 40, up: 38,
  left: 37, right: 39, end: 35, home: 36, backspace: 8, delete: 46,
  a: 65, b: 66, c: 67, d: 68, e: 69, f: 70, g: 71, h: 72, i: 73, j: 74,
  k: 75, l: 76, m: 77, n: 78, o: 79, p: 80, q: 81, r: 82, s: 83, t: 84,
  u: 85, v: 86, w: 87, x: 88, y: 89, z: 90,
};
const KEYNAME = { enter: "Enter", escape: "Escape", space: " ", tab: "Tab", down: "ArrowDown", up: "ArrowUp", left: "ArrowLeft", right: "ArrowRight", end: "End", home: "Home", backspace: "Backspace", delete: "Delete" };
const CODE = { enter: "Enter", escape: "Escape", space: "Space", tab: "Tab", down: "ArrowDown", up: "ArrowUp", left: "ArrowLeft", right: "ArrowRight", end: "End", home: "Home", backspace: "Backspace", delete: "Delete" };

async function main() {
  const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && /workbench\.html/.test(t.url));
  if (!page) throw new Error("workbench page target not found: " + JSON.stringify(list.map((t) => t.url)));
  const cdp = await Cdp.connect(ver.webSocketDebuggerUrl);
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.id, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const keyCombo = async (combo) => {
    const parts = combo.toLowerCase().split("+");
    const name = parts.pop();
    let modifiers = 0;
    for (const m of parts) modifiers |= { alt: 1, ctrl: 2, meta: 4, shift: 8 }[m];
    const vk = VK[name];
    const key = KEYNAME[name] ?? (modifiers & 8 ? name.toUpperCase() : name);
    const code = CODE[name] ?? "Key" + name.toUpperCase();
    const base = { modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, key, code };
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base }, sessionId);
    if (name === "enter")
      await cdp.send("Input.dispatchKeyEvent", { type: "char", text: "\r", ...base }, sessionId);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base }, sessionId);
  };

  const steps = process.argv.slice(2);
  for (let i = 0; i < steps.length; ) {
    const step = steps[i++];
    if (step === "bounds") {
      const [w, h] = [Number(steps[i++]), Number(steps[i++])];
      const { windowId } = await cdp.send("Browser.getWindowForTarget", { targetId: page.id });
      await cdp.send("Browser.setWindowBounds", { windowId, bounds: { left: 60, top: 40, width: w, height: h } });
    } else if (step === "palette" || step === "quickopen") {
      await keyCombo(step === "palette" ? "ctrl+shift+p" : "ctrl+p");
      await sleep(500);
      await cdp.send("Input.insertText", { text: steps[i++] }, sessionId);
      await sleep(700);
      await keyCombo("enter");
      await sleep(300);
    } else if (step === "keys") {
      await keyCombo(steps[i++]);
      await sleep(200);
    } else if (step === "click") {
      const [x, y] = [Number(steps[i++]), Number(steps[i++])];
      for (const type of ["mousePressed", "mouseReleased"])
        await cdp.send(
          "Input.dispatchMouseEvent",
          { type, x, y, button: "left", buttons: 1, clickCount: 1 },
          sessionId
        );
      await sleep(300);
    } else if (step === "dblclick") {
      const [x, y] = [Number(steps[i++]), Number(steps[i++])];
      for (const clickCount of [1, 2]) {
        for (const type of ["mousePressed", "mouseReleased"])
          await cdp.send(
            "Input.dispatchMouseEvent",
            { type, x, y, button: "left", buttons: 1, clickCount },
            sessionId
          );
        await sleep(80);
      }
      await sleep(300);
    } else if (step === "wheel") {
      const [x, y, dy] = [Number(steps[i++]), Number(steps[i++]), Number(steps[i++])];
      await cdp.send(
        "Input.dispatchMouseEvent",
        { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy },
        sessionId
      );
      await sleep(400);
    } else if (step === "type") {
      await cdp.send("Input.insertText", { text: steps[i++] }, sessionId);
    } else if (step === "sleep") {
      await sleep(Number(steps[i++]));
    } else if (step === "shot") {
      const file = steps[i++];
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
      writeFileSync(file, Buffer.from(data, "base64"));
      console.log("saved", file);
    } else {
      throw new Error("unknown step: " + step);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
