import "./styles.css";

type FeatureKind = "surface" | "underground" | "road" | "fence" | "entrance" | "label";
type Certainty = "confirmed" | "inferred" | "speculative";
type Tool = "select" | "rect" | "ellipse" | "line" | "polygon" | "label";

type Point = { x: number; y: number };

type Feature = {
  id: string;
  kind: FeatureKind;
  certainty: Certainty;
  label: string;
  note: string;
  points: Point[];
};

const image = { width: 2709, height: 2320 };

let tool: Tool = "select";
let kind: FeatureKind = "surface";
let certainty: Certainty = "inferred";
let features: Feature[] = loadState();
let selectedId = features[0]?.id ?? "";
let draft: Point[] = [];
let pointerStart: Point | null = null;
let referenceOpacity = 0.48;
let showReference = true;
let zoom = 0.38;
let pan = { x: 0, y: 0 };

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app root");

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div>
        <h1>UndergroundMaps</h1>
        <p>Natanz reconstruction workspace</p>
      </div>
      <div class="actions">
        <button id="exportJson">Export JSON</button>
        <button id="importJson">Import JSON</button>
        <button id="exportSvg">Export SVG</button>
        <button id="exportPng">Export PNG</button>
      </div>
    </header>

    <section class="workspace">
      <aside class="panel controls">
        <div class="group">
          <label>Tool</label>
          <div class="segmented" id="toolButtons">
            <button data-tool="select">Select</button>
            <button data-tool="rect">Box</button>
            <button data-tool="ellipse">Oval</button>
            <button data-tool="line">Line</button>
            <button data-tool="polygon">Poly</button>
            <button data-tool="label">Text</button>
          </div>
        </div>

        <div class="group">
          <label for="kind">Class</label>
          <select id="kind">
            <option value="surface">Surface building</option>
            <option value="underground">Underground volume</option>
            <option value="road">Road / service path</option>
            <option value="fence">Fence / perimeter</option>
            <option value="entrance">Entrance / portal</option>
            <option value="label">Label only</option>
          </select>
        </div>

        <div class="group">
          <label for="certainty">Status</label>
          <select id="certainty">
            <option value="confirmed">Confirmed</option>
            <option value="inferred">Inferred</option>
            <option value="speculative">Speculative</option>
          </select>
        </div>

        <div class="group">
          <label for="referenceUpload">Reference image</label>
          <input id="referenceUpload" type="file" accept="image/*" />
          <p class="hint">Loaded only in your browser for QA; not stored or exported.</p>
          <label for="referenceOpacity">Reference opacity</label>
          <input id="referenceOpacity" type="range" min="0" max="1" step="0.02" value="0.48" />
          <label class="toggle"><input id="showReference" type="checkbox" checked /> Show reference</label>
        </div>

        <div class="group">
          <label for="zoom">Zoom</label>
          <input id="zoom" type="range" min="0.18" max="1.2" step="0.02" value="0.38" />
        </div>

        <div class="group selected">
          <label>Selected feature</label>
          <input id="labelInput" placeholder="Label" />
          <textarea id="noteInput" placeholder="Evidence notes and citations"></textarea>
          <button id="deleteFeature">Delete</button>
        </div>
      </aside>

      <div class="stageWrap">
        <svg id="stage" viewBox="0 0 ${image.width} ${image.height}" aria-label="Natanz QA drawing surface">
          <defs>
            <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#061116" flood-opacity="0.25"/>
            </filter>
          </defs>
          <g id="viewport">
            <image id="referenceImage" width="${image.width}" height="${image.height}" preserveAspectRatio="none" />
            <rect class="terrain" width="${image.width}" height="${image.height}" />
            <g id="featureLayer"></g>
            <g id="draftLayer"></g>
          </g>
        </svg>
      </div>

      <aside class="panel library">
        <div class="group">
          <label>Features</label>
          <div id="featureList" class="featureList"></div>
        </div>
        <div class="group">
          <label>Clean export rule</label>
          <p>The reference image is never included in schematic SVG/PNG exports.</p>
        </div>
      </aside>
    </section>
  </main>
  <input id="fileImport" type="file" accept="application/json" hidden />
