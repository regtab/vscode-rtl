// Assembles frames/*.png into preview.gif: 2x box-downscale, per-frame palette.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "pngjs";
import gifencPkg from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifencPkg;

const { PNG } = pkg;
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "frames");
const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();

const gif = GIFEncoder();
let W, H;
files.forEach((f, idx) => {
  const png = PNG.sync.read(readFileSync(join(dir, f)));
  const w2 = Math.floor(png.width / 2);
  const h2 = Math.floor(png.height / 2);
  W = w2; H = h2;
  const out = new Uint8Array(w2 * h2 * 4);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      let r = 0, g = 0, b = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = ((y * 2 + dy) * png.width + x * 2 + dx) * 4;
        r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2];
      }
      const o = (y * w2 + x) * 4;
      out[o] = r >> 2; out[o + 1] = g >> 2; out[o + 2] = b >> 2; out[o + 3] = 255;
    }
  }
  const palette = quantize(out, 256);
  const index = applyPalette(out, palette);
  const delay = idx === 0 ? 1600 : idx === files.length - 1 ? 3200 : 350;
  gif.writeFrame(index, w2, h2, { palette, delay });
});
gif.finish();
const bytes = gif.bytes();
writeFileSync(join(here, "preview.gif"), bytes);
console.log(`preview.gif: ${W}x${H}, ${files.length} frames, ${(bytes.length / 1024 / 1024).toFixed(2)} MB`);
