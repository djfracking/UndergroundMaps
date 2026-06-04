import "./styles.css";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  Box as BoxIcon,
  Circle,
  Download,
  FileImage,
  FileJson,
  Import as ImportIcon,
  Map as MapIcon,
  MousePointer2,
  Orbit,
  Pentagon,
  Redo2,
  Slash,
  Square,
  Stamp,
  Trash2,
  Type as TypeIcon,
  Undo2,
  createElement
} from "lucide";
import type { IconNode } from "lucide";

type FeatureKind = "surface" | "underground" | "road" | "fence" | "entrance" | "label";
type Certainty = "confirmed" | "inferred" | "speculative";
type Tool = "select" | "place" | "rect" | "ellipse" | "line" | "polygon" | "label";
type ViewMode = "plan" | "model";
type PlacementPreset = "surface" | "underground" | "entrance";

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
  rotation: number;
};

type ImagerySource = {
  url: string;
  credit: string;
  license: string;
  referenceOnly: boolean;
};

type HistorySnapshot = {
  features: Feature[];
  selectedId: string;
};

type PanState = {
  pointerId: number;
  startClient: Point;
  startPan: Point;
};

type TransformMode = "move" | "rotate" | "scale";
type ScaleHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type OrientedBox = {
  center: Point;
  rotation: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type ActiveTransform = {
  mode: TransformMode;
  id: string;
  startPoint: Point;
  initialPoints: Point[];
  initialRotation: number;
  center: Point;
  startAngle: number;
  historyPushed: boolean;
  scaleAnchor?: Point;
  scaleHandle?: ScaleHandle;
  scaleHandleStart?: Point;
  initialLocalPoints?: Point[];
};

const image = { width: 2709, height: 2320 };
const worldScale = 0.18;
const initialZoom = 0.38;
const minPlanZoom = 0.12;
const maxPlanZoom = 5;

const toolShortcuts: Record<Tool, string> = {
  select: "V",
  place: "B",
  rect: "M",
  ellipse: "O",
  line: "L",
  polygon: "P",
  label: "T"
};

const viewShortcuts: Record<ViewMode, string> = {
  plan: "1",
  model: "2"
};

const iconNodes: Record<string, IconNode> = {
  "3d": BoxIcon,
  circle: Circle,
  download: Download,
  "file-image": FileImage,
  "file-json": FileJson,
  import: ImportIcon,
  line: Slash,
  map: MapIcon,
  orbit: Orbit,
  polygon: Pentagon,
  redo: Redo2,
  select: MousePointer2,
  square: Square,
  stamp: Stamp,
  text: TypeIcon,
  trash: Trash2,
  undo: Undo2
};

const scaleHandles: ScaleHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const placementDefaults: Record<PlacementPreset, { kind: FeatureKind; label: string; width: number; length: number; height: number; depth: number }> = {
  surface: { kind: "surface", label: "Surface building", width: 260, length: 150, height: 34, depth: 0 },
  underground: { kind: "underground", label: "Underground volume", width: 430, length: 240, height: 58, depth: 80 },
  entrance: { kind: "entrance", label: "Entrance", width: 44, length: 44, height: 24, depth: 0 }
};

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
let zoom = initialZoom;
let pan = { x: 0, y: 0 };
let referenceDataUrl = "";
let terrainTexture: THREE.Texture | null = null;
let placementPreset: PlacementPreset = "surface";
let placementWidth = placementDefaults.surface.width;
let placementLength = placementDefaults.surface.length;
let placementRotation = 0;
let pointerPoint: Point | null = null;
let activePan: PanState | null = null;
let spacePanning = false;
let freeTransformId = "";
let lastSelectClick: { id: string; point: Point; time: number } | null = null;
let activeTransform: ActiveTransform | null = null;
let undoStack: HistorySnapshot[] = [];
let redoStack: HistorySnapshot[] = [];

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
        <button id="undoEdit" class="iconText" title="Undo (Cmd/Ctrl+Z)"><span data-icon="undo"></span><span>Undo</span></button>
        <button id="redoEdit" class="iconText" title="Redo (Cmd/Ctrl+Shift+Z)"><span data-icon="redo"></span><span>Redo</span></button>
        <button id="exportJson" class="iconText"><span data-icon="file-json"></span><span>Export JSON</span></button>
        <button id="importJson" class="iconText"><span data-icon="import"></span><span>Import JSON</span></button>
        <button id="exportSvg" class="iconText"><span data-icon="download"></span><span>Export SVG</span></button>
        <button id="exportPng" class="iconText"><span data-icon="file-image"></span><span>Export PNG</span></button>
        <button id="exportModelPng" class="iconText"><span data-icon="3d"></span><span>Export 3D PNG</span></button>
      </div>
    </header>

    <section class="workspace">
      <aside class="panel controls">
        <div class="group">
          <label>View</label>
          <div class="segmented" id="viewButtons">
            <button data-view="plan" title="Plan view (1)" aria-keyshortcuts="${viewShortcuts.plan}">
              <span data-icon="map"></span>
              <span>Plan</span>
              <kbd>${viewShortcuts.plan}</kbd>
            </button>
            <button data-view="model" title="3D orbit view (2)" aria-keyshortcuts="${viewShortcuts.model}">
              <span data-icon="orbit"></span>
              <span>3D Orbit</span>
              <kbd>${viewShortcuts.model}</kbd>
            </button>
          </div>
        </div>

        <div class="group">
          <label>Tool</label>
          <div class="segmented" id="toolButtons">
            <button data-tool="select" title="Select tool (V)" aria-keyshortcuts="${toolShortcuts.select}">
              <span data-icon="select"></span>
              <span>Select</span>
              <kbd>${toolShortcuts.select}</kbd>
            </button>
            <button data-tool="place" title="Place building stamp (B)" aria-keyshortcuts="${toolShortcuts.place}">
              <span data-icon="stamp"></span>
              <span>Place</span>
              <kbd>${toolShortcuts.place}</kbd>
            </button>
            <button data-tool="rect" title="Box marquee (M)" aria-keyshortcuts="${toolShortcuts.rect}">
              <span data-icon="square"></span>
              <span>Box</span>
              <kbd>${toolShortcuts.rect}</kbd>
            </button>
            <button data-tool="ellipse" title="Oval shape (O)" aria-keyshortcuts="${toolShortcuts.ellipse}">
              <span data-icon="circle"></span>
              <span>Oval</span>
              <kbd>${toolShortcuts.ellipse}</kbd>
            </button>
            <button data-tool="line" title="Line tool (L)" aria-keyshortcuts="${toolShortcuts.line}">
              <span data-icon="line"></span>
              <span>Line</span>
              <kbd>${toolShortcuts.line}</kbd>
            </button>
            <button data-tool="polygon" title="Polygon pen (P)" aria-keyshortcuts="${toolShortcuts.polygon}">
              <span data-icon="polygon"></span>
              <span>Poly</span>
              <kbd>${toolShortcuts.polygon}</kbd>
            </button>
            <button data-tool="label" title="Text tool (T)" aria-keyshortcuts="${toolShortcuts.label}">
              <span data-icon="text"></span>
              <span>Text</span>
              <kbd>${toolShortcuts.label}</kbd>
            </button>
          </div>
        </div>

        <div class="group">
          <label for="placementPreset">Placement stamp</label>
          <select id="placementPreset">
            <option value="surface">Surface building block</option>
            <option value="underground">Underground hall block</option>
            <option value="entrance">Entrance marker</option>
          </select>
          <div class="twoCol">
            <label for="placementWidth">Width</label>
            <input id="placementWidth" type="number" min="8" max="1200" step="2" />
            <label for="placementLength">Length</label>
            <input id="placementLength" type="number" min="8" max="1200" step="2" />
          </div>
          <label for="placementRotation">Rotation before placing</label>
          <input id="placementRotation" type="range" min="-180" max="180" step="1" />
          <div class="nudgeGrid">
            <button data-rotate-stamp="-15">-15</button>
            <button data-rotate-stamp="15">+15</button>
            <button id="rotateStamp90">90</button>
            <button id="resetStampRotation">Reset</button>
          </div>
          <p class="hint">Choose Place, set size and angle, then click the map. Zoom stays exactly where it is.</p>
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
          <input id="zoom" type="range" min="${minPlanZoom}" max="${maxPlanZoom}" step="0.02" value="${initialZoom}" />
          <button id="resetPlanView" class="iconText" title="Reset plan pan and zoom (0)">
            <span data-icon="map"></span>
            <span>Reset view</span>
            <kbd>0</kbd>
          </button>
        </div>

        <div class="group selected">
          <label>Selected feature</label>
          <input id="labelInput" placeholder="Label" />
          <label for="heightInput">Height / thickness</label>
          <input id="heightInput" type="range" min="4" max="160" step="2" />
          <label for="depthInput">Depth below surface</label>
          <input id="depthInput" type="range" min="0" max="220" step="2" />
          <div class="twoCol">
            <label for="centerXInput">Center X</label>
            <input id="centerXInput" type="number" step="1" />
            <label for="centerYInput">Center Y</label>
            <input id="centerYInput" type="number" step="1" />
          </div>
          <label for="rotationInput">Selected rotation</label>
          <input id="rotationInput" type="range" min="-180" max="180" step="1" />
          <div class="nudgeGrid">
            <button data-nudge="0,-5">Up</button>
            <button data-nudge="-5,0">Left</button>
            <button data-nudge="5,0">Right</button>
            <button data-nudge="0,5">Down</button>
          </div>
          <textarea id="noteInput" placeholder="Evidence notes and citations"></textarea>
          <button id="deleteFeature" class="iconText danger" title="Delete selected feature (Delete/Backspace)">
            <span data-icon="trash"></span>
            <span>Delete</span>
            <kbd>Del</kbd>
          </button>
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
              <g id="transformLayer"></g>
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
const transformLayer = document.querySelector<SVGGElement>("#transformLayer")!;
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
    setViewMode(button.dataset.view as ViewMode);
  });

  document.querySelector("#toolButtons")!.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-tool]");
    if (!button) return;
    setTool(button.dataset.tool as Tool);
  });

  document.querySelector<HTMLSelectElement>("#placementPreset")!.addEventListener("change", (event) => {
    placementPreset = (event.target as HTMLSelectElement).value as PlacementPreset;
    const preset = placementDefaults[placementPreset];
    placementWidth = preset.width;
    placementLength = preset.length;
    kind = preset.kind;
    document.querySelector<HTMLSelectElement>("#kind")!.value = kind;
    render();
  });

  document.querySelector<HTMLInputElement>("#placementWidth")!.addEventListener("input", (event) => {
    placementWidth = Number((event.target as HTMLInputElement).value);
    renderDraft();
  });

  document.querySelector<HTMLInputElement>("#placementLength")!.addEventListener("input", (event) => {
    placementLength = Number((event.target as HTMLInputElement).value);
    renderDraft();
  });

  document.querySelector<HTMLInputElement>("#placementRotation")!.addEventListener("input", (event) => {
    placementRotation = Number((event.target as HTMLInputElement).value);
    renderDraft();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-rotate-stamp]").forEach((button) => {
    button.addEventListener("click", () => {
      rotatePlacementStamp(Number(button.dataset.rotateStamp));
    });
  });

  document.querySelector("#rotateStamp90")!.addEventListener("click", () => {
    rotatePlacementStamp(90);
  });

  document.querySelector("#resetStampRotation")!.addEventListener("click", () => {
    placementRotation = 0;
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
    setPlanZoom(Number((event.target as HTMLInputElement).value));
  });

  document.querySelector("#resetPlanView")!.addEventListener("click", resetPlanView);

  document.querySelector<HTMLInputElement>("#labelInput")!.addEventListener("input", (event) => {
    updateSelected({ label: (event.target as HTMLInputElement).value });
  });

  document.querySelector<HTMLInputElement>("#heightInput")!.addEventListener("input", (event) => {
    updateSelected({ height: Number((event.target as HTMLInputElement).value) });
  });

  document.querySelector<HTMLInputElement>("#depthInput")!.addEventListener("input", (event) => {
    updateSelected({ depth: Number((event.target as HTMLInputElement).value) });
  });

  document.querySelector<HTMLInputElement>("#centerXInput")!.addEventListener("change", (event) => {
    const selected = selectedFeature();
    if (!selected) return;
    const current = centroid(selected.points);
    moveSelected(Number((event.target as HTMLInputElement).value) - current.x, 0);
  });

  document.querySelector<HTMLInputElement>("#centerYInput")!.addEventListener("change", (event) => {
    const selected = selectedFeature();
    if (!selected) return;
    const current = centroid(selected.points);
    moveSelected(0, Number((event.target as HTMLInputElement).value) - current.y);
  });

  document.querySelector<HTMLInputElement>("#rotationInput")!.addEventListener("input", (event) => {
    rotateSelectedTo(Number((event.target as HTMLInputElement).value));
  });

  document.querySelectorAll<HTMLButtonElement>("[data-nudge]").forEach((button) => {
    button.addEventListener("click", () => {
      const [dx, dy] = (button.dataset.nudge ?? "0,0").split(",").map(Number);
      moveSelected(dx, dy);
    });
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

  document.querySelector("#deleteFeature")!.addEventListener("click", deleteSelectedFeature);

  document.querySelector("#seedNatanz")!.addEventListener("click", seedNatanzLayout);

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", onPointerUp);
  stage.addEventListener("pointercancel", endPlanPan);
  stage.addEventListener("pointerleave", () => {
    if (activePan || activeTransform) return;
    pointerPoint = null;
    renderDraft();
  });
  stage.addEventListener("wheel", onStageWheel, { passive: false });
  stage.addEventListener("contextmenu", (event) => event.preventDefault());
  stage.addEventListener("click", onStageClick);
  stage.addEventListener("dblclick", onStageDoubleClick);
  window.addEventListener("resize", resizeModel);
  window.addEventListener("keydown", handleHotkeys);
  window.addEventListener("keyup", handleKeyUp);

  document.querySelector("#undoEdit")!.addEventListener("click", undoEdit);
  document.querySelector("#redoEdit")!.addEventListener("click", redoEdit);
  document.querySelector("#exportJson")!.addEventListener("click", exportJson);
  document.querySelector("#exportSvg")!.addEventListener("click", exportSvg);
  document.querySelector("#exportPng")!.addEventListener("click", exportPng);
  document.querySelector("#exportModelPng")!.addEventListener("click", exportModelPng);
  document.querySelector("#importJson")!.addEventListener("click", () => document.querySelector<HTMLInputElement>("#fileImport")!.click());
  document.querySelector<HTMLInputElement>("#fileImport")!.addEventListener("change", importJson);
}

function setTool(nextTool: Tool) {
  tool = nextTool;
  draft = [];
  pointerStart = null;
  activeTransform = null;
  clearPlanPanState();
  if (tool !== "select") freeTransformId = "";
  if (tool === "place") viewMode = "plan";
  render();
  if (viewMode === "model") resizeModel();
}

function setViewMode(nextViewMode: ViewMode) {
  viewMode = nextViewMode;
  draft = [];
  pointerStart = null;
  activeTransform = null;
  clearPlanPanState();
  if (viewMode !== "plan") freeTransformId = "";
  render();
  resizeModel();
}

function setPlacementPreset(nextPreset: PlacementPreset) {
  placementPreset = nextPreset;
  const preset = placementDefaults[placementPreset];
  placementWidth = preset.width;
  placementLength = preset.length;
  kind = preset.kind;
  setTool("place");
}

function rotatePlacementStamp(delta: number) {
  placementRotation = normalizeDegrees(placementRotation + delta);
  render();
}

function setPlanZoom(nextZoom: number, focalStagePoint = stageCenterPoint()) {
  zoomPlanTo(nextZoom, focalStagePoint);
}

function zoomPlanTo(nextZoom: number, focalStagePoint: Point) {
  const clampedZoom = clamp(Number(nextZoom.toFixed(3)), minPlanZoom, maxPlanZoom);
  if (clampedZoom === zoom) return;
  const focalImagePoint = imagePointFromStagePoint(focalStagePoint);
  zoom = clampedZoom;
  pan = {
    x: focalStagePoint.x - focalImagePoint.x * zoom,
    y: focalStagePoint.y - focalImagePoint.y * zoom
  };
  render();
}

function resetPlanView() {
  zoom = initialZoom;
  pan = { x: 0, y: 0 };
  render();
}

function cancelCurrentAction() {
  draft = [];
  pointerStart = null;
  activeTransform = null;
  clearPlanPanState();
  freeTransformId = "";
  pointerPoint = null;
  setTool("select");
}

function onStageWheel(event: WheelEvent) {
  if (viewMode !== "plan" || Math.abs(event.deltaY) < 0.01) return;
  event.preventDefault();
  const zoomFactor = Math.exp(-event.deltaY * 0.0015);
  setPlanZoom(zoom * zoomFactor, stagePointFromClient(event.clientX, event.clientY));
}

function startPlanPan(event: PointerEvent) {
  activePan = {
    pointerId: event.pointerId,
    startClient: { x: event.clientX, y: event.clientY },
    startPan: { ...pan }
  };
  pointerStart = null;
  activeTransform = null;
  draft = [];
  try {
    stage.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic and some browser-generated auxiliary pointer events may not be capturable.
  }
  stage.classList.add("panning");
  event.preventDefault();
}

function updatePlanPan(event: PointerEvent) {
  if (!activePan || event.pointerId !== activePan.pointerId) return;
  const delta = clientDeltaToStageDelta(event.clientX - activePan.startClient.x, event.clientY - activePan.startClient.y);
  pan = {
    x: activePan.startPan.x + delta.x,
    y: activePan.startPan.y + delta.y
  };
  render();
}

function endPlanPan(event: PointerEvent) {
  if (!activePan || event.pointerId !== activePan.pointerId) return;
  if (stage.hasPointerCapture(event.pointerId)) {
    try {
      stage.releasePointerCapture(event.pointerId);
    } catch {
      // Capture can already be gone after cancelled auxiliary-button gestures.
    }
  }
  activePan = null;
  stage.classList.remove("panning");
}

function clearPlanPanState() {
  if (activePan && stage.hasPointerCapture(activePan.pointerId)) {
    try {
      stage.releasePointerCapture(activePan.pointerId);
    } catch {
      // Capture can already be gone after cancelled auxiliary-button gestures.
    }
  }
  activePan = null;
  stage.classList.remove("panning");
}

function shouldStartPlanPan(event: PointerEvent) {
  return viewMode === "plan" && (event.button === 1 || event.button === 2 || (event.button === 0 && spacePanning));
}

function handleHotkeys(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  const combo = event.metaKey || event.ctrlKey;

  if (combo && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redoEdit();
    else undoEdit();
    return;
  }
  if (combo && key === "y") {
    event.preventDefault();
    redoEdit();
    return;
  }
  if (combo && key === "t") {
    event.preventDefault();
    toggleFreeTransform();
    return;
  }
  if (combo && !["=", "+", "-", "0"].includes(event.key)) return;

  if (isTypingTarget(event.target)) {
    if (event.key === "Escape") (event.target as HTMLElement).blur();
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    spacePanning = true;
    stage.classList.add("panReady");
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    cancelCurrentAction();
    return;
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelectedFeature();
    return;
  }

  if (event.key.startsWith("Arrow")) {
    const step = event.shiftKey ? 25 : 5;
    const movement = {
      ArrowUp: { dx: 0, dy: -step },
      ArrowDown: { dx: 0, dy: step },
      ArrowLeft: { dx: -step, dy: 0 },
      ArrowRight: { dx: step, dy: 0 }
    }[event.key];
    if (movement) {
      event.preventDefault();
      moveSelected(movement.dx, movement.dy);
    }
    return;
  }

  if (event.code === "BracketLeft" || event.code === "BracketRight") {
    event.preventDefault();
    const delta = event.code === "BracketRight" ? 15 : -15;
    if (event.shiftKey && selectedFeature()) rotateSelectedBy(delta);
    else rotatePlacementStamp(delta);
    return;
  }

  if (event.key === "=" || event.key === "+") {
    event.preventDefault();
    setPlanZoom(zoom + 0.08);
    return;
  }

  if (event.key === "-") {
    event.preventDefault();
    setPlanZoom(zoom - 0.08);
    return;
  }

  if (event.key === "0") {
    event.preventDefault();
    resetPlanView();
    return;
  }

  const shortcutActions: Record<string, () => void> = {
    "1": () => setViewMode("plan"),
    "2": () => setViewMode("model"),
    b: () => setPlacementPreset("surface"),
    e: () => setPlacementPreset("entrance"),
    l: () => setTool("line"),
    m: () => setTool("rect"),
    o: () => setTool("ellipse"),
    p: () => setTool("polygon"),
    d: duplicateSelectedFeature,
    t: () => setTool("label"),
    u: () => setPlacementPreset("underground"),
    v: () => setTool("select")
  };
  const action = shortcutActions[key];
  if (!action) return;
  event.preventDefault();
  action();
}

function handleKeyUp(event: KeyboardEvent) {
  if (event.code !== "Space") return;
  spacePanning = false;
  stage.classList.remove("panReady");
}

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));
}