`;

const stage = document.querySelector<SVGSVGElement>("#stage")!;
const viewport = document.querySelector<SVGGElement>("#viewport")!;
const referenceImage = document.querySelector<SVGImageElement>("#referenceImage")!;
const featureLayer = document.querySelector<SVGGElement>("#featureLayer")!;
const draftLayer = document.querySelector<SVGGElement>("#draftLayer")!;

bind();
render();

function bind() {
  document.querySelector("#toolButtons")!.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-tool]");
    if (!button) return;
    tool = button.dataset.tool as Tool;
    draft = [];
    render();
  });

  document.querySelector<HTMLSelectElement>("#kind")!.addEventListener("change", (event) => {
    kind = (event.target as HTMLSelectElement).value as FeatureKind;
    updateSelected({ kind });
  });

  document.querySelector<HTMLSelectElement>("#certainty")!.addEventListener("change", (event) => {
    certainty = (event.target as HTMLSelectElement).value as Certainty;
    updateSelected({ certainty });
  });

  document.querySelector<HTMLInputElement>("#referenceOpacity")!.addEventListener("input", (event) => {
    referenceOpacity = Number((event.target as HTMLInputElement).value);
    render();
  });

  document.querySelector<HTMLInputElement>("#showReference")!.addEventListener("change", (event) => {
    showReference = (event.target as HTMLInputElement).checked;
    render();
  });

  document.querySelector<HTMLInputElement>("#referenceUpload")!.addEventListener("change", loadReferenceImage);

  document.querySelector<HTMLInputElement>("#zoom")!.addEventListener("input", (event) => {
    zoom = Number((event.target as HTMLInputElement).value);
    render();
  });

  document.querySelector<HTMLInputElement>("#labelInput")!.addEventListener("input", (event) => {
    updateSelected({ label: (event.target as HTMLInputElement).value });
  });

  document.querySelector<HTMLTextAreaElement>("#noteInput")!.addEventListener("input", (event) => {
    updateSelected({ note: (event.target as HTMLTextAreaElement).value });
  });

  document.querySelector("#deleteFeature")!.addEventListener("click", () => {
    features = features.filter((feature) => feature.id !== selectedId);
    selectedId = features[0]?.id ?? "";
    saveState();
    render();
  });

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", onPointerUp);
  stage.addEventListener("dblclick", finishPolygon);

  document.querySelector("#exportJson")!.addEventListener("click", exportJson);
  document.querySelector("#exportSvg")!.addEventListener("click", exportSvg);
  document.querySelector("#exportPng")!.addEventListener("click", exportPng);
  document.querySelector("#importJson")!.addEventListener("click", () => document.querySelector<HTMLInputElement>("#fileImport")!.click());
  document.querySelector<HTMLInputElement>("#fileImport")!.addEventListener("change", importJson);
}

function onPointerDown(event: PointerEvent) {
  const point = svgPoint(event);
  if (tool === "select") {
    const node = (event.target as Element).closest<SVGElement>("[data-id]");
    selectedId = node?.dataset.id ?? "";
    render();
    return;
  }
  if (tool === "label") {
    createFeature([{ x: point.x, y: point.y }], "label", "Label");
    return;
  }
  if (tool === "polygon") {
    draft.push(point);
    renderDraft();
    return;
  }
  pointerStart = point;
}

function onPointerMove(event: PointerEvent) {
  if (!pointerStart) return;
  const point = svgPoint(event);
  draft = shapeFromDrag(pointerStart, point, tool);
  renderDraft();
}

function onPointerUp(event: PointerEvent) {
  if (!pointerStart) return;
  const point = svgPoint(event);
  const points = shapeFromDrag(pointerStart, point, tool);
  pointerStart = null;
  draft = [];
  if (distance(points[0], points[points.length - 1]) < 8 && tool !== "line") return;
  createFeature(points, kind, defaultLabel(kind));
}

function finishPolygon() {
  if (tool !== "polygon" || draft.length < 3) return;
  createFeature([...draft], kind, defaultLabel(kind));
  draft = [];
  renderDraft();
}

function createFeature(points: Point[], featureKind: FeatureKind, label: string) {
  const feature: Feature = {
    id: crypto.randomUUID(),
    kind: featureKind,
    certainty,
    label,
    note: ""
  , points };
  features.push(feature);
  selectedId = feature.id;
  saveState();
  render();
}

function updateSelected(patch: Partial<Feature>) {
  features = features.map((feature) => feature.id === selectedId ? { ...feature, ...patch } : feature);
  saveState();
  render();
}

function render() {
  viewport.setAttribute("transform", `translate(${pan.x} ${pan.y}) scale(${zoom})`);
  referenceImage.style.display = showReference && referenceImage.getAttribute("href") ? "block" : "none";
  referenceImage.style.opacity = String(referenceOpacity);
  renderToolbar();
  renderFeatures();
  renderDraft();
  renderList();
  renderInspector();
}

function renderToolbar() {
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
}

function renderFeatures() {
  featureLayer.innerHTML = features.map((feature) => featureSvg(feature, false)).join("");
}

function renderDraft() {
  draftLayer.innerHTML = draft.length ? `<path class="draft" d="${pathData(draft, tool !== "line")}" />` : "";
}

function renderList() {
  const list = document.querySelector<HTMLDivElement>("#featureList")!;
  list.innerHTML = features.map((feature) => `
    <button class="featureItem ${feature.id === selectedId ? "active" : ""}" data-feature="${feature.id}">
      <span>${escapeHtml(feature.label || defaultLabel(feature.kind))}</span>
      <small>${feature.kind} / ${feature.certainty}</small>
    </button>
  `).join("");
  list.querySelectorAll<HTMLButtonElement>("[data-feature]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedId = button.dataset.feature ?? "";
      render();
    });
  });
}

function renderInspector() {
  const selected = features.find((feature) => feature.id === selectedId);
  document.querySelector<HTMLInputElement>("#labelInput")!.value = selected?.label ?? "";
  document.querySelector<HTMLTextAreaElement>("#noteInput")!.value = selected?.note ?? "";
  document.querySelector<HTMLSelectElement>("#kind")!.value = selected?.kind ?? kind;
  document.querySelector<HTMLSelectElement>("#certainty")!.value = selected?.certainty ?? certainty;
}

function featureSvg(feature: Feature, clean: boolean) {
  const selected = feature.id === selectedId && !clean ? " selected" : "";
  const classes = `feature ${feature.kind} ${feature.certainty}${selected}`;
  if (feature.kind === "label") {
    const point = feature.points[0];
    return `<text class="${classes}" data-id="${feature.id}" x="${point.x}" y="${point.y}">${escapeHtml(feature.label)}</text>`;
  }
  if (feature.kind === "entrance") {
    const point = feature.points[0];
    return `<g class="${classes}" data-id="${feature.id}">
      <circle cx="${point.x}" cy="${point.y}" r="22" />
      <text x="${point.x + 34}" y="${point.y + 8}">${escapeHtml(feature.label)}</text>
    </g>`;
  }
  return `<g class="${classes}" data-id="${feature.id}">
    <path d="${pathData(feature.points, feature.kind !== "road")}" />
    ${feature.label ? labelAt(feature) : ""}
  </g>`;
}

function labelAt(feature: Feature) {
  const center = centroid(feature.points);
  return `<text x="${center.x}" y="${center.y}">${escapeHtml(feature.label)}</text>`;
}

function cleanSvgMarkup() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${image.width} ${image.height}" width="${image.width}" height="${image.height}">
  <style>${cleanStyles()}</style>
  <rect class="paper" width="${image.width}" height="${image.height}"/>
  <g class="features">
    ${features.map((feature) => featureSvg(feature, true)).join("\n    ")}
  </g>
</svg>`;
}

