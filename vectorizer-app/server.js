import express from "express";
import multer from "multer";
import fs from "fs";
import sharp from "sharp";
import { trace } from "@luncheon/potrace-wasm";

const app = express();
const upload = multer({ dest: "uploads/" });

// Ensure uploads dir exists in Docker/container
fs.mkdirSync("uploads", { recursive: true });

// Light CSP so blob/data URLs and inline styles/scripts work
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy",
    "default-src 'self' blob: data: https:; " +
    "img-src 'self' blob: data: https:; " +
    "script-src 'self' 'unsafe-inline' blob: data: https:; " +
    "style-src 'self' 'unsafe-inline' blob: data: https:; " +
    "font-src 'self' data: https:; connect-src 'self' blob: data: https:; " +
    "object-src 'none'; base-uri 'self';");
  next();
});

app.use(express.static("public"));

app.get("/healthz", (req, res) => res.json({ ok: true }));

// Vectorization endpoint with tunable params
app.post("/trace", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send("No image uploaded");

    const th   = Number(req.query.th   ?? 180); // threshold 0..255
    const blur = Number(req.query.blur ?? 1.0); // gaussian-ish blur radius
    const long = Number(req.query.long ?? 800); // preprocess long side
    const omit = Number(req.query.omit ?? 5);   // turdSize (drop tiny blobs)

    const src = req.file.path;
    const pre = src + "-pre.png";

    // Preprocess: resize -> grayscale -> threshold -> blur
    const meta = await sharp(src).metadata();
    const w = meta.width || 0, h = meta.height || 0;
    const resizeOpts = (w >= h) ? { width: Math.min(long, w) } : { height: Math.min(long, h) };

    await sharp(src)
      .resize({ ...resizeOpts, fit: "inside", withoutEnlargement: true })
      .grayscale()
      .threshold(th)
      .blur(blur)
      .toFile(pre);

    const svg = await trace(pre, {
      threshold: th,
      turdSize: omit,
      turnPolicy: "black",
      optCurve: true,
      optTolerance: 0.3,
      color: "black",
      background: "white"
    });

    fs.unlink(src, () => {});
    fs.unlink(pre, () => {});

    res.type("image/svg+xml").send(svg);
  } catch (err) {
    console.error("Vectorization failed:", err);
    res.status(500).send("Vectorization failed.");
  }
});

// Fallback to index
app.get("*", (req, res) => res.sendFile(process.cwd() + "/public/index.html"));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Vector tool running on", port));