function deleteSelectedFeature() {
  if (!selectedId) return;
  pushHistory();
  features = features.filter((feature) => feature.id !== selectedId);
  selectedId = features[0]?.id ?? "";
  saveState();
  render();
}

function duplicateSelectedFeature() {
  const selected = selectedFeature();
  if (!selected) return;
  pushHistory();
  const duplicate = cloneFeature(selected);
  duplicate.id = crypto.randomUUID();
  duplicate.label = selected.label ? `${selected.label} copy` : defaultLabel(selected.kind);
  duplicate.points = duplicate.points.map((point) => ({ x: point.x + 36, y: point.y + 36 }));
  features.push(duplicate);
  selectedId = duplicate.id;
  saveState();
  render();
}

function rotateSelectedBy(delta: number) {
  const feature = selectedFeature();
  if (!feature) return;
  rotateSelectedTo(normalizeDegrees(feature.rotation + delta));
}

function toggleFreeTransform() {
  const selected = selectedFeature();
  if (!selected || selected.points.length < 2) return;
  tool = "select";
  freeTransformId = freeTransformId === selected.id ? "" : selected.id;
  draft = [];
  pointerStart = null;
  activeTransform = null;
  render();
}

function openFreeTransform(featureId: string) {
  const feature = features.find((candidate) => candidate.id === featureId);
  if (!feature || feature.points.length < 2) return;
  tool = "select";
  selectedId = feature.id;
  freeTransformId = feature.id;
  draft = [];
  pointerStart = null;
  activeTransform = null;
  render();
}

