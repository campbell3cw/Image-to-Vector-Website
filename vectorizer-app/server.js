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

/* ---------------------- /trace ---------------------- */
app.post("/trace", upload.single("image"), async (req, res) => {
  console.log("📤 /trace called");
  try {
    if (!req.file) return res.status(400).send("No image uploaded");

    const colorCount = parseInt(req.query.colors || req.body.colors || "1");
    const width = parseInt(req.query.long || req.body.long || "800");
    const tmpDir = os.tmpdir();
    const base = `trace-${Date.now()}`;
    const baseFile = path.join(tmpDir, `${base}-base.png`);

    // --- Step 1: normalize ---
    await sharp(req.file.buffer)
      .resize({ width, withoutEnlargement: true })
      .toColorspace("srgb")
      .median(1)
      .png()
      .toFile(baseFile);

    /* ---------- SINGLE COLOR (Embroidery / Outline Mode) ---------- */
    if (colorCount <= 1) {
      console.log("🖤 single-color mode");
      const bwBuf = await sharp(baseFile)
        .greyscale()
        .threshold(200, { grayscale: true })
        .toBuffer();

      const bwFile = path.join(tmpDir, `${base}-bw.png`);
      fs.writeFileSync(bwFile, bwBuf);

      potrace.trace(
        bwFile,
        {
          color: "black",
          background: "transparent", // no background fill!
          turdSize: 2, // keep small internal holes
          optTolerance: 0.2, // slightly tighter curve fit
        },
        (err, svg) => {
          fs.unlink(bwFile, () => {});
          fs.unlink(baseFile, () => {});
          if (err) {
            console.error("❌ Potrace error:", err);
            return res.status(500).send("Trace error");
          }
          res.type("image/svg+xml").send(svg);
        }
      );
      return;
    }

    /* ---------- TWO-COLOR MODE (Logo Fill + Outline) ---------- */
    console.log("🎨 two-color mode");

    const { data, info } = await sharp(baseFile)
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Separate by brightness threshold (dynamic mid-point)
    let min = 255,
      max = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      const v = 0.299 * r + 0.587 * g + 0.114 * b;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const mid = (min + max) / 2;

    const lightMask = Buffer.alloc(info.width * info.height * 3);
    const darkMask = Buffer.alloc(info.width * info.height * 3);

    for (let i = 0, px = 0; i < data.length; i += info.channels, px++) {
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      const v = 0.299 * r + 0.587 * g + 0.114 * b;
      const light = v >= mid ? 255 : 0;
      const dark = v < mid ? 255 : 0;
      lightMask[px * 3] = lightMask[px * 3 + 1] = lightMask[px * 3 + 2] = light;
      darkMask[px * 3] = darkMask[px * 3 + 1] = darkMask[px * 3 + 2] = dark;
    }

    const lightFile = path.join(tmpDir, `${base}-light.png`);
    const darkFile = path.join(tmpDir, `${base}-dark.png`);

    await sharp(lightMask, {
      raw: { width: info.width, height: info.height, channels: 3 },
    })
      .threshold(100)
      .png()
      .toFile(lightFile);

    await sharp(darkMask, {
      raw: { width: info.width, height: info.height, channels: 3 },
    })
      .threshold(100)
      .png()
      .toFile(darkFile);

    const layers = [];

    // light layer (background color of logo)
    const svgLight = await new Promise((resolve, reject) => {
      potrace.trace(
        lightFile,
        { color: "#F8F8F8", background: "transparent", turdSize: 2 },
        (err, svg) => {
          fs.unlink(lightFile, () => {});
          if (err) reject(err);
          else resolve(svg.replace(/<\/?svg[^>]*>/g, ""));
        }
      );
    });
    layers.push(svgLight);

    // dark layer (foreground or lettering)
    const svgDark = await new Promise((resolve, reject) => {
      potrace.trace(
        darkFile,
        { color: "#111111", background: "transparent", turdSize: 2 },
        (err, svg) => {
          fs.unlink(darkFile, () => {});
          if (err) reject(err);
          else resolve(svg.replace(/<\/?svg[^>]*>/g, ""));
        }
      );
    });
    layers.push(svgDark);

    fs.unlink(baseFile, () => {});
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${info.width} ${info.height}">
      ${layers.join("\n")}
    </svg>`;

    console.log("✅ finished two-color trace");
    res.type("image/svg+xml").send(svg);
  } catch (err) {
    console.error("🔥 trace exception:", err);
    res.status(500).send("Vectorization failed");
  }
});

/* ---------------------- Serve index ---------------------- */
app.get("*", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

app.listen(port, () => console.log(`🚀 Vectorizer running on port ${port}`));
