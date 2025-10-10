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

function kmeans(pixels, k, maxIter = 8) {
  // pixels: array of [r,g,b]
  const centroids = [];
  for (let i = 0; i < k; i++) {
    centroids.push(pixels[Math.floor(Math.random() * pixels.length)]);
  }

  for (let iter = 0; iter < maxIter; iter++) {
    const clusters = Array.from({ length: k }, () => []);
    for (const p of pixels) {
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < k; i++) {
        const [r, g, b] = centroids[i];
        const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      clusters[best].push(p);
    }
    for (let i = 0; i < k; i++) {
      if (clusters[i].length === 0) continue;
      const avg = [0, 0, 0];
      for (const p of clusters[i]) {
        avg[0] += p[0];
        avg[1] += p[1];
        avg[2] += p[2];
      }
      centroids[i] = avg.map((v) => v / clusters[i].length);
    }
  }
  return centroids;
}

app.post("/trace", upload.single("image"), async (req, res) => {
  console.log("📤 /trace called");
  try {
    if (!req.file) return res.status(400).send("No image uploaded");

    const colorCount = Math.max(
      1,
      Math.min(parseInt(req.query.colors || req.body.colors || "1"), 6)
    );
    const width = parseInt(req.query.long || req.body.long || "800");
    const tmpDir = os.tmpdir();
    const base = `trace-${Date.now()}`;
    const baseFile = path.join(tmpDir, `${base}-base.png`);

    // Normalize and resize
    await sharp(req.file.buffer)
      .resize({ width, withoutEnlargement: true })
      .toColorspace("srgb")
      .median(1)
      .png()
      .toFile(baseFile);

    // --- 1-color (same as before) ---
    if (colorCount === 1) {
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

    // --- Multi-color via K-means ---
    console.log(`🎨 multi-color (${colorCount}) using k-means`);

    const { data, info } = await sharp(baseFile)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = [];
    for (let i = 0; i < data.length; i += info.channels) {
      pixels.push([data[i], data[i + 1], data[i + 2]]);
    }

    const centers = kmeans(pixels, colorCount);
    console.log("🎯 centers:", centers.map((c) => c.map((v) => Math.round(v))));

    const layers = [];

    for (let i = 0; i < centers.length; i++) {
      const [rC, gC, bC] = centers[i];
      const mask = Buffer.alloc(info.width * info.height * 3);
      for (let p = 0, px = 0; p < data.length; p += info.channels, px++) {
        const diff =
          (data[p] - rC) ** 2 +
          (data[p + 1] - gC) ** 2 +
          (data[p + 2] - bC) ** 2;
        const val = diff < 4000 ? 255 : 0; // tolerance for cluster
        mask[px * 3] = mask[px * 3 + 1] = mask[px * 3 + 2] = val;
      }

      const maskFile = path.join(tmpDir, `${base}-mask${i}.png`);
      await sharp(mask, {
        raw: { width: info.width, height: info.height, channels: 3 },
      })
        .png()
        .toFile(maskFile);

      const color = `rgb(${Math.round(rC)},${Math.round(gC)},${Math.round(bC)})`;
      const svgPart = await new Promise((resolve, reject) => {
        potrace.trace(
          maskFile,
          { color, background: "transparent", turdSize: 5 },
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

    res.type("image/svg+xml").send(svg);
  } catch (err) {
    console.error("🔥 trace exception:", err);
    res.status(500).send("Vectorization failed");
  }
});

app.get("*", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

app.listen(port, () => console.log(`🚀 Vectorizer running on port ${port}`));