function pushHistory() {
  undoStack.push(snapshotState());
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
}

function undoEdit() {
  const previous = undoStack.pop();
  if (!previous) return;
  redoStack.push(snapshotState());
  restoreSnapshot(previous);
}

function redoEdit() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(snapshotState());
  restoreSnapshot(next);
}

function snapshotState(): HistorySnapshot {
  return {
    features: features.map(cloneFeature),
    selectedId
  };
}

function restoreSnapshot(snapshot: HistorySnapshot) {
  features = snapshot.features.map(cloneFeature);
  selectedId = features.some((feature) => feature.id === snapshot.selectedId) ? snapshot.selectedId : features[0]?.id ?? "";
  saveState();
  render();
}

function onPointerDown(event: PointerEvent) {
  if (viewMode !== "plan") return;
  if (shouldStartPlanPan(event)) {
    startPlanPan(event);
    return;
  }
  if (event.button !== 0) return;
  const point = svgPoint(event);
  pointerPoint = point;
  if (tool === "place") {
    createPlacementFeature(point);
    return;
  }
  if (tool === "select") {
    const handle = (event.target as Element).closest<SVGElement>("[data-transform]");
    const feature = selectedFeature();
    if (handle && feature) {
      const center = centroid(feature.points);
      const isDoubleTransformClick = handle.dataset.transform === "move" && lastSelectClick?.id === feature.id && event.timeStamp - lastSelectClick.time < 1000 && distance(point, lastSelectClick.point) < 44 / zoom;
      if (isDoubleTransformClick) {
        lastSelectClick = null;
        event.preventDefault();
        openFreeTransform(feature.id);
        return;
      }
      if (handle.dataset.transform === "scale") {
        const box = orientedBox(feature);
        const scaleHandle = handle.dataset.scaleHandle as ScaleHandle;
        activeTransform = {
          mode: "scale",
          id: feature.id,
          startPoint: point,
          initialPoints: clonePoints(feature.points),
          initialRotation: feature.rotation,
          center: box.center,
          startAngle: 0,
          historyPushed: false,
          scaleAnchor: scaleAnchorLocal(box, scaleHandle),
          scaleHandle,
          scaleHandleStart: scaleHandleLocal(box, scaleHandle),
          initialLocalPoints: feature.points.map((candidate) => toLocalPoint(candidate, box.center, box.rotation))
        };
        event.preventDefault();
        return;
      }
      activeTransform = {
        mode: handle.dataset.transform === "rotate" ? "rotate" : "move",
        id: feature.id,
        startPoint: point,
        initialPoints: clonePoints(feature.points),
        initialRotation: feature.rotation,
        center,
        startAngle: angleBetween(center, point),
        historyPushed: false
      };
      event.preventDefault();
      return;
    }
    const node = (event.target as Element).closest<SVGElement>("[data-id]");
    const nextSelectedId = node?.dataset.id ?? "";
    const isDoubleSelect = Boolean(nextSelectedId && lastSelectClick?.id === nextSelectedId && event.timeStamp - lastSelectClick.time < 1000 && distance(point, lastSelectClick.point) < 36 / zoom);
    lastSelectClick = nextSelectedId ? { id: nextSelectedId, point, time: event.timeStamp } : null;
    if (selectedId !== nextSelectedId) freeTransformId = "";
    selectedId = nextSelectedId;
    if (isDoubleSelect) {
      event.preventDefault();
      openFreeTransform(nextSelectedId);
      return;
    }
    const selected = selectedFeature();
    if (selected) {
      activeTransform = {
        mode: "move",
        id: selected.id,
        startPoint: point,
        initialPoints: clonePoints(selected.points),
        initialRotation: selected.rotation,
        center: centroid(selected.points),
        startAngle: 0,
        historyPushed: false
      };
    }
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

function onStageClick(event: MouseEvent) {
  if (event.detail < 2) return;
  openFreeTransformFromEvent(event);
}

function onStageDoubleClick(event: MouseEvent) {
  if (viewMode !== "plan") return;
  if (tool === "polygon") {
    finishPolygon();
    return;
  }
  openFreeTransformFromEvent(event);
}

function openFreeTransformFromEvent(event: MouseEvent) {
  if (viewMode !== "plan" || tool !== "select") return;
  const node = (event.target as Element).closest<SVGElement>("[data-id]");
  const transformNode = (event.target as Element).closest<SVGElement>("[data-transform], .transformBox");
  const nextSelectedId = node?.dataset.id ?? (transformNode ? selectedId : "");
  if (!nextSelectedId) {
    freeTransformId = "";
    render();
    return;
  }
  event.preventDefault();
  openFreeTransform(nextSelectedId);
}

function onPointerMove(event: PointerEvent) {
  if (viewMode !== "plan") return;
  if (activePan) {
    updatePlanPan(event);
    return;
  }
  const point = svgPoint(event);
  pointerPoint = point;
  if (activeTransform) {
    updateActiveTransform(point);
    return;
  }
  if (tool === "place") {
    renderDraft();
    return;
  }
  if (!pointerStart) return;
  draft = shapeFromDrag(pointerStart, point, tool);
  renderDraft();
}

function onPointerUp(event: PointerEvent) {
  if (activePan) {
    endPlanPan(event);
    return;
  }
  if (activeTransform) {
    activeTransform = null;
    saveState();
    render();
    return;
  }
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
  pushHistory();
  const feature: Feature = {
    id: crypto.randomUUID(),
    kind: featureKind,
    certainty,
    label,
    note: "",
    points,
    height: defaultHeight(featureKind),
    depth: defaultDepth(featureKind),
    rotation: 0
  };
  features.push(feature);
  selectedId = feature.id;
  saveState();
  render();
}

function createPlacementFeature(center: Point) {
  pushHistory();
  const preset = placementDefaults[placementPreset];
  const points = preset.kind === "entrance" ? [center] : stampPoints(center, placementWidth, placementLength, placementRotation);
  const feature: Feature = {
    id: crypto.randomUUID(),
    kind: preset.kind,
    certainty,
    label: preset.label,
    note: "",
    points,
    height: preset.height,
    depth: preset.depth,
    rotation: placementRotation
  };
  features.push(feature);
  selectedId = feature.id;
  kind = feature.kind;
  saveState();
  render();
}

function updateActiveTransform(point: Point) {
  if (!activeTransform) return;
  const feature = features.find((candidate) => candidate.id === activeTransform?.id);
  if (!feature) return;
  if (!activeTransform.historyPushed) {
    pushHistory();
    activeTransform.historyPushed = true;
  }

  if (activeTransform.mode === "move") {
    const dx = point.x - activeTransform.startPoint.x;
    const dy = point.y - activeTransform.startPoint.y;
    feature.points = activeTransform.initialPoints.map((initial) => ({ x: initial.x + dx, y: initial.y + dy }));
  } else if (activeTransform.mode === "rotate") {
    const delta = angleBetween(activeTransform.center, point) - activeTransform.startAngle;
    feature.points = rotatePoints(activeTransform.initialPoints, activeTransform.center, delta);
    feature.rotation = normalizeDegrees(activeTransform.initialRotation + radiansToDegrees(delta));
  } else {
    scaleActiveFeature(feature, point);
  }

  renderFeatures();
  renderTransform();
  renderList();
  renderInspector();
  renderModel();
}

function scaleActiveFeature(feature: Feature, point: Point) {
  if (!activeTransform?.scaleAnchor || !activeTransform.scaleHandleStart || !activeTransform.initialLocalPoints) return;
  const pointerLocal = toLocalPoint(point, activeTransform.center, activeTransform.initialRotation);
  const anchor = activeTransform.scaleAnchor;
  const handleStart = activeTransform.scaleHandleStart;
  const handle = activeTransform.scaleHandle ?? "se";
  const affectsX = handle.includes("e") || handle.includes("w");
  const affectsY = handle.includes("n") || handle.includes("s");
  const scaleX = affectsX ? scaleRatio(pointerLocal.x - anchor.x, handleStart.x - anchor.x) : 1;
  const scaleY = affectsY ? scaleRatio(pointerLocal.y - anchor.y, handleStart.y - anchor.y) : 1;
  feature.points = activeTransform.initialLocalPoints.map((initial) => fromLocalPoint({
    x: anchor.x + (initial.x - anchor.x) * scaleX,
    y: anchor.y + (initial.y - anchor.y) * scaleY
  }, activeTransform.center, activeTransform.initialRotation));
}

function moveSelected(dx: number, dy: number) {
  if (!selectedId || (!dx && !dy)) return;
  pushHistory();
  features = features.map((feature) => {
    if (feature.id !== selectedId) return feature;
    return { ...feature, points: feature.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
  });
  saveState();
  render();
}

function rotateSelectedTo(rotation: number) {
  const feature = selectedFeature();
  if (!feature) return;
  pushHistory();
  const nextRotation = normalizeDegrees(rotation);
  const delta = degreesToRadians(nextRotation - feature.rotation);
  const center = centroid(feature.points);
  features = features.map((candidate) => {
    if (candidate.id !== feature.id) return candidate;
    return { ...candidate, points: rotatePoints(candidate.points, center, delta), rotation: nextRotation };
  });
  saveState();
  render();
}

function updateSelected(patch: Partial<Feature>) {
  if (!selectedId) return;
  pushHistory();
  features = features.map((feature) => feature.id === selectedId ? normalizeFeature({ ...feature, ...patch }) : feature);
  saveState();
  render();
}

function render() {
  viewport.setAttribute("transform", `matrix(${zoom} 0 0 ${zoom} ${pan.x} ${pan.y})`);
  referenceImage.style.display = showReference && referenceImage.getAttribute("href") ? "block" : "none";
  referenceImage.style.opacity = String(referenceOpacity);
  stage.classList.toggle("hidden", viewMode !== "plan");
  modelStage.classList.toggle("active", viewMode === "model");
  document.querySelector(".modelHud")!.classList.toggle("active", viewMode === "model");
  renderToolbar();
  renderFeatures();
  renderTransform();
  renderDraft();
  renderList();
  renderInspector();
  renderModel();
  renderIcons();
}

function renderToolbar() {
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewMode);
  });
  document.querySelector<HTMLButtonElement>("#undoEdit")!.disabled = undoStack.length === 0;
  document.querySelector<HTMLButtonElement>("#redoEdit")!.disabled = redoStack.length === 0;
}

