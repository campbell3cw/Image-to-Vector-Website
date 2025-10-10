// main.js
const fileInput = document.getElementById("file");
const dropzone = document.getElementById("dropzone");
const browseLink = document.getElementById("browse");
const vectorizeBtn = document.getElementById("vectorize");
const downloadBtn = document.getElementById("download");
const outlineBtn = document.getElementById("outline");
const spinnerOverlay = document.getElementById("spinner-overlay");
const previewContainer = document.getElementById("preview-container");
const vectorContainer = document.getElementById("vector-container");
const applyTune = document.getElementById("applyTune");
const resetTune = document.getElementById("resetTune");
const tuningPanel = document.getElementById("tuning-panel");

// Slider inputs
const sliders = ["th", "blur", "omit", "lt", "qt", "long"];
const sliderMap = {};
sliders.forEach((id) => {
  sliderMap[id] = {
    range: document.getElementById(id),
    num: document.getElementById(id + "_num"),
  };
});
const colorSlider = { range: null, num: null }; // we'll create it dynamically below

let uploadedFile = null;
let currentSVG = null;

// ========== UI SETUP ==========
browseLink.onclick = (e) => {
  e.preventDefault();
  fileInput.click();
};

fileInput.onchange = (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
};

dropzone.ondragover = (e) => {
  e.preventDefault();
  dropzone.classList.add("hover");
};
dropzone.ondragleave = () => dropzone.classList.remove("hover");
dropzone.ondrop = (e) => {
  e.preventDefault();
  dropzone.classList.remove("hover");
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
};

function handleFile(file) {
  uploadedFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    previewContainer.innerHTML = `<img src="${ev.target.result}" class="preview-img"/>`;
  };
  reader.readAsDataURL(file);
}

// ========== VECTORIZE ==========
async function vectorizeImage() {
  if (!uploadedFile) return alert("Please upload an image first.");

  spinnerOverlay.style.display = "flex";
  downloadBtn.style.display = "none";
  outlineBtn.style.display = "none";

  try {
    const formData = new FormData();
    formData.append("image", uploadedFile);

    // collect tuning params
    const params = {
      th: sliderMap.th.range.value,
      blur: sliderMap.blur.range.value,
      omit: sliderMap.omit.range.value,
      lt: sliderMap.lt.range.value,
      qt: sliderMap.qt.range.value,
      long: sliderMap.long.range.value,
      colors: colorSlider.range ? colorSlider.range.value : 1,
    };

    const query = new URLSearchParams(params).toString();
    const resp = await fetch(`/trace?${query}`, {
      method: "POST",
      body: formData,
    });

    if (!resp.ok) throw new Error("Vectorization failed");
    const svg = await resp.text();
    currentSVG = svg;

    vectorContainer.innerHTML = svg;
    downloadBtn.style.display = "inline-block";
    outlineBtn.style.display = "inline-block";
  } catch (err) {
    console.error(err);
    alert("Vectorization failed. Check console for details.");
  } finally {
    spinnerOverlay.style.display = "none";
  }
}

// ========== DOWNLOAD ==========
downloadBtn.onclick = () => {
  if (!currentSVG) return;
  const blob = new Blob([currentSVG], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "vectorized.svg";
  a.click();
  URL.revokeObjectURL(url);
};

// ========== OUTLINE PREVIEW ==========
outlineBtn.onclick = () => {
  if (!currentSVG) return;
  const outlined = currentSVG.replace(
    /fill="(.*?)"/g,
    'fill="none" stroke="black" stroke-width="1"'
  );
  const win = window.open();
  win.document.write(outlined);
};

// ========== ADD COLOR SLIDER ==========
function createColorSlider() {
  const tuningGrid = document.getElementById("tuning-grid");
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <label>Color Count</label>
    <div class="slider-wrap">
      <input id="colors" type="range" min="1" max="4" step="1" value="1" class="slider-input" />
      <input id="colors_num" type="number" min="1" max="4" value="1" />
    </div>
  `;
  tuningGrid.appendChild(wrapper);

  colorSlider.range = document.getElementById("colors");
  colorSlider.num = document.getElementById("colors_num");

  // sync
  colorSlider.range.addEventListener("input", () => {
    colorSlider.num.value = colorSlider.range.value;
  });
  colorSlider.num.addEventListener("input", () => {
    colorSlider.range.value = colorSlider.num.value;
  });
}
createColorSlider();

// ========== APPLY TUNE / RESET ==========
applyTune.onclick = () => vectorizeImage();
vectorizeBtn.onclick = () => vectorizeImage();

resetTune.onclick = () => {
  Object.values(sliderMap).forEach((pair) => {
    pair.range.value = pair.num.value = pair.range.defaultValue;
  });
  if (colorSlider.range) colorSlider.range.value = colorSlider.num.value = 1;
};

// Keep number + slider in sync
Object.values(sliderMap).forEach((pair) => {
  pair.range.addEventListener("input", () => (pair.num.value = pair.range.value));
  pair.num.addEventListener("input", () => (pair.range.value = pair.num.value));
});
