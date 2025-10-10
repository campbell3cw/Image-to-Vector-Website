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
    const width = parseInt(req.query.long || req.body.long || "800");
    const tmpDir = os.tmpdir();
    const tmpBase = `trace-${Date.now()}`;
    const tmpPng = path.join(tmpDir, `${tmpBase}-base.png`);

    // --- Step 1: normalize image ---
    await sharp(req.file.buffer)
      .resize({ width, withoutEnlargement: true })
      .toColorspace("srgb")
      .png({ palette: true })
      .toFile(tmpPng);

    // --- Step 2: single-color trace (old behavior) ---
    if (colorCount <= 1) {
      potrace.trace(
        tmpPng,
        { color: "black", background: "white", turdSize: 5 },
        (err, svg) => {
          fs.unlink(tmpPng, () => {});
          if (err) {
            console.error("Potrace error:", err);
            return res.status(500).send("Trace error");
          }
          res.type("image/svg+xml").send(svg);
        }
      );
      return;
    }

    // --- Step 3: multi-color trace ---
    // Reduce to N colors using posterize
    const quantBuf = await sharp(tmpPng)
      .modulate({ brightness: 1, saturation: 1 })
      .posterize(colorCount)
      .toBuffer();

    // Extract unique colors (simple sampling)
    const { data, info } = await sharp(quantBuf)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const unique = new Set();
    for (let i = 0; i < data.length; i += info.channels) {
      unique.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    const palette = Array.from(unique).slice(0, colorCount);
    console.log("🎨 Palette:", palette);

    // Build mask + trace for each color
    const layers = [];
    for (const color of palette) {
      const [r, g, b] = color.split(",").map(Number);
      const maskFile = path.join(tmpDir, `${tmpBase}-${r}-${g}-${b}.png`);

      // isolate one color as white, rest black
      const maskBuf = await sharp(quantBuf)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const pixels = maskBuf.data;
      const ch = maskBuf.info.channels;
      const out = Buffer.alloc(pixels.length);
      for (let i = 0; i < pixels.length; i += ch) {
        const diff =
          Math.abs(pixels[i] - r) +
          Math.abs(pixels[i + 1] - g) +
          Math.abs(pixels[i + 2] - b);
        const val = diff < 30 ? 255 : 0;
        out[i] = out[i + 1] = out[i + 2] = val;
      }

      await sharp(out, {
        raw: { width: maskBuf.info.width, height: maskBuf.info.height, channels: 3 },
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

      const paths = svgPart.replace(/<\/?svg[^>]*>/g, "");
      layers.push(paths);
    }

    fs.unlink(tmpPng, () => {});
    const finalSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${width}">
      ${layers.join("\n")}
    </svg>`;

    res.type("image/svg+xml").send(finalSvg);
  } catch (err) {
    console.error("🔥 Trace exception:", err);
    res.status(500).send("Vectorization failed");
  }
});

app.get("*", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

app.listen(port, () =>
  console.log(`🚀 Vectorizer running on port ${port}`)
);
