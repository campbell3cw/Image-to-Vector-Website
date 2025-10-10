document.addEventListener("DOMContentLoaded", () => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file");
  const browse = document.getElementById("browse");
  const previewContainer = document.getElementById("preview-container");
  const vectorContainer  = document.getElementById("vector-container");
  const btnVectorize = document.getElementById("vectorize");
  const btnDownload = document.getElementById("download");
  const btnOutline  = document.getElementById("outline");
  const tuningToggle = document.getElementById("tuningToggle");
  const tuningPanel = document.getElementById("tuning-panel");
  const applyTune = document.getElementById("applyTune");
  const resetTune = document.getElementById("resetTune");

  const presets = {
    logo:  { th:200, blur:0.8, long:700, omit:5, lt:0.8, qt:1.0 },
    badge: { th:180, blur:1.2, long:800, omit:8, lt:1.0, qt:0.9 },
    fine:  { th:165, blur:1.6, long:1000, omit:4, lt:1.2, qt:0.8 }
  };

  const ids = ["th","blur","long","omit","lt","qt"];
  const inputs = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const nums   = Object.fromEntries(ids.map(id => [id, document.getElementById(id + "_num")]));

  let uploadedFile = null;
  let lastSVG = null;
  let debounceTimer = null;

  const applyToggleState = () => {
    if (tuningToggle.checked) {
      tuningPanel.style.display = "block";
      tuningPanel.style.maxHeight = "1200px";
      tuningPanel.style.opacity = "1";
    } else {
      tuningPanel.style.maxHeight = "0";
      tuningPanel.style.opacity = "0";
      setTimeout(() => { if (!tuningToggle.checked) tuningPanel.style.display = "none"; }, 250);
    }
  };
  tuningToggle.addEventListener("change", applyToggleState);
  applyToggleState();

  // Drag-drop & browse
  browse?.addEventListener("click", (e) => { e.preventDefault(); fileInput.click(); });
  dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("hover"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("hover"));
  dropzone.addEventListener("drop", e => {
    e.preventDefault(); dropzone.classList.remove("hover");
    const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f);
  });
  fileInput.addEventListener("change", e => { const f = e.target.files?.[0]; if (f) handleFile(f); });

  function handleFile(file) {
    uploadedFile = file;
    btnVectorize.disabled = false;
    const r = new FileReader();
    r.onload = (ev) => (previewContainer.innerHTML = `<img src="${ev.target.result}" class="preview-img" alt="preview">`);
    r.readAsDataURL(file);
    vectorContainer.innerHTML = "<p>Ready to vectorize…</p>";
    lastSVG = null;
    btnDownload.style.display = "none";
    btnOutline.style.display  = "none";
  }

  // Spinner helpers
  const spinner = document.getElementById("spinner-overlay");
  const showSpinner = () => spinner.style.display = "flex";
  const hideSpinner = () => spinner.style.display = "none";

  const getTuneParams = () => {
    if (!tuningToggle.checked) return "";
    return "?" + ids.map(id => `${id}=${encodeURIComponent(inputs[id].value)}`).join("&");
  };

  async function runVectorize(auto=false) {
    if (!uploadedFile) return;
    showSpinner();
    vectorContainer.innerHTML = auto ? "<p>Auto updating…</p>" : "<p>Processing…</p>";
    const form = new FormData(); form.append("image", uploadedFile);
    try {
      const res = await fetch("/trace" + getTuneParams(), { method:"POST", body: form });
      if (!res.ok) { vectorContainer.innerHTML = `<p style='color:#b00020'>${await res.text()}</p>`; hideSpinner(); return; }
      const svg = await res.text();
      lastSVG = svg;
      vectorContainer.innerHTML = svg;
      btnDownload.style.display = "inline-block";
      btnOutline.style.display  = "inline-block";
    } catch (e) {
      vectorContainer.innerHTML = "<p style='color:#b00020'>Network error</p>";
      console.error(e);
    } finally {
      hideSpinner();
    }
  }

  btnVectorize.addEventListener("click", () => runVectorize());
  applyTune.addEventListener("click", () => runVectorize());
  resetTune.addEventListener("click", () => {
    const def = { th:180, blur:1.0, long:800, omit:5, lt:0.8, qt:1.0 };
    for (const k in def) { inputs[k].value = def[k]; nums[k].value = def[k]; }
  });

  // Link range + number inputs, auto re-vectorize on change
  ids.forEach(id => {
    const range = inputs[id], num = nums[id];
    range.addEventListener("input", () => { num.value = range.value; });
    num.addEventListener("input", () => { range.value = num.value; });
    range.addEventListener("change", () => autoVectorize());
    num.addEventListener("change", () => autoVectorize());
  });
  function autoVectorize() {
    if (!uploadedFile) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runVectorize(true), 600);
  }

  // Presets
  document.querySelectorAll("#preset-row button").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = presets[btn.dataset.preset];
      for (const k in p) { inputs[k].value = p[k]; nums[k].value = p[k]; }
      runVectorize(true);
    });
  });

  // Download SVG
  btnDownload.addEventListener("click", () => {
    if (!lastSVG) return;
    const blob = new Blob([lastSVG], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "vectorized.svg"; a.click();
    URL.revokeObjectURL(url);
  });

  // Outline preview
  btnOutline.addEventListener("click", () => {
    if (!lastSVG) return;
    const doc = new DOMParser().parseFromString(lastSVG, "image/svg+xml");
    const svgRoot = doc.documentElement;
    const style = doc.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = "path,polygon,polyline,rect,circle,ellipse,line{fill:none;stroke:black;stroke-width:1.2;stroke-linejoin:round;stroke-linecap:round}";
    svgRoot.insertBefore(style, svgRoot.firstChild);
    svgRoot.querySelectorAll("path,polygon,polyline,rect,circle,ellipse,line").forEach(n=>{
      n.removeAttribute("fill"); n.removeAttribute("stroke"); n.removeAttribute("stroke-width");
    });
    const xml = new XMLSerializer().serializeToString(doc);
    const blob = new Blob([xml], { type:"image/svg+xml" });
    const url  = URL.createObjectURL(blob);
    window.open(url, "_blank");
  });
});