function renderIcons() {
  document.querySelectorAll<HTMLElement>("[data-icon]").forEach((slot) => {
    const icon = iconNodes[slot.dataset.icon ?? ""];
    if (!icon) return;
    const element = createElement(icon, {
      width: 18,
      height: 18,
      "aria-hidden": "true"
    });
    slot.replaceChildren(element);
  });
}

function renderFeatures() {
  featureLayer.innerHTML = features.map((feature) => featureSvg(feature, false)).join("");
}

function renderTransform() {
  const selected = selectedFeature();
  if (!selected || viewMode !== "plan") {
    transformLayer.innerHTML = "";
    return;
  }
  const center = centroid(selected.points);
  const radius = Math.max(85, Math.sqrt(areaBounds(selected.points)) * 0.7);
  const handleAngle = degreesToRadians(selected.rotation - 90);
  const rotateHandle = { x: center.x + Math.cos(handleAngle) * radius, y: center.y + Math.sin(handleAngle) * radius };
  const closeOutline = selected.kind !== "road" && selected.kind !== "fence";
  const freeTransform = freeTransformId === selected.id && selected.points.length > 1 ? freeTransformSvg(selected) : "";
  transformLayer.innerHTML = `
    <g class="transformBox">
      <path d="${pathData(selected.points, closeOutline)}" />
      ${freeTransform}
      <line x1="${center.x}" y1="${center.y}" x2="${rotateHandle.x}" y2="${rotateHandle.y}" />
      <circle data-transform="move" cx="${center.x}" cy="${center.y}" r="18" />
      <circle data-transform="rotate" class="rotateHandle" cx="${rotateHandle.x}" cy="${rotateHandle.y}" r="24" />
    </g>
  `;
}

