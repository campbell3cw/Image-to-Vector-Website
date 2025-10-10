// server.js
import express from "express";
import multer from "multer";
import sharp from "sharp";
import { Potrace } from "potrace";
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

const storage = multer.memoryStorage();
const upload = multer({ storage });

// Health check
app.get("/healthz", (req, res) => res.status(200).send("ok"));

// --- Adaptive threshold helper ---
async function getAdaptiveThreshold(buffer) {
  try {
    const { data } = await sharp(buffer)
      .greyscale()
      .resize({ width: 200 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = Array.from(data);
    const mean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
    const variance = pixels.reduce((a, b) => a + (b - mean) ** 2, 0) / pixels.length;
    const stdDev = Math.sqrt(variance);
    return Math.max(60, Math.min(220, mean + stdDev * 0.5));
  } catch {
    return 128;
  }
}

// --- POST /trace ---
app.post("/trace", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send("No image uploaded");

    const {
      threshold = 180,
      blur = 0,
      omit = 5,
      ltres = 0.8,
      qtres = 1.0,
      long = 800,
      adaptive = true,
      smooth = true
    } = req.body;

    let buffer = req.file.buffer;
    let img = sharp(buffer).resize({ width: Number(long), withoutEnlargement: true }).greyscale();
    if (smooth) img = img.median(1);
    if (blur && Number(blur) > 0) img = img.blur(Number(blur));
    buffer = await img.toBuffer();

    // Compute adaptive threshold if enabled
    let thVal = Number(threshold);
    if (adaptive === true || adaptive === "true") {
      thVal = await getAdaptiveThreshold(buffer);
      console.log("Adaptive threshold used:", thVal);
    }

    // Convert to PNG so Potrace can read it properly
    const pngBuffer = await sharp(buffer)
      .threshold(Math.round(thVal))
      .png()
      .toBuffer();

    // Write to temporary file for Potrace
    const tmpFile = path.join(os.tmpdir(), `trace-${Date.now()}.png`);
    await fs.promises.writeFile(tmpFile, pngBuffer);

    const options = {
      threshold: 128,
      turdSize: Number(omit) || 5,
      ltres: Number(ltres) || 1,
      qtres: Number(qtres) || 1,
      optTolerance: 0.2,
      color: "black",
      background: "white"
    };

    // Run Potrace on the PNG file
    const tracer = new Potrace(options);
    const svg = await new Promise((resolve, reject) => {
      tracer.loadImage(tmpFile, (err) => {
        if (err) return reject(err);
        tracer.getSVG((err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    });

    // Cleanup tmp file
    fs.promises.unlink(tmpFile).catch(() => {});

    res.type("image/svg+xml").send(svg);
  } catch (err) {
    console.error("Trace error:", err);
    res.status(500).send("Vectorization failed");
  }
});

// Fallback to index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`✅ At Work Uniforms Vectorizer running on port ${port}`);
});
