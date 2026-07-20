// Records the hero GIF scenario: broken quantifier {2} -> fix to {3},
// capturing frames while the preview re-renders. Frames go to frames/.
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.CDP_PORT ?? "9333";

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && /workbench\.html/.test(t.url));
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(typeof e.data === "string" ? e.data : e.data.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
};
const send = (method, params = {}, sessionId) => {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  return new Promise((r) => pending.set(i, r));
};
const { sessionId } = await send("Target.attachToTarget", { targetId: page.id, flatten: true });
await send("Page.enable", {}, sessionId);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const frames = [];
let recording = true;
const recorder = (async () => {
  while (recording && frames.length < 40) {
    const t = Date.now();
    const { data } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
    frames.push({ t, data });
    const spent = Date.now() - t;
    await sleep(Math.max(0, 350 - spent));
  }
})();

const key = async (name, modifiers = 0) => {
  const vk = { end: 35, left: 37 }[name];
  const keyName = { end: "End", left: "ArrowLeft" }[name];
  const base = { modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, key: keyName, code: keyName === "End" ? "End" : "ArrowLeft" };
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base }, sessionId);
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base }, sessionId);
};

// Scenario. The editor shows quarterly.rtl (3 lines, ends with "}+"), the
// preview panel on the right shows the degraded match for {2}.
await sleep(1600);
// Double-click the "2" in "{2}" to select it, then type the replacement.
for (const clickCount of [1, 2]) {
  for (const type of ["mousePressed", "mouseReleased"])
    await send("Input.dispatchMouseEvent", { type, x: 366, y: 128, button: "left", buttons: 1, clickCount }, sessionId);
  await sleep(80);
}
await sleep(900);
await send("Input.insertText", { text: "3" }, sessionId);
// Debounced preview refresh + render.
await sleep(3200);
recording = false;
await recorder;

mkdirSync(join(here, "frames"), { recursive: true });
frames.forEach((f, i) => {
  writeFileSync(join(here, "frames", `frame_${String(i).padStart(3, "0")}.png`), Buffer.from(f.data, "base64"));
});
console.log("frames:", frames.length);
process.exit(0);
