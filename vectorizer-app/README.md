# 🧵 At Work Uniforms – Vectorizer App

A web-based embroidery vectorizer tool for At Work Uniforms.  
Uploads raster images (JPG, PNG, etc.), processes them using Sharp + Potrace,  
and generates clean black-and-white SVGs ideal for logo and embroidery digitization.

---

## 🚀 Features

- 🖼️ Drag & drop image upload or browse dialog  
- ⚙️ Adjustable tuning (threshold, blur, path omit, ltres, qtres, etc.)  
- 🎨 Presets for "Logo", "Badge", and "Fine Detail"  
- 🔁 Auto re-vectorization when sliders change  
- ⚡ Fast WebAssembly tracing (`@luncheon/potrace-wasm`)  
- 📥 Download SVG & preview outline modes  
- 📱 Responsive layout for desktop, tablet, and phone  
- 🧭 Health endpoint `/healthz` for Railway monitoring  

---

## 🧰 Tech Stack

- **Backend:** Node.js, Express, Sharp, Potrace-WASM  
- **Frontend:** Vanilla JS, HTML5, CSS3  
- **Deployment:** Docker + Railway (Node 20 Alpine)

---

## 🧩 Project Structure

