import "./styles.css";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

type FeatureKind = "surface" | "underground" | "road" | "fence" | "entrance" | "label";
type Certainty = "confirmed" | "inferred" | "speculative";
type Tool = "select" | "rect" | "ellipse" | "line" | "polygon" | "label";
type ViewMode = "plan" | "model";

type Point = { x: number; y: number };

type Feature = {
  id: string;
  kind: FeatureKind;
  certainty: Certainty;
  label: string;
  note: string;
  points: Point[];
  height: number;
  depth: number;
};

type ImagerySource = {
  url: string;
  credit: string;
  license: string;
  referenceOnly: boolean;
};

const image = { width: 2709, height: 2320 };
const worldScale = 0.18;

let tool: Tool = "select";
let kind: FeatureKind = "surface";
let certainty: Certainty = "inferred";
let viewMode: ViewMode = "plan";
let features: Feature[] = loadState();
let imagerySource: ImagerySource = loadImagerySource();
let selectedId = features[0]?.id ?? "";
let draft: Point[] = [];
let pointerStart: Point | null = null;
let referenceOpacity = 0.48;
let showReference = true;
let zoom = 0.38;
let pan = { x: 0, y: 0 };
let referenceDataUrl = "";
let terrainTexture: THREE.Texture | null = null;

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
        <button id="exportModelPng">Export 3D PNG</button>
      </div>
    </header>

    <section class="workspace">
      <aside class="panel controls">
        <div class="group">
          <label>View</label>
          <div class="segmented" id="viewButtons">
            <button data-view="plan">Plan</button>
            <button data-view="model">3D Orbit</button>
          </div>
        </div>

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
          <label for="imageryUrl">Imagery URL</label>
          <input id="imageryUrl" placeholder="Open imagery or licensed direct image URL" />
          <label for="imageryCredit">Source / credit</label>
          <input id="imageryCredit" placeholder="Provider, date, license, citation" />
          <label for="imageryLicense">License notes</label>
          <textarea id="imageryLicense" class="compact" placeholder="Usage rights, restrictions, and figure caption text"></textarea>
          <label class="toggle"><input id="referenceOnly" type="checkbox" checked /> Reference only</label>
          <button id="loadImageryUrl">Load URL texture</button>
          <p class="hint">Google Earth and commercial basemaps should stay reference-only unless you have publication rights. Open imagery can be cited and used when its license permits it.</p>
        </div>

        <div class="group">
          <label for="zoom">Plan zoom</label>
          <input id="zoom" type="range" min="0.18" max="1.2" step="0.02" value="0.38" />
        </div>

        <div class="group selected">
          <label>Selected feature</label>
          <input id="labelInput" placeholder="Label" />
          <label for="heightInput">Height / thickness</label>
          <input id="heightInput" type="range" min="4" max="160" step="2" />
          <label for="depthInput">Depth below surface</label>
          <input id="depthInput" type="range" min="0" max="220" step="2" />
          <textarea id="noteInput" placeholder="Evidence notes and citations"></textarea>
          <button id="deleteFeature">Delete</button>
        </div>
      </aside>

      <div class="stageWrap">
        <div class="viewSurface">
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
          <div id="modelStage" aria-label="3D facility orbit model"></div>
          <div class="modelHud">
            <span>Orbit: drag</span>
            <span>Zoom: scroll</span>
            <span>Pan: right drag</span>
          </div>
        </div>
      </div>

      <aside class="panel library">
        <div class="group">
          <label>Starter</label>
          <button id="seedNatanz">Add Natanz starter layout</button>
          <p class="hint">Approximate blocks for QA. Replace or adjust each feature against your evidence.</p>
        </div>
        <div class="group">
          <label>Features</label>
          <div id="featureList" class="featureList"></div>
        </div>
        <div class="group">
          <label>Clean export rule</label>
          <p>Reference imagery is omitted from schematic SVG/PNG exports. 3D PNG export includes only the model, unless you deliberately load and show a texture.</p>
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
const modelStage = document.querySelector<HTMLDivElement>("#modelStage")!;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd8d1c5);
const camera = new THREE.PerspectiveCamera(45, 1, 1, 6000);
camera.position.set(320, 520, 620);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
modelStage.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);
controls.maxPolarAngle = Math.PI * 0.49;