function freeTransformSvg(feature: Feature) {
  const box = orientedBox(feature);
  const points = ["nw", "ne", "se", "sw"].map((handle) => scaleHandleWorld(box, handle as ScaleHandle));
  return `
    <path class="freeTransformBounds" d="${pathData(points, true)}" />
    ${scaleHandles.map((handle) => {
      const point = scaleHandleWorld(box, handle);
      return `<rect data-transform="scale" data-scale-handle="${handle}" class="scaleHandle ${handle}" x="${point.x - 18}" y="${point.y - 18}" width="36" height="36" transform="rotate(${box.rotation} ${point.x} ${point.y})" />`;
    }).join("")}
  `;
}

function renderDraft() {
  if (tool === "place" && pointerPoint && viewMode === "plan") {
    const ghost = stampPoints(pointerPoint, placementWidth, placementLength, placementRotation);
    draftLayer.innerHTML = `<path class="draft stampGhost" d="${pathData(ghost, placementPreset !== "entrance")}" />`;
    return;
  }
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
  document.querySelector<HTMLInputElement>("#centerXInput")!.value = selected ? String(Math.round(centroid(selected.points).x)) : "";
  document.querySelector<HTMLInputElement>("#centerYInput")!.value = selected ? String(Math.round(centroid(selected.points).y)) : "";
  document.querySelector<HTMLInputElement>("#rotationInput")!.value = String(selected?.rotation ?? placementRotation);
  document.querySelector<HTMLSelectElement>("#kind")!.value = selected?.kind ?? kind;
  document.querySelector<HTMLSelectElement>("#certainty")!.value = selected?.certainty ?? certainty;
  document.querySelector<HTMLSelectElement>("#placementPreset")!.value = placementPreset;
  document.querySelector<HTMLInputElement>("#placementWidth")!.value = String(Math.round(placementWidth));
  document.querySelector<HTMLInputElement>("#placementLength")!.value = String(Math.round(placementLength));
  document.querySelector<HTMLInputElement>("#placementRotation")!.value = String(placementRotation);
  document.querySelector<HTMLInputElement>("#zoom")!.value = String(zoom);
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
    pushHistory();
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

function stampPoints(center: Point, width: number, length: number, rotation: number) {
  const halfWidth = width / 2;
  const halfLength = length / 2;
  const base = [
    { x: center.x - halfWidth, y: center.y - halfLength },
    { x: center.x + halfWidth, y: center.y - halfLength },
    { x: center.x + halfWidth, y: center.y + halfLength },
    { x: center.x - halfWidth, y: center.y + halfLength }
  ];
  return rotatePoints(base, center, degreesToRadians(rotation));
}

function orientedBox(feature: Feature): OrientedBox {
  const center = centroid(feature.points);
  const rotation = feature.rotation;
  const localPoints = feature.points.map((point) => toLocalPoint(point, center, rotation));
  const box = bounds(localPoints);
  return {
    center,
    rotation,
    minX: box.minX,
    maxX: box.maxX,
    minY: box.minY,
    maxY: box.maxY
  };
}

function scaleHandleLocal(box: OrientedBox, handle: ScaleHandle): Point {
  const midX = (box.minX + box.maxX) / 2;
  const midY = (box.minY + box.maxY) / 2;
  return {
    nw: { x: box.minX, y: box.minY },
    n: { x: midX, y: box.minY },
    ne: { x: box.maxX, y: box.minY },
    e: { x: box.maxX, y: midY },
    se: { x: box.maxX, y: box.maxY },
    s: { x: midX, y: box.maxY },
    sw: { x: box.minX, y: box.maxY },
    w: { x: box.minX, y: midY }
  }[handle];
}

function scaleAnchorLocal(box: OrientedBox, handle: ScaleHandle): Point {
  return {
    nw: scaleHandleLocal(box, "se"),
    n: scaleHandleLocal(box, "s"),
    ne: scaleHandleLocal(box, "sw"),
    e: scaleHandleLocal(box, "w"),
    se: scaleHandleLocal(box, "nw"),
    s: scaleHandleLocal(box, "n"),
    sw: scaleHandleLocal(box, "ne"),
    w: scaleHandleLocal(box, "e")
  }[handle];
}

function scaleHandleWorld(box: OrientedBox, handle: ScaleHandle): Point {
  return fromLocalPoint(scaleHandleLocal(box, handle), box.center, box.rotation);
}

function toLocalPoint(point: Point, center: Point, rotation: number): Point {
  const unrotated = rotatedPoint(point, center, degreesToRadians(-rotation));
  return { x: unrotated.x - center.x, y: unrotated.y - center.y };
}

function fromLocalPoint(point: Point, center: Point, rotation: number): Point {
  return rotatedPoint({ x: center.x + point.x, y: center.y + point.y }, center, degreesToRadians(rotation));
}

function scaleRatio(current: number, initial: number) {
  if (Math.abs(initial) < 0.001) return 1;
  return clamp(current / initial, 0.06, 20);
}

function selectedFeature() {
  return features.find((feature) => feature.id === selectedId);
}

function cloneFeature(feature: Feature): Feature {
  return {
    ...feature,
    points: clonePoints(feature.points)
  };
}

function clonePoints(points: Point[]) {
  return points.map((point) => ({ ...point }));
}

function rotatePoints(points: Point[], center: Point, radians: number) {
  return points.map((point) => rotatedPoint(point, center, radians));
}

function rotatedPoint(point: Point, center: Point, radians: number) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos
  };
}