function cleanStyles() {
  return `.paper{fill:#e7e0d4}.feature path,.feature circle{vector-effect:non-scaling-stroke;stroke:#07171d;stroke-width:9}.surface path{fill:#d8c19d}.underground path{fill:#4d5b60;fill-opacity:.42;stroke-dasharray:20 12}.road path{fill:none;stroke:#8c8376;stroke-width:11}.fence path{fill:none;stroke:#394346;stroke-width:7;stroke-dasharray:16 10}.entrance circle{fill:#07171d}.confirmed path,.confirmed circle{stroke:#061116}.inferred path,.inferred circle{stroke:#14323a}.speculative path,.speculative circle{stroke:#65513b;stroke-dasharray:18 12}text{font-family:Arial,sans-serif;font-weight:700;font-size:42px;fill:#07171d;text-anchor:middle;paint-order:stroke;stroke:#e7e0d4;stroke-width:10px;stroke-linejoin:round}`;
}

function exportJson() {
  download("undergroundmaps-natanz.json", JSON.stringify({ project: "UndergroundMaps", workspace: "Natanz", image, features }, null, 2), "application/json");
}

function importJson(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const parsed = JSON.parse(String(reader.result));
    features = parsed.features ?? [];
    selectedId = features[0]?.id ?? "";
    saveState();
    render();
  };
  reader.readAsText(file);
}

