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

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));
const upload = multer({ storage: multer.memoryStorage() });

app.get("/healthz", (_, res) => res.send("ok"));

app.post("/trace", upload.single("image"), async (req, res) => {
  console.log("📤 /trace called");
  try {
    if (!req.file) return res.status(400).send("No image uploaded");

    const colorCount = parseInt(req.query.colors || req.body.colors || "1");
    const width = parseInt(req.query.long || req.body.long || "800");
    const tmpDir = os.tmpdir();
    const base = `trace-${Date.now()}`;
    const baseFile = path.join(tmpDir, `${base}-base.png`);

    // Step 1: Normalize & smooth
    console.log("🧩 writing base image");
    await sharp(req.file.buffer)
      .resize({ width, withoutEnlargement: true })
      .greyscale(false)
      .median(1)
      .png()
      .toFile(baseFile);

    // ---- Single Color (current working path) ----
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

    // ---- Multi-color mode (stable fallback) ----
    console.log(`🎨 multi-color mode (${colorCount} colors)`);

    const { data, info } = await sharp(baseFile)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Convert RGB to brightness for segmentation
    const grayscale = [];
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      grayscale.push(0.299 * r + 0.587 * g + 0.114 * b);
    }

    // Build thresholds evenly across brightness range
    const min = Math.min(...grayscale);
    const max = Math.max(...grayscale);
    const step = (max - min) / colorCount;
    const bands = [];
    for (let i = 0; i < colorCount; i++) {
      bands.push([min + step * i, min + step * (i + 1)]);
    }

    const layers = [];

    for (let i = 0; i < bands.length; i++) {
      const [low, high] = bands[i];
      console.log(`🔹 band ${i + 1}: ${low.toFixed(1)}–${high.toFixed(1)}`);
      const mask = Buffer.alloc(info.width * info.height * 3);

      for (let p = 0; p < grayscale.length; p++) {
        const bright = grayscale[p];
        const val = bright >= low && bright < high ? 255 : 0;
        mask[p * 3] = mask[p * 3 + 1] = mask[p * 3 + 2] = val;
      }

      const maskFile = path.join(tmpDir, `${base}-band${i}.png`);
      await sharp(mask, {
        raw: { width: info.width, height: info.height, channels: 3 },
      })
        .png()
        .toFile(maskFile);

      const hue = Math.round((360 / colorCount) * i);
      const fillColor = `hsl(${hue},90%,40%)`;

      const svgPart = await new Promise((resolve, reject) => {
        potrace.trace(
          maskFile,
          { color: fillColor, background: "transparent", turdSize: 5 },
          (err, svg) => {
            fs.unlink(maskFile, () => {});
            if (err) reject(err);
            else resolve(svg);
          }
        );
      });

      const inner = svgPart.replace(/<\/?svg[^>]*>/g, "");
      layers.push(inner);
    }

    fs.unlink(baseFile, () => {});
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${width}">
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