const modelRoot = new THREE.Group();
scene.add(modelRoot);

const ambient = new THREE.HemisphereLight(0xffffff, 0x78736c, 2.1);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.position.set(420, 620, 280);
sun.castShadow = true;
scene.add(sun);

const grid = new THREE.GridHelper(620, 20, 0x516063, 0xa7a196);
grid.position.y = -0.5;
scene.add(grid);

bind();
resizeModel();
render();
animate();

function bind() {
  document.querySelector("#viewButtons")!.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-view]");
    if (!button) return;
    viewMode = button.dataset.view as ViewMode;
    render();
    resizeModel();
  });

  document.querySelector("#toolButtons")!.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-tool]");
    if (!button) return;
    tool = button.dataset.tool as Tool;
    draft = [];
    render();
  });

  document.querySelector<HTMLSelectElement>("#kind")!.addEventListener("change", (event) => {
    kind = (event.target as HTMLSelectElement).value as FeatureKind;
    updateSelected({ kind, height: defaultHeight(kind), depth: defaultDepth(kind) });
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

  document.querySelector<HTMLInputElement>("#heightInput")!.addEventListener("input", (event) => {
    updateSelected({ height: Number((event.target as HTMLInputElement).value) });
  });

  document.querySelector<HTMLInputElement>("#depthInput")!.addEventListener("input", (event) => {
    updateSelected({ depth: Number((event.target as HTMLInputElement).value) });
  });

  document.querySelector<HTMLTextAreaElement>("#noteInput")!.addEventListener("input", (event) => {
    updateSelected({ note: (event.target as HTMLTextAreaElement).value });
  });

  document.querySelector<HTMLInputElement>("#imageryUrl")!.addEventListener("input", (event) => {
    imagerySource.url = (event.target as HTMLInputElement).value;
    saveImagerySource();
  });

  document.querySelector<HTMLInputElement>("#imageryCredit")!.addEventListener("input", (event) => {
    imagerySource.credit = (event.target as HTMLInputElement).value;
    saveImagerySource();
  });

  document.querySelector<HTMLTextAreaElement>("#imageryLicense")!.addEventListener("input", (event) => {
    imagerySource.license = (event.target as HTMLTextAreaElement).value;
    saveImagerySource();
  });

  document.querySelector<HTMLInputElement>("#referenceOnly")!.addEventListener("change", (event) => {
    imagerySource.referenceOnly = (event.target as HTMLInputElement).checked;
    saveImagerySource();
  });

  document.querySelector("#loadImageryUrl")!.addEventListener("click", loadImageryUrl);

  document.querySelector("#deleteFeature")!.addEventListener("click", () => {
    features = features.filter((feature) => feature.id !== selectedId);
    selectedId = features[0]?.id ?? "";
    saveState();
    render();
  });

  document.querySelector("#seedNatanz")!.addEventListener("click", seedNatanzLayout);

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", onPointerUp);
  stage.addEventListener("dblclick", finishPolygon);
  window.addEventListener("resize", resizeModel);

  document.querySelector("#exportJson")!.addEventListener("click", exportJson);
  document.querySelector("#exportSvg")!.addEventListener("click", exportSvg);
  document.querySelector("#exportPng")!.addEventListener("click", exportPng);
  document.querySelector("#exportModelPng")!.addEventListener("click", exportModelPng);
  document.querySelector("#importJson")!.addEventListener("click", () => document.querySelector<HTMLInputElement>("#fileImport")!.click());
  document.querySelector<HTMLInputElement>("#fileImport")!.addEventListener("change", importJson);
}

function onPointerDown(event: PointerEvent) {
  if (viewMode !== "plan") return;
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
  if (!pointerStart || viewMode !== "plan") return;
  const point = svgPoint(event);
  draft = shapeFromDrag(pointerStart, point, tool);
  renderDraft();
}

function onPointerUp(event: PointerEvent) {
  if (!pointerStart || viewMode !== "plan") return;
  const point = svgPoint(event);
  const points = shapeFromDrag(pointerStart, point, tool);
  pointerStart = null;
  draft = [];
  if (distance(points[0], points[points.length - 1]) < 8 && tool !== "line") return;
  createFeature(points, kind, defaultLabel(kind));
}

function finishPolygon() {
  if (tool !== "polygon" || draft.length < 3 || viewMode !== "plan") return;
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
    note: "",
    points,
    height: defaultHeight(featureKind),
    depth: defaultDepth(featureKind)
  };
  features.push(feature);
  selectedId = feature.id;
  saveState();
  render();
}

