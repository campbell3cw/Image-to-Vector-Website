// server.js
import express from "express";
import multer from "multer";
import sharp from "sharp";
import potrace from "potrace";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;

app.use(express.static(path.join(__dirname, "public")));
const upload = multer({ storage: multer.memoryStorage() });

app.get("/healthz", (_, res) => res.send("ok"));

app.post("/trace", upload.single("image"), async (req, res) => {
  console.log("📤 /trace called");
  try {
    if (!req.file) return res.status(400).send("No image uploaded");

    const colorCount = parseInt(req.query.colors || req.body.colors || "1");
    const targetWidth = parseInt(req.query.long || req.body.long || "800");
    const tmpDir = os.tmpdir();
    const base = `trace-${Date.now()}`;
    const baseFile = path.join(tmpDir, `${base}-base.png`);

    // --- Step 1: normalize & resize while keeping aspect ratio ---
    const meta = await sharp(req.file.buffer).metadata();
    const aspect = meta.width / meta.height;
    const targetHeight = Math.round(targetWidth / aspect);

    await sharp(req.file.buffer)
      .resize({ width: targetWidth, height: targetHeight, withoutEnlargement: true })
      .toColorspace("srgb")
      .median(1)
      .png()
      .toFile(baseFile);

    // ---- Single color (unchanged) ----
    if (colorCount <= 1) {
      console.log("🖤 single-color mode");
      potrace.trace(
        baseFile,
        { color: "black", background: "white", turdSize: 5 },
        (err, svg) => {
          fs.unlink(baseFile, () => {});
          if (err) {
            console.error("Potrace error:", err);
            return res.status(500).send("Trace error");
          }
          res.type("image/svg+xml").send(svg);
        }
      );
      return;
    }

    // ---- Multi-color improved ----
    console.log(`🎨 multi-color mode (${colorCount} colors)`);

    const { data, info } = await sharp(baseFile)
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Build brightness map + store rgb for sampling
    const pxCount = info.width * info.height;
    const gray = new Float32Array(pxCount);
    const rgb = new Array(pxCount);
    for (let i = 0, p = 0; i < data.length; i += info.channels, p++) {
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      gray[p] = 0.299 * r + 0.587 * g + 0.114 * b;
      rgb[p] = [r, g, b];
    }

    const min = Math.min(...gray);
    const max = Math.max(...gray);
    const step = (max - min) / colorCount;

    const bands = [];
    for (let i = 0; i < colorCount; i++) {
      bands.push([min + step * i, min + step * (i + 1)]);
    }

    const layers = [];

    for (let i = 0; i < bands.length; i++) {
      const [low, high] = bands[i];
      const mask = Buffer.alloc(pxCount * 3);

      let rSum = 0,
        gSum = 0,
        bSum = 0,
        n = 0;
      for (let p = 0; p < pxCount; p++) {
        const val = gray[p];
        if (val >= low && val < high) {
          mask[p * 3] = mask[p * 3 + 1] = mask[p * 3 + 2] = 255;
          const [r, g, b] = rgb[p];
          rSum += r;
          gSum += g;
          bSum += b;
          n++;
        } else {
          mask[p * 3] = mask[p * 3 + 1] = mask[p * 3 + 2] = 0;
        }
      }

      const avgColor =
        n > 0
          ? `rgb(${Math.round(rSum / n)},${Math.round(gSum / n)},${Math.round(
              bSum / n
            )})`
          : `hsl(${(360 / colorCount) * i},80%,40%)`;

      const maskFile = path.join(tmpDir, `${base}-band${i}.png`);
      await sharp(mask, {
        raw: { width: info.width, height: info.height, channels: 3 },
      })
        .png()
        .toFile(maskFile);

      const svgPart = await new Promise((resolve, reject) => {
        potrace.trace(
          maskFile,
          { color: avgColor, background: "transparent", turdSize: 5 },
          (err, svg) => {
            fs.unlink(maskFile, () => {});
            if (err) reject(err);
            else resolve(svg);
          }
        );
      });

      layers.push(svgPart.replace(/<\/?svg[^>]*>/g, ""));
    }

    fs.unlink(baseFile, () => {});
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${info.width} ${info.height}">
      ${layers.join("\n")}
    </svg>`;

    console.log("✅ finished multi-color trace");
    res.type("image/svg+xml").send(svg);
  } catch (err) {
    console.error("🔥 trace exception:", err);
    res.status(500).send("Vectorization failed");
  }
});

app.get("*", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

app.listen(port, () => {
  console.log(`🚀 Vectorizer running on port ${port}`);
});