function angleBetween(center: Point, point: Point) {
  return Math.atan2(point.y - center.y, point.x - center.x);
}

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function radiansToDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function normalizeDegrees(degrees: number) {
  let normalized = ((degrees + 180) % 360) - 180;
  if (normalized < -180) normalized += 360;
  return Math.round(normalized);
}

function areaBounds(points: Point[]) {
  const box = bounds(points);
  return Math.max(1, (box.maxX - box.minX) * (box.maxY - box.minY));
}

function bounds(points: Point[]) {
  return points.reduce((box, point) => ({
    minX: Math.min(box.minX, point.x),
    minY: Math.min(box.minY, point.y),
    maxX: Math.max(box.maxX, point.x),
    maxY: Math.max(box.maxY, point.y)
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function seedNatanzLayout() {
  pushHistory();
  const starters: Array<Omit<Feature, "id">> = [
    {
      kind: "surface",
      certainty: "inferred",
      label: "Centrifuge assembly buildings",
      note: "Starter footprint for QA against public references.",
      height: 36,
      depth: 0,
      rotation: 0,
      points: rectPoints(620, 690, 720, 570)
    },
    {
      kind: "underground",
      certainty: "inferred",
      label: "Underground enrichment halls",
      note: "Approximate inferred underground volume. Adjust after source review.",
      height: 62,
      depth: 88,
      rotation: 0,
      points: rectPoints(1380, 860, 430, 330)
    },
    {
      kind: "underground",
      certainty: "speculative",
      label: "Buried support volume",
      note: "Speculative starter volume for QA.",
      height: 46,
      depth: 70,
      rotation: -18,
      points: stampPoints({ x: 1715, y: 1355 }, 410, 260, -18)
    },
    {
      kind: "entrance",
      certainty: "inferred",
      label: "Underground entrance",
      note: "Starter portal marker.",
      height: 28,
      depth: 0,
      rotation: 0,
      points: [{ x: 1410, y: 1530 }]
    },
    {
      kind: "road",
      certainty: "inferred",
      label: "Service road",
      note: "Starter service path.",
      height: 8,
      depth: 0,
      rotation: 0,
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

function stageCenterPoint() {
  const rect = stage.getBoundingClientRect();
  return stagePointFromClient(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function stagePointFromClient(clientX: number, clientY: number): Point {
  const point = stage.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const matrix = stage.getScreenCTM()?.inverse();
  const mapped = matrix ? point.matrixTransform(matrix) : point;
  return { x: mapped.x, y: mapped.y };
}

function imagePointFromStagePoint(point: Point): Point {
  return {
    x: (point.x - pan.x) / zoom,
    y: (point.y - pan.y) / zoom
  };
}

function clientDeltaToStageDelta(dx: number, dy: number): Point {
  const matrix = stage.getScreenCTM();
  return {
    x: matrix ? dx / matrix.a : dx,
    y: matrix ? dy / matrix.d : dy
  };
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
    depth: raw.depth ?? defaultDepth(normalizedKind),
    rotation: raw.rotation ?? 0
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