function updateSelected(patch: Partial<Feature>) {
  if (!selectedId) return;
  features = features.map((feature) => feature.id === selectedId ? normalizeFeature({ ...feature, ...patch }) : feature);
  saveState();
  render();
}

function render() {
  viewport.setAttribute("transform", `translate(${pan.x} ${pan.y}) scale(${zoom})`);
  referenceImage.style.display = showReference && referenceImage.getAttribute("href") ? "block" : "none";
  referenceImage.style.opacity = String(referenceOpacity);
  stage.classList.toggle("hidden", viewMode !== "plan");
  modelStage.classList.toggle("active", viewMode === "model");
  document.querySelector(".modelHud")!.classList.toggle("active", viewMode === "model");
  renderToolbar();
  renderFeatures();
  renderDraft();
  renderList();
  renderInspector();
  renderModel();
}

function renderToolbar() {
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewMode);
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
      <small>${feature.kind} / ${feature.certainty} / h ${feature.height} / d ${feature.depth}</small>
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
  document.querySelector<HTMLInputElement>("#heightInput")!.value = String(selected?.height ?? defaultHeight(kind));
  document.querySelector<HTMLInputElement>("#depthInput")!.value = String(selected?.depth ?? defaultDepth(kind));
  document.querySelector<HTMLSelectElement>("#kind")!.value = selected?.kind ?? kind;
  document.querySelector<HTMLSelectElement>("#certainty")!.value = selected?.certainty ?? certainty;
  document.querySelector<HTMLInputElement>("#imageryUrl")!.value = imagerySource.url;
  document.querySelector<HTMLInputElement>("#imageryCredit")!.value = imagerySource.credit;
  document.querySelector<HTMLTextAreaElement>("#imageryLicense")!.value = imagerySource.license;
  document.querySelector<HTMLInputElement>("#referenceOnly")!.checked = imagerySource.referenceOnly;
}

function renderModel() {
  clearGroup(modelRoot);

  const terrain = new THREE.PlaneGeometry(image.width * worldScale, image.height * worldScale, 1, 1);
  const terrainMaterial = new THREE.MeshStandardMaterial({
    color: terrainTexture ? 0xffffff : 0xd8cdbb,
    map: terrainTexture ?? undefined,
    roughness: 0.86,
    metalness: 0.02
  });
  const terrainMesh = new THREE.Mesh(terrain, terrainMaterial);
  terrainMesh.rotation.x = -Math.PI / 2;
  terrainMesh.receiveShadow = true;
  modelRoot.add(terrainMesh);

  for (const feature of features) {
    if (feature.kind === "label") continue;
    if (feature.kind === "road" || feature.kind === "fence") {
      modelRoot.add(makeLineFeature(feature));
      continue;
    }
    if (feature.kind === "entrance") {
      modelRoot.add(makeEntranceFeature(feature));
      continue;
    }
    const mesh = makeVolumeFeature(feature);
    if (mesh) modelRoot.add(mesh);
  }
}