function loadReferenceImage(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    referenceImage.setAttribute("href", String(reader.result));
    showReference = true;
    document.querySelector<HTMLInputElement>("#showReference")!.checked = true;
    render();
  };
  reader.readAsDataURL(file);
}

function exportSvg() {
  download("undergroundmaps-natanz-schematic.svg", cleanSvgMarkup(), "image/svg+xml");
}

function exportPng() {
  const svg = cleanSvgMarkup();
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((png) => {
      if (png) downloadBlob("undergroundmaps-natanz-schematic.png", png);
    }, "image/png");
  };
  img.src = url;
}

function download(filename: string, body: string, type: string) {
  downloadBlob(filename, new Blob([body], { type }));
}

function downloadBlob(filename: string, blob: Blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function shapeFromDrag(start: Point, end: Point, activeTool: Tool): Point[] {
  if (activeTool === "line") return [start, end];
  if (activeTool === "ellipse") {
    const cx = (start.x + end.x) / 2;
    const cy = (start.y + end.y) / 2;
    const rx = Math.abs(end.x - start.x) / 2;
    const ry = Math.abs(end.y - start.y) / 2;
    return Array.from({ length: 32 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 32;
      return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
    });
  }
  return [
    { x: start.x, y: start.y },
    { x: end.x, y: start.y },
    { x: end.x, y: end.y },
    { x: start.x, y: end.y }
  ];
}

function svgPoint(event: PointerEvent): Point {
  const point = stage.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = viewport.getScreenCTM()?.inverse();
  const mapped = matrix ? point.matrixTransform(matrix) : point;
  return { x: clamp(mapped.x, 0, image.width), y: clamp(mapped.y, 0, image.height) };
}

function pathData(points: Point[], close: boolean) {
  if (!points.length) return "";
  return `${points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ")}${close ? " Z" : ""}`;
}

function centroid(points: Point[]) {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function defaultLabel(featureKind: FeatureKind) {
  return {
    surface: "Surface building",
    underground: "Underground volume",
    road: "Road",
    fence: "Perimeter",
    entrance: "Entrance",
    label: "Label"
  }[featureKind];
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]!));
}

function saveState() {
  localStorage.setItem("undergroundmaps:natanz", JSON.stringify(features));
}

function loadState(): Feature[] {
  try {
    const stored = localStorage.getItem("undergroundmaps:natanz");
    if (stored) return JSON.parse(stored);
  } catch {
    return [];
  }
  return [];
}
