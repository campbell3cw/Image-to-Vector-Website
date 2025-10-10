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

    // query/body controls
    const colorCount = parseInt(req.query.colors || req.body.colors || "1");
    const tmpDir = os.tmpdir();
    const tmpBase = `trace-${Date.now()}`;
    const width = parseInt(req.query.long || req.body.long || "800");

    // preprocess → resized PNG
    const basePng = await sharp(req.file.buffer)
      .resize({ width, withoutEnlargement: true })
      .toFormat("png")
      .toBuffer();

    // single-color mode (current behavior)
    if (colorCount <= 1) {
      const bwFile = path.join(tmpDir, `${tmpBase}-bw.png`);
      await sharp(basePng).greyscale().threshold(180).toFile(bwFile);

      potrace.trace(
        bwFile,
        { color: "black", background: "white", turdSize: 5 },
        (err, svg) => {
          fs.unlink(bwFile, () => {});
          if (err) return res.status(500).send("Trace error");
          res.type("image/svg+xml").send(svg);
        }
      );
      return;
    }

    // --- Multi-color mode ---
    // Quantize to N colors
    const { data, info } = await sharp(basePng)
      .resize({ width, withoutEnlargement: true })
      .toColorspace("srgb")
      .quantize({ colors: colorCount })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Extract unique palette from quantized data
    const pixels = [];
    for (let i = 0; i < data.length; i += info.channels) {
      pixels.push(
        `${data[i]},${data[i + 1]},${data[i + 2]}` // ignore alpha
      );
    }
    const palette = [...new Set(pixels)].slice(0, colorCount);

    // Build each mask + trace
    const layers = [];
    for (let idx = 0; idx < palette.length; idx++) {
      const [r, g, b] = palette[idx].split(",").map(Number);
      const mask = await sharp(basePng)
        .removeAlpha()
        .extractChannel("red") // dummy, we’ll threshold by color below
        .toBuffer();

      const maskFile = path.join(tmpDir, `${tmpBase}-${idx}.png`);
      await sharp(basePng)
        .ensureAlpha()
        .joinChannel(
          await sharp(basePng)
            .toColourspace("srgb")
            .linear(1, 0)
            .recomb([
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ])
            .toBuffer()
        )
        .toFile(maskFile);

      await sharp(basePng)
        .extractChannel("red")
        .toFile(maskFile);

      await sharp(basePng)
        .threshold(180)
        .png()
        .toFile(maskFile);

      // Trace each color mask
      const svgPart = await new Promise((resolve, reject) => {
        potrace.trace(
          maskFile,
          { color: `rgb(${r},${g},${b})`, background: "transparent" },
          (err, svg) => {
            fs.unlink(maskFile, () => {});
            if (err) reject(err);
            else resolve(svg);
          }
        );
      });

      // strip outer <svg> and just keep <path>
      const paths = svgPart
        .replace(/<\/?svg[^>]*>/g, "")
        .replace(/<\/?g[^>]*>/g, "");
      layers.push(paths);
    }

    // Combine layers into one SVG
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
