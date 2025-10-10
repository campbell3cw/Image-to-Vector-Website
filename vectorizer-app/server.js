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
  if (!req.file) return res.status(400).send("No image");

  try {
    const tmpPath = path.join(os.tmpdir(), `trace-${Date.now()}.png`);

    // Preprocess for embroidery-friendly outline
    await sharp(req.file.buffer)
      .resize({ width: 800, withoutEnlargement: true })
      .greyscale()
      .blur(1)
      .threshold(180)
      .png()
      .toFile(tmpPath);

    console.log("🧩 Image written:", tmpPath);

    // Use system Potrace
    const params = {
      color: "black",
      background: "white",
      turdSize: 5,
      ltres: 0.8,
      qtres: 1.0,
    };

    potrace.trace(tmpPath, params, (err, svg) => {
      fs.unlink(tmpPath, () => {});
      if (err) {
        console.error("🚫 Potrace error:", err);
        return res.status(500).send("Trace error");
      }
      console.log("✅ Trace complete, sending SVG");
      res.type("image/svg+xml").send(svg);
    });
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