function makeVolumeFeature(feature: Feature) {
  if (feature.points.length < 3) return null;
  const shape = new THREE.Shape(feature.points.map((point) => {
    const mapped = toWorld2(point);
    return new THREE.Vector2(mapped.x, mapped.y);
  }));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: feature.height,
    bevelEnabled: false
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();

  const underground = feature.kind === "underground";
  const material = new THREE.MeshStandardMaterial({
    color: underground ? 0x40535a : 0xd8c19d,
    transparent: underground,
    opacity: underground ? 0.52 : 0.92,
    roughness: 0.78,
    metalness: 0.02
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = underground ? -feature.depth - feature.height : 0;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.featureId = feature.id;
  return mesh;
}

function makeLineFeature(feature: Feature) {
  const points = feature.points.map((point) => {
    const world = toWorld(point);
    return new THREE.Vector3(world.x, 4, world.z);
  });
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, Math.max(1, points.length * 8), feature.kind === "road" ? 4.5 : 2.4, 8, false);
  const material = new THREE.MeshStandardMaterial({
    color: feature.kind === "road" ? 0x8c8376 : 0x304044,
    roughness: 0.72
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

function makeEntranceFeature(feature: Feature) {
  const world = toWorld(feature.points[0]);
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(9, 9, 24, 24),
    new THREE.MeshStandardMaterial({ color: 0x07171d, roughness: 0.6 })
  );
  ring.rotation.z = Math.PI / 2;
  ring.position.set(world.x, 10, world.z);
  ring.castShadow = true;
  group.add(ring);
  return group;
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
    <path d="${pathData(feature.points, feature.kind !== "road" && feature.kind !== "fence")}" />
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
  download("undergroundmaps-natanz.json", JSON.stringify({ project: "UndergroundMaps", workspace: "Natanz", image, imagerySource, features }, null, 2), "application/json");
}

function importJson(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const parsed = JSON.parse(String(reader.result));
    features = (parsed.features ?? []).map(normalizeFeature);
    imagerySource = normalizeImagerySource(parsed.imagerySource ?? imagerySource);
    selectedId = features[0]?.id ?? "";
    saveState();
    saveImagerySource();
    render();
  };
  reader.readAsText(file);
}

function loadReferenceImage(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    referenceDataUrl = String(reader.result);
    referenceImage.setAttribute("href", referenceDataUrl);
    showReference = true;
    document.querySelector<HTMLInputElement>("#showReference")!.checked = true;
    setTerrainTexture(referenceDataUrl);
    render();
  };
  reader.readAsDataURL(file);
}

function loadImageryUrl() {
  if (!imagerySource.url) return;
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  loader.load(imagerySource.url, (texture) => {
    setTexture(texture);
    referenceImage.setAttribute("href", imagerySource.url);
    showReference = true;
    document.querySelector<HTMLInputElement>("#showReference")!.checked = true;
    render();
  });
}

function setTerrainTexture(url: string) {
  const loader = new THREE.TextureLoader();
  loader.load(url, setTexture);
}

function setTexture(texture: THREE.Texture) {
  terrainTexture = texture;
  terrainTexture.colorSpace = THREE.SRGBColorSpace;
  terrainTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  renderModel();
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

function exportModelPng() {
  renderModelFrame();
  renderer.domElement.toBlob((blob) => {
    if (blob) downloadBlob("undergroundmaps-natanz-3d.png", blob);
  }, "image/png");
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

function seedNatanzLayout() {
  const starters: Array<Omit<Feature, "id">> = [
    {
      kind: "surface",
      certainty: "inferred",
      label: "Centrifuge assembly buildings",
      note: "Starter footprint for QA against public references.",
      height: 36,
      depth: 0,
      points: rectPoints(620, 690, 720, 570)
    },
    {
      kind: "underground",
      certainty: "inferred",
      label: "Underground enrichment halls",
      note: "Approximate inferred underground volume. Adjust after source review.",
      height: 62,
      depth: 88,
      points: rectPoints(1380, 860, 430, 330)
    },
    {
      kind: "underground",
      certainty: "speculative",
      label: "Buried support volume",
      note: "Speculative starter volume for QA.",
      height: 46,
      depth: 70,
      points: rectPoints(1510, 1225, 410, 260)
    },
    {
      kind: "entrance",
      certainty: "inferred",
      label: "Underground entrance",
      note: "Starter portal marker.",
      height: 28,
      depth: 0,
      points: [{ x: 1410, y: 1530 }]
    },
    {
      kind: "road",
      certainty: "inferred",
      label: "Service road",
      note: "Starter service path.",
      height: 8,
      depth: 0,
      points: [
        { x: 1260, y: 1545 },
        { x: 1470, y: 1510 },
        { x: 1780, y: 1450 },
        { x: 2170, y: 1390 }
      ]
    }
  ];
  features = starters.map((feature) => ({ ...feature, id: crypto.randomUUID() }));
  selectedId = features[0]?.id ?? "";
  saveState();
  render();
}

function rectPoints(x: number, y: number, width: number, height: number) {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height }
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

function toWorld(point: Point) {
  return {
    x: (point.x - image.width / 2) * worldScale,
    z: (point.y - image.height / 2) * worldScale
  };
}

function toWorld2(point: Point) {
  return {
    x: (point.x - image.width / 2) * worldScale,
    y: (point.y - image.height / 2) * worldScale
  };
}

function defaultHeight(featureKind: FeatureKind) {
  return {
    surface: 34,
    underground: 58,
    road: 8,
    fence: 12,
    entrance: 24,
    label: 0
  }[featureKind];
}

function defaultDepth(featureKind: FeatureKind) {
  return featureKind === "underground" ? 80 : 0;
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

function normalizeFeature(raw: Partial<Feature>): Feature {
  const normalizedKind = raw.kind ?? "surface";
  return {
    id: raw.id ?? crypto.randomUUID(),
    kind: normalizedKind,
    certainty: raw.certainty ?? "inferred",
    label: raw.label ?? defaultLabel(normalizedKind),
    note: raw.note ?? "",
    points: raw.points ?? [],
    height: raw.height ?? defaultHeight(normalizedKind),
    depth: raw.depth ?? defaultDepth(normalizedKind)
  };
}

function normalizeImagerySource(raw: Partial<ImagerySource>): ImagerySource {
  return {
    url: raw.url ?? "",
    credit: raw.credit ?? "",
    license: raw.license ?? "",
    referenceOnly: raw.referenceOnly ?? true
  };
}

function saveState() {
  localStorage.setItem("undergroundmaps:natanz", JSON.stringify(features));
}

function saveImagerySource() {
  localStorage.setItem("undergroundmaps:imagerySource", JSON.stringify(imagerySource));
}

function loadState(): Feature[] {
  try {
    const stored = localStorage.getItem("undergroundmaps:natanz");
    if (stored) return JSON.parse(stored).map(normalizeFeature);
  } catch {
    return [];
  }
  return [];
}

function loadImagerySource(): ImagerySource {
  try {
    const stored = localStorage.getItem("undergroundmaps:imagerySource");
    if (stored) return normalizeImagerySource(JSON.parse(stored));
  } catch {
    return normalizeImagerySource({});
  }
  return normalizeImagerySource({});
}

function clearGroup(group: THREE.Group) {
  while (group.children.length) {
    const child = group.children.pop();
    if (!child) break;
    child.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material?.dispose();
    });
  }
}

function resizeModel() {
  const rect = modelStage.getBoundingClientRect();
  const width = Math.max(320, rect.width || 900);
  const height = Math.max(320, rect.height || 720);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  renderModelFrame();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderModelFrame();
}

function renderModelFrame() {
  renderer.render(scene, camera);
}
