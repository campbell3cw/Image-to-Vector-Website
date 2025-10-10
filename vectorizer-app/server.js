// server.js
import express from "express";
import multer from "multer";
import sharp from "sharp";
import { Potrace } from "potrace";
import fs from "fs";
import path from "path";

const app = express();
const port = process.env.PORT || 8080;

// Middleware
app.use(express.static("."));
app.use(express.json());

// Multer setup (in-memory)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Health check for Railway
app.get("/healthz", (req, res) => {
  res.status(200).send("ok");
});

// Adaptive threshold helper
async function getAdaptiveThreshold(buffer) {
  try {
    const { data, info } = await sharp(buffer)
      .greyscale()
      .resize({ width: 200 })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = Array.from(data);
    const mean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
    const variance = pixels.reduce((a, b) => a + (b - mean) ** 2, 0) / pixels.length;
    const stdDev = Math.sqrt(variance);

    // Dynamic threshold logic
    const threshold = Math.max(60, Math.min(220, mean + stdDev * 0.5));
    return threshold;
  } catch (err) {
    console.error("Adaptive threshold failed:", err);
    return 128;
  }
}

// POST /trace endpoint
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

    // Preprocess: resize and optional blur/smooth
    let img = sharp(buffer).resize({ width: Number(long), withoutEnlargement: true }).greyscale();

    if (smooth) img = img.median(1); // reduces noise
    if (blur && Number(blur) > 0) img = img.blur(Number(blur));

    buffer = await img.toBuffer();

    // Auto-threshold if requested
    let thVal = Number(threshold);
    if (adaptive === true || adaptive === "true") {
      thVal = await getAdaptiveThreshold(buffer);
      console.log("Adaptive threshold used:", thVal);
    }

    // Binarize image for tracing
    const bwBuffer = await sharp(buffer)
      .threshold(Math.round(thVal))
      .toBuffer();

    // Vectorize using Potrace
    const options = {
      threshold: 128, // Potrace uses binary input; threshold is handled above
      turdSize: Number(omit) || 5,
      ltres: Number(ltres) || 1,
      qtres: Number(qtres) || 1,
      optTolerance: 0.2,
      color: "black",
      background: "white"
    };

    const tracer = new Potrace(options);
    const svg = await new Promise((resolve, reject) => {
      tracer.loadImage(bwBuffer, (err) => {
        if (err) return reject(err);
        tracer.getSVG((err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    });

    res.type("image/svg+xml").send(svg);
  } catch (err) {
    console.error("Trace error:", err);
    res.status(500).send("Vectorization failed");
  }
});

// Root route
app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "index.html"));
});

// Start server
app.listen(port, () => {
  console.log(`✅ At Work Uniforms Vectorizer running on port ${port}`);
});
