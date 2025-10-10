// server.js
import express from "express";
import multer from "multer";
import sharp from "sharp";
import { Potrace } from "potrace";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;

// Serve all static files from /public
app.use(express.static(path.join(__dirname, "public")));

// Multer (in-memory)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Health check endpoint for Railway
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
    const threshold = Math.max(60, Math.min(220, mean + stdDev * 0.5));
    return threshold;
  } catch (err) {
    console.error("Adaptive threshold failed:", err);
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

    // Adaptive thresholding
    let thVal = Number(threshold);
    if (adaptive === true || adaptive === "true") {
      thVal = await getAdaptiveThreshold(buffer);
      console.log("Adaptive threshold used:", thVal);
    }

    const bwBuffer = await sharp(buffer).threshold(Math.round(thVal)).toBuffer();

    // Potrace vectorization options
    const options = {
      threshold: 128,
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

// --- Serve index.html for all other routes ---
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Start server ---
app.listen(port, () => {
  console.log(`✅ At Work Uniforms Vectorizer running on port ${port}`);
});
