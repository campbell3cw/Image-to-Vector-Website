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
  try {
    if (!req.file) return res.status(400).send("No image uploaded");

    const colorCount = parseInt(req.query.colors || req.body.colors || "1");
    const width = parseInt(req.query.long || req.body.long || "800");
    const tmpDir = os.tmpdir();
    const base = `trace-${Date.now()}`;
    const baseFile = path.join(tmpDir, `${base}-base.png`);

    // Save normalized PNG
    await sharp(req.file.buffer)
      .resize({ width, withoutEnlargement: true })
      .toColorspace("srgb")
      .png()
      .toFile(baseFile);

    // ---- 1-bit trace (old behaviour) ----
    if (colorCount <= 1) {
      potrace.trace(
        baseFile,
        { color: "black", background: "white", turdSize: 5 },
        (err, svg) => {
          fs.unlink(baseFile, () => {});
          if (err) return res.status(500).send("Trace error");
          res.type("image/svg+xml").send(svg);
        }
      );
      return;
    }

    // ---- Multi-colour trace ----
    // reduce to N colours using posterize
    const quantBuf = await sharp(baseFile).posterize(colorCount).toBuffer();
    const { data, info } = await sharp(quantBuf)
      .raw()
      .toBuffer({ resolveWithObject: true });

    // build colour palette
    const seen = new Set();
    const palette = [];
    for (let i = 0; i < data.length; i += info.channels) {
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      if (!seen.has(key)) {
        seen.add(key);
        palette.push(key);
        if (palette.length >= colorCount) break;
      }
    }
    console.log("🎨 palette", palette);

    const layers = [];
    for (const color of palette) {
      const [r, g, b] = color.split(",").map(Number);
      const mask = Buffer.alloc(data.length);
      for (let i = 0; i < data.length; i += info.channels) {
        const diff =
          Math.abs(data[i] - r) +
          Math.abs(data[i + 1] - g) +
          Math.abs(data[i + 2] - b);
        const val = diff < 40 ? 255 : 0;
        mask[i] = mask[i + 1] = mask[i + 2] = val;
      }

      const maskFile = path.join(tmpDir, `${base}-${r}-${g}-${b}.png`);
      await sharp(mask, {
        raw: { width: info.width, height: info.height, channels: 3 },
      })
        .png()
        .toFile(maskFile);

      const svgPart = await new Promise((resolve, reject) => {
        potrace.trace(
          maskFile,
          { color: `rgb(${r},${g},${b})`, background: "transparent", turdSize: 5 },
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${width}">
      ${layers.join("\n")}
    </svg>`;

    res.type("image/svg+xml").send(svg);
  } catch (err) {
    console.error("🔥 trace error:", err);
    res.status(500).send("Vectorization failed");
  }
});

app.get("*", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

app.listen(port, () =>
  console.log(`🚀 Vectorizer running on port ${port}`)
);
