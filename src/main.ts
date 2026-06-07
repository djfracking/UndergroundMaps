import "./styles.css";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  Box as BoxIcon,
  ChevronDown,
  ChevronUp,
  Circle,
  Download,
  Eye,
  EyeOff,
  FileImage,
  FileJson,
  Import as ImportIcon,
  Layers,
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
type LabelMode = "all" | "selected" | "hidden";
type PlacementPreset = "surface" | "underground" | "entrance";
type ReferenceResizeAxis = "width" | "height" | "both";

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

type SourceReference = {
  id: string;
  title: string;
  url: string;
  summary: string;
  citation: string;
};

type ReferenceLayer = {
  id: string;
  name: string;
  dataUrl: string;
  order: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  source: "file" | "url";
  naturalWidth?: number;
  naturalHeight?: number;
  createdAt: number;
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

type ActiveReferenceTransform = {
  mode: TransformMode;
  id: string;
  startPoint: Point;
  initialLayer: ReferenceLayer;
  center: Point;
  startAngle: number;
  scaleHandle?: ScaleHandle;
};

const image = { width: 2709, height: 2320 };
const worldScale = 0.18;
const initialZoom = 0.38;
const minPlanZoom = 0.12;
const maxPlanZoom = 5;
const referenceDbName = "undergroundmaps-reference-layers";
const referenceDbStore = "layers";
const referenceActiveKey = "undergroundmaps:activeReferenceLayer";
const referenceShowKey = "undergroundmaps:showReferences";
const referenceOpacityKey = "undergroundmaps:referenceOpacity";
const labelModeKey = "undergroundmaps:labelMode";

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
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  circle: Circle,
  download: Download,
  eye: Eye,
  "eye-off": EyeOff,
  "file-image": FileImage,
  "file-json": FileJson,
  import: ImportIcon,
  layers: Layers,
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

const sourceReferences: SourceReference[] = [
  {
    id: "isis-2026-entrances",
    title: "ISIS 2026 Natanz entrance imagery",
    url: "https://isis-online.org/isis-reports/damage-at-the-natanz-uranium-enrichment-plant",
    summary: "High-resolution imagery discussion identifies two personnel entrance buildings and the vehicle entrance for the older underground FEP; 2003 construction imagery shows entrances relative to the large buried halls.",
    citation: "Institute for Science and International Security, Damage at the Natanz Uranium Enrichment Plant, March 3, 2026."
  },
  {
    id: "isis-2022-tunnel-depth",
    title: "ISIS 2022 new tunnel depth estimate",
    url: "https://isis-online.org/isis-reports/irans-natanz-tunnel-complex-deeper-larger-than-expected/",
    summary: "Estimates the newer mountain tunnel complex depth from portal and ridge elevations; horizontal tunnels imply roughly 78 m or 145 m below the ridge, with about 110 m plausible if portal elevations meet.",
    citation: "Institute for Science and International Security, Iran's Natanz Tunnel Complex: Deeper, Larger than Expected, January 13, 2022."
  },
  {
    id: "isis-2021-tunnel-roads",
    title: "ISIS 2021 tunnel portals and access roads",
    url: "https://isis-online.org/isis-reports/detail/update-on-natanz-construction-progresses-towards-large-scale-tunnel-complex",
    summary: "Public imagery report describes the new construction staging/support area and roads leading toward eastern and western tunnel entrance areas in the mountain south of the main Natanz site.",
    citation: "Institute for Science and International Security, Update on Natanz: Construction Progresses Towards Large-scale Tunnel Complex, January 11, 2021."
  },
  {
    id: "globalsecurity-fep-depth",
    title: "GlobalSecurity Natanz FEP depth and overburden",
    url: "https://www.globalsecurity.org/wmd/world/iran/natanz-fep.htm",
    summary: "Describes the older FEP as two large underground halls built about 8 m deep, with concrete protection; also reports later hardening with reinforced concrete and about 75 ft of earth cover.",
    citation: "GlobalSecurity.org, Natanz (Kashan) Fuel Enrichment Plant."
  },
  {
    id: "iaea-2026-confirmation",
    title: "IAEA confirmation via public reporting",
    url: "https://www.nucnet.org/news/iaea-says-recent-damage-seen-to-natanz-entrance-buildings-no-radiological-impact-3-2-2026",
    summary: "Public reporting of IAEA statement confirms satellite-imagery-based damage assessment at entrance buildings of the underground Natanz FEP, with no expected radiological consequence.",
    citation: "NucNet, IAEA Says Recent Damage Seen To Natanz Entrance Buildings, March 2026."
  }
];

let tool: Tool = "select";
let kind: FeatureKind = "surface";
let certainty: Certainty = "inferred";
let viewMode: ViewMode = "plan";
let labelMode: LabelMode = normalizeLabelMode(localStorage.getItem(labelModeKey));
let features: Feature[] = loadState();
let imagerySource: ImagerySource = loadImagerySource();
let selectedId = features[0]?.id ?? "";
let draft: Point[] = [];
let pointerStart: Point | null = null;
let referenceLayers: ReferenceLayer[] = [];
let activeReferenceId = localStorage.getItem(referenceActiveKey) ?? "";
let referenceOpacity = Number(localStorage.getItem(referenceOpacityKey) ?? "0.48");
let showReference = localStorage.getItem(referenceShowKey) !== "false";
let zoom = initialZoom;
let pan = { x: 0, y: 0 };
let referenceRenderKey = "";
let referencePersistTimer: number | undefined;
let terrainTexture: THREE.Texture | null = null;
let placementPreset: PlacementPreset = "surface";
let placementWidth = placementDefaults.surface.width;
let placementLength = placementDefaults.surface.length;
let placementRotation = 0;
let pointerPoint: Point | null = null;
let activePan: PanState | null = null;
let spacePanning = false;
let freeTransformId = "";
let focusedReferenceId = "";
let lastSelectClick: { id: string; point: Point; time: number } | null = null;
let activeTransform: ActiveTransform | null = null;
let activeReferenceTransform: ActiveReferenceTransform | null = null;
let draggedReferenceId = "";
let undoStack: HistorySnapshot[] = [];
let redoStack: HistorySnapshot[] = [];

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app root");
const svgNs = "http://www.w3.org/2000/svg";

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
          <label for="labelMode">Labels</label>
          <select id="labelMode">
            <option value="all">Show all labels</option>
            <option value="selected">Selected only</option>
            <option value="hidden">Hide labels for QA</option>
          </select>
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
          <label for="referenceUpload">Reference images</label>
          <input id="referenceUpload" type="file" accept="image/*" multiple />
          <p class="hint">Saved in this browser for QA; omitted from schematic exports.</p>
          <label class="toggle"><input id="showReference" type="checkbox" checked /> Show references</label>
          <div class="quickReferenceControls">
            <label>Active reference size</label>
            <div class="nudgeGrid">
              <button data-reference-resize="width,1.12">Wider</button>
              <button data-reference-resize="width,0.88">Narrower</button>
              <button data-reference-resize="height,1.12">Taller</button>
              <button data-reference-resize="height,0.88">Shorter</button>
              <button id="quickFitReference">Fit</button>
              <button id="quickFillReference">Fill</button>
              <button id="quickResetReference">Reset</button>
              <button data-reference-resize="both,1.12">Scale up</button>
            </div>
            <label>Active reference move</label>
            <div class="nudgeGrid">
              <button data-reference-nudge="0,-50">Up</button>
              <button data-reference-nudge="-50,0">Left</button>
              <button data-reference-nudge="50,0">Right</button>
              <button data-reference-nudge="0,50">Down</button>
            </div>
          </div>
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
          <div class="depthPresets">
            <button data-depth-preset="fep-shallow" title="Older Natanz FEP reported shallow underground depth">FEP 8 m</button>
            <button data-depth-preset="fep-cover" title="Older Natanz FEP reported hardened earth cover">Cover 23 m</button>
            <button data-depth-preset="new-tunnel" title="Newer mountain tunnel complex inferred depth">Tunnel 110 m</button>
          </div>
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
              <g id="referenceLayer"></g>
              <rect class="terrain" width="${image.width}" height="${image.height}" />
              <g id="featureLayer"></g>
              <g id="referenceTransformLayer"></g>
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
          <button id="seedNatanz">Replace with sourced Natanz starter</button>
          <button id="addInfrastructure">Add roads and fences</button>
          <p class="hint">Approximate blocks for QA. Replace or adjust each feature against your evidence.</p>
        </div>
        <div class="group sourcePanel">
          <label>Source presets</label>
          <div id="sourceList" class="sourceList"></div>
        </div>
        <div class="group featurePanel">
          <label>Features</label>
          <div id="featureList" class="featureList"></div>
        </div>
        <div class="group layersPanel">
          <div class="panelTitle">
            <label>Layers</label>
            <span data-icon="layers"></span>
          </div>
          <div class="layerToolbar">
            <button id="referenceLayerUp" title="Move selected reference layer up"><span data-icon="chevron-up"></span></button>
            <button id="referenceLayerDown" title="Move selected reference layer down"><span data-icon="chevron-down"></span></button>
            <button id="fitReferenceLayer" title="Fit selected image inside canvas">Fit</button>
            <button id="fillReferenceLayer" title="Fill canvas with selected image">Fill</button>
          </div>
          <div id="referenceList" class="referenceList"></div>
          <div id="referenceInspector" class="referenceInspector">
            <label for="referenceName">Layer name</label>
            <input id="referenceName" placeholder="Reference image" />
            <label for="referenceOpacity">Opacity</label>
            <input id="referenceOpacity" type="range" min="0" max="1" step="0.02" value="0.48" />
            <div class="twoCol">
              <label for="referenceX">X</label>
              <input id="referenceX" type="number" step="1" />
              <label for="referenceY">Y</label>
              <input id="referenceY" type="number" step="1" />
              <label for="referenceWidth">Width</label>
              <input id="referenceWidth" type="number" min="1" step="1" />
              <label for="referenceHeight">Height</label>
              <input id="referenceHeight" type="number" min="1" step="1" />
            </div>
            <label for="referenceRotation">Rotation</label>
            <input id="referenceRotation" type="range" min="-180" max="180" step="1" />
            <div class="nudgeGrid">
              <button data-reference-nudge="0,-5">Up</button>
              <button data-reference-nudge="-5,0">Left</button>
              <button data-reference-nudge="5,0">Right</button>
              <button data-reference-nudge="0,5">Down</button>
              <button id="referenceRotateLeft">-15</button>
              <button id="referenceRotateRight">+15</button>
              <button id="resetReferenceLayer">Reset</button>
              <button id="deleteReferenceLayer" class="danger"><span data-icon="trash"></span></button>
            </div>
          </div>
        </div>
        <div class="group exportRule">
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
const referenceLayer = document.querySelector<SVGGElement>("#referenceLayer")!;
const featureLayer = document.querySelector<SVGGElement>("#featureLayer")!;
const referenceTransformLayer = document.querySelector<SVGGElement>("#referenceTransformLayer")!;
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
void initializeReferenceLayers();

function bind() {
  document.querySelector("#viewButtons")!.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-view]");
    if (!button) return;
    setViewMode(button.dataset.view as ViewMode);
  });

  document.querySelector<HTMLSelectElement>("#labelMode")!.addEventListener("change", (event) => {
    labelMode = normalizeLabelMode((event.target as HTMLSelectElement).value);
    localStorage.setItem(labelModeKey, labelMode);
    render();
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
    const active = focusedReferenceLayer();
    if (active) {
      active.opacity = referenceOpacity;
      schedulePersistReferenceLayer(active);
    }
    saveReferenceUiState();
    render();
  });

  document.querySelector<HTMLInputElement>("#showReference")!.addEventListener("change", (event) => {
    showReference = (event.target as HTMLInputElement).checked;
    saveReferenceUiState();
    render();
  });

  document.querySelector<HTMLInputElement>("#referenceUpload")!.addEventListener("change", (event) => {
    void loadReferenceImage(event);
  });

  document.querySelector<HTMLInputElement>("#referenceName")!.addEventListener("input", (event) => {
    void updateFocusedReferenceLayer({ name: (event.target as HTMLInputElement).value });
  });

  document.querySelector<HTMLInputElement>("#referenceX")!.addEventListener("input", (event) => {
    void updateFocusedReferenceLayer({ x: Number((event.target as HTMLInputElement).value) });
  });

  document.querySelector<HTMLInputElement>("#referenceY")!.addEventListener("input", (event) => {
    void updateFocusedReferenceLayer({ y: Number((event.target as HTMLInputElement).value) });
  });

  document.querySelector<HTMLInputElement>("#referenceWidth")!.addEventListener("input", (event) => {
    void updateFocusedReferenceLayer({ width: Number((event.target as HTMLInputElement).value) });
  });

  document.querySelector<HTMLInputElement>("#referenceHeight")!.addEventListener("input", (event) => {
    void updateFocusedReferenceLayer({ height: Number((event.target as HTMLInputElement).value) });
  });

  document.querySelector<HTMLInputElement>("#referenceRotation")!.addEventListener("input", (event) => {
    void updateFocusedReferenceLayer({ rotation: normalizeDegrees(Number((event.target as HTMLInputElement).value)) });
  });

  document.querySelector("#referenceLayerUp")!.addEventListener("click", () => {
    void moveReferenceLayerInStack(focusedReferenceId || activeReferenceId, -1);
  });

  document.querySelector("#referenceLayerDown")!.addEventListener("click", () => {
    void moveReferenceLayerInStack(focusedReferenceId || activeReferenceId, 1);
  });

  document.querySelector("#fitReferenceLayer")!.addEventListener("click", () => {
    void fitFocusedReferenceLayer("fit");
  });

  document.querySelector("#fillReferenceLayer")!.addEventListener("click", () => {
    void fitFocusedReferenceLayer("fill");
  });

  document.querySelector("#resetReferenceLayer")!.addEventListener("click", () => {
    void resetFocusedReferenceLayer();
  });

  document.querySelector("#deleteReferenceLayer")!.addEventListener("click", () => {
    void deleteReferenceLayer(focusedReferenceId || activeReferenceId);
  });

  document.querySelector("#referenceRotateLeft")!.addEventListener("click", () => {
    void rotateFocusedReferenceLayer(-15);
  });

  document.querySelector("#referenceRotateRight")!.addEventListener("click", () => {
    void rotateFocusedReferenceLayer(15);
  });

  document.querySelectorAll<HTMLButtonElement>("[data-reference-nudge]").forEach((button) => {
    button.addEventListener("click", () => {
      const [dx, dy] = (button.dataset.referenceNudge ?? "0,0").split(",").map(Number);
      void moveFocusedReferenceLayer(dx, dy);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-reference-resize]").forEach((button) => {
    button.addEventListener("click", () => {
      const [axis, factor] = (button.dataset.referenceResize ?? "").split(",");
      void resizeFocusedReferenceLayer(axis as ReferenceResizeAxis, Number(factor));
    });
  });

  document.querySelector("#quickFitReference")!.addEventListener("click", () => {
    void fitFocusedReferenceLayer("fit");
  });

  document.querySelector("#quickFillReference")!.addEventListener("click", () => {
    void fitFocusedReferenceLayer("fill");
  });

  document.querySelector("#quickResetReference")!.addEventListener("click", () => {
    void resetFocusedReferenceLayer();
  });

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

  document.querySelectorAll<HTMLButtonElement>("[data-depth-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      applyDepthPreset(button.dataset.depthPreset ?? "");
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
  document.querySelector("#addInfrastructure")!.addEventListener("click", addRoadsAndFences);

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", onPointerUp);
  stage.addEventListener("pointercancel", endPlanPan);
  stage.addEventListener("pointerleave", () => {
    if (activePan || activeTransform || activeReferenceTransform) return;
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
  activeReferenceTransform = null;
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
  activeReferenceTransform = null;
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
  activeReferenceTransform = null;
  clearPlanPanState();
  freeTransformId = "";
  focusedReferenceId = "";
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
    if (selectedId) deleteSelectedFeature();
    else if (focusedReferenceId) void deleteReferenceLayer(focusedReferenceId);
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
      if (selectedFeature()) moveSelected(movement.dx, movement.dy);
      else if (focusedReferenceId) void moveFocusedReferenceLayer(movement.dx, movement.dy);
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
  focusedReferenceId = "";
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
  focusedReferenceId = "";
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
  if (selectedId) focusedReferenceId = "";
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
    const referenceHandle = (event.target as Element).closest<SVGElement>("[data-reference-transform]");
    if (referenceHandle && focusedReferenceId) {
      const layer = referenceLayers.find((candidate) => candidate.id === focusedReferenceId);
      if (!layer) return;
      const center = referenceLayerCenter(layer);
      activeReferenceTransform = {
        mode: referenceHandle.dataset.referenceTransform === "rotate" ? "rotate" : referenceHandle.dataset.referenceTransform === "scale" ? "scale" : "move",
        id: layer.id,
        startPoint: point,
        initialLayer: cloneReferenceLayer(layer),
        center,
        startAngle: angleBetween(center, point),
        scaleHandle: referenceHandle.dataset.scaleHandle as ScaleHandle | undefined
      };
      try {
        stage.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic and some browser-generated pointer events may not be capturable.
      }
      event.preventDefault();
      return;
    }

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

    const referenceNode = (event.target as Element).closest<SVGElement>("[data-reference-id]");
    if (referenceNode) {
      const layer = referenceLayers.find((candidate) => candidate.id === referenceNode.dataset.referenceId);
      if (!layer) return;
      activeReferenceId = layer.id;
      focusedReferenceId = layer.id;
      selectedId = "";
      freeTransformId = "";
      referenceOpacity = layer.opacity;
      saveReferenceUiState();
      setTerrainTexture(layer.dataUrl);
      activeReferenceTransform = {
        mode: "move",
        id: layer.id,
        startPoint: point,
        initialLayer: cloneReferenceLayer(layer),
        center: referenceLayerCenter(layer),
        startAngle: 0
      };
      try {
        stage.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic and some browser-generated pointer events may not be capturable.
      }
      render();
      event.preventDefault();
      return;
    }

    const node = (event.target as Element).closest<SVGElement>("[data-id]");
    const nextSelectedId = node?.dataset.id ?? "";
    const isDoubleSelect = Boolean(nextSelectedId && lastSelectClick?.id === nextSelectedId && event.timeStamp - lastSelectClick.time < 1000 && distance(point, lastSelectClick.point) < 36 / zoom);
    lastSelectClick = nextSelectedId ? { id: nextSelectedId, point, time: event.timeStamp } : null;
    if (selectedId !== nextSelectedId) freeTransformId = "";
    selectedId = nextSelectedId;
    focusedReferenceId = "";
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
  const point = svgPoint(event, Boolean(activeReferenceTransform));
  pointerPoint = point;
  if (activeReferenceTransform) {
    updateActiveReferenceTransform(point);
    return;
  }
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
  if (activeReferenceTransform) {
    const layer = referenceLayers.find((candidate) => candidate.id === activeReferenceTransform?.id);
    if (stage.hasPointerCapture(event.pointerId)) {
      try {
        stage.releasePointerCapture(event.pointerId);
      } catch {
        // Capture can already be gone after cancelled pointer gestures.
      }
    }
    activeReferenceTransform = null;
    cancelScheduledReferencePersist();
    if (layer) void persistReferenceLayer(layer);
    render();
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
  focusedReferenceId = "";
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
  focusedReferenceId = "";
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

function updateActiveReferenceTransform(point: Point) {
  if (!activeReferenceTransform) return;
  const layer = referenceLayers.find((candidate) => candidate.id === activeReferenceTransform?.id);
  if (!layer) return;
  const initial = activeReferenceTransform.initialLayer;

  if (activeReferenceTransform.mode === "move") {
    layer.x = initial.x + point.x - activeReferenceTransform.startPoint.x;
    layer.y = initial.y + point.y - activeReferenceTransform.startPoint.y;
  } else if (activeReferenceTransform.mode === "rotate") {
    const delta = angleBetween(activeReferenceTransform.center, point) - activeReferenceTransform.startAngle;
    layer.rotation = normalizeDegrees(initial.rotation + radiansToDegrees(delta));
  } else {
    scaleActiveReferenceLayer(layer, point);
  }

  referenceRenderKey = "";
  renderReferenceLayers();
  renderReferenceTransform();
  renderReferenceList();
  renderReferenceInspector();
  renderIcons();
}

function scaleActiveReferenceLayer(layer: ReferenceLayer, point: Point) {
  if (!activeReferenceTransform?.scaleHandle) return;
  const initial = activeReferenceTransform.initialLayer;
  const handle = activeReferenceTransform.scaleHandle;
  const pointerLocal = toLocalPoint(point, activeReferenceTransform.center, initial.rotation);
  const affectsX = handle.includes("e") || handle.includes("w");
  const affectsY = handle.includes("n") || handle.includes("s");
  const halfWidth = Math.max(1, initial.width / 2);
  const halfHeight = Math.max(1, initial.height / 2);
  const scaleX = affectsX ? clamp(Math.abs(pointerLocal.x) / halfWidth, 0.02, 20) : 1;
  const scaleY = affectsY ? clamp(Math.abs(pointerLocal.y) / halfHeight, 0.02, 20) : 1;
  const nextWidth = Math.max(1, initial.width * scaleX);
  const nextHeight = Math.max(1, initial.height * scaleY);
  layer.width = nextWidth;
  layer.height = nextHeight;
  layer.x = activeReferenceTransform.center.x - nextWidth / 2;
  layer.y = activeReferenceTransform.center.y - nextHeight / 2;
}

async function updateFocusedReferenceLayer(patch: Partial<ReferenceLayer>) {
  const layer = focusedReferenceLayer();
  if (!layer) return;
  Object.assign(layer, patch);
  layer.name = layer.name.trim() || "Reference image";
  layer.width = Math.max(1, Number(layer.width) || image.width);
  layer.height = Math.max(1, Number(layer.height) || image.height);
  layer.x = Number.isFinite(layer.x) ? layer.x : 0;
  layer.y = Number.isFinite(layer.y) ? layer.y : 0;
  layer.rotation = normalizeDegrees(layer.rotation || 0);
  layer.opacity = clamp(Number(layer.opacity), 0, 1);
  referenceOpacity = layer.opacity;
  saveReferenceUiState();
  referenceRenderKey = "";
  schedulePersistReferenceLayer(layer);
  render();
}

async function moveFocusedReferenceLayer(dx: number, dy: number) {
  const layer = focusedReferenceLayer();
  if (!layer || (!dx && !dy)) return;
  await updateFocusedReferenceLayer({ x: layer.x + dx, y: layer.y + dy });
}

async function resizeFocusedReferenceLayer(axis: ReferenceResizeAxis, factor: number) {
  const layer = focusedReferenceLayer();
  if (!layer || !Number.isFinite(factor) || factor <= 0) return;
  const center = referenceLayerCenter(layer);
  const nextWidth = axis === "height" ? layer.width : Math.max(1, layer.width * factor);
  const nextHeight = axis === "width" ? layer.height : Math.max(1, layer.height * factor);
  await updateFocusedReferenceLayer({
    width: nextWidth,
    height: nextHeight,
    x: center.x - nextWidth / 2,
    y: center.y - nextHeight / 2
  });
}

async function rotateFocusedReferenceLayer(delta: number) {
  const layer = focusedReferenceLayer();
  if (!layer) return;
  await updateFocusedReferenceLayer({ rotation: normalizeDegrees(layer.rotation + delta) });
}

async function fitFocusedReferenceLayer(mode: "fit" | "fill") {
  const layer = focusedReferenceLayer();
  if (!layer) return;
  await updateFocusedReferenceLayer(fittedReferenceTransform(layer, mode));
}

async function resetFocusedReferenceLayer() {
  const layer = focusedReferenceLayer();
  if (!layer) return;
  await updateFocusedReferenceLayer({
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
    rotation: 0
  });
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

function applyDepthPreset(presetId: string) {
  const selected = selectedFeature();
  if (!selected) return;
  const presets: Record<string, Partial<Feature> & { sourceId: string; note: string }> = {
    "fep-shallow": {
      kind: "underground",
      certainty: "inferred",
      label: selected.label || "FEP underground hall",
      depth: 8,
      height: Math.max(selected.height, 34),
      sourceId: "globalsecurity-fep-depth",
      note: "Depth preset: older Natanz FEP reported as about 8 m underground; use for the original buried enrichment halls, not the newer mountain tunnel complex."
    },
    "fep-cover": {
      kind: "underground",
      certainty: "inferred",
      label: selected.label || "Hardened FEP hall",
      depth: 23,
      height: Math.max(selected.height, 34),
      sourceId: "globalsecurity-fep-depth",
      note: "Depth preset: GlobalSecurity reports later hardening with reinforced concrete and about 75 ft / 23 m of earth cover; treat as cover/overburden, not exact floor elevation."
    },
    "new-tunnel": {
      kind: "underground",
      certainty: "speculative",
      label: selected.label || "New mountain tunnel hall",
      depth: 110,
      height: Math.max(selected.height, 58),
      sourceId: "isis-2022-tunnel-depth",
      note: "Depth preset: newer mountain tunnel complex; ISIS estimates possible burial around 78-145 m from portal/ridge geometry, with roughly 110 m plausible if tunnel elevations meet."
    }
  };
  const preset = presets[presetId];
  if (!preset) return;
  appendFeatureEvidence(selected.id, [preset.note, sourceNote(preset.sourceId)].filter(Boolean).join("\n"));
  updateSelected({
    kind: preset.kind,
    certainty: preset.certainty,
    label: preset.label,
    depth: preset.depth,
    height: preset.height
  });
}

function updateSelected(patch: Partial<Feature>) {
  if (!selectedId) return;
  pushHistory();
  features = features.map((feature) => feature.id === selectedId ? normalizeFeature({ ...feature, ...patch }) : feature);
  saveState();
  render();
}

function appendSourceToSelected(sourceId: string) {
  if (!selectedId) return;
  appendFeatureEvidence(selectedId, sourceNote(sourceId));
}

function appendFeatureEvidence(featureId: string, note: string) {
  const trimmed = note.trim();
  if (!trimmed) return;
  pushHistory();
  features = features.map((feature) => {
    if (feature.id !== featureId) return feature;
    const nextNote = feature.note.trim() ? `${feature.note.trim()}\n\n${trimmed}` : trimmed;
    return { ...feature, note: nextNote };
  });
  saveState();
  render();
}

function sourceNote(sourceId: string) {
  const source = sourceReferences.find((candidate) => candidate.id === sourceId);
  if (!source) return "";
  return `Source: ${source.citation}\n${source.summary}\n${source.url}`;
}

function render() {
  viewport.setAttribute("transform", `matrix(${zoom} 0 0 ${zoom} ${pan.x} ${pan.y})`);
  stage.classList.toggle("hidden", viewMode !== "plan");
  modelStage.classList.toggle("active", viewMode === "model");
  document.querySelector(".modelHud")!.classList.toggle("active", viewMode === "model");
  renderReferenceLayers();
  renderToolbar();
  renderFeatures();
  renderReferenceTransform();
  renderTransform();
  renderDraft();
  renderList();
  renderSourceList();
  renderReferenceList();
  renderReferenceInspector();
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

function renderReferenceLayers() {
  const key = `${showReference}:${referenceLayers.map((layer) => `${layer.id}:${layer.order}:${layer.visible}:${layer.opacity}:${layer.x}:${layer.y}:${layer.width}:${layer.height}:${layer.rotation}:${layer.dataUrl.length}`).join("|")}`;
  if (key === referenceRenderKey) return;
  referenceRenderKey = key;
  referenceLayer.replaceChildren();
  if (!showReference) return;
  for (const layer of [...referenceLayers].reverse()) {
    if (!layer.visible) continue;
    const imageElement = document.createElementNS(svgNs, "image");
    imageElement.setAttribute("href", layer.dataUrl);
    imageElement.setAttribute("x", String(layer.x));
    imageElement.setAttribute("y", String(layer.y));
    imageElement.setAttribute("width", String(layer.width));
    imageElement.setAttribute("height", String(layer.height));
    imageElement.setAttribute("preserveAspectRatio", "none");
    imageElement.setAttribute("opacity", String(layer.opacity));
    imageElement.setAttribute("transform", referenceLayerTransform(layer));
    imageElement.dataset.referenceId = layer.id;
    imageElement.classList.add("referenceImage");
    referenceLayer.appendChild(imageElement);
  }
}

function renderReferenceList() {
  const list = document.querySelector<HTMLDivElement>("#referenceList")!;
  if (!referenceLayers.length) {
    list.innerHTML = `<p class="hint">No saved reference images yet.</p>`;
    return;
  }
  list.innerHTML = referenceLayers.map((layer) => `
    <div class="referenceItem ${layer.id === focusedReferenceId ? "active" : ""} ${layer.visible ? "" : "muted"}" draggable="true" data-reference-row="${layer.id}">
      <button class="layerIcon" data-reference-visible="${layer.id}" title="${layer.visible ? "Hide layer" : "Show layer"}">
        <span data-icon="${layer.visible ? "eye" : "eye-off"}"></span>
      </button>
      <button class="layerSelect" data-reference-select="${layer.id}">
        <span>${escapeHtml(layer.name)}</span>
        <small>${escapeHtml(layer.source)} / ${Math.round(layer.width)} x ${Math.round(layer.height)} / ${Math.round(layer.opacity * 100)}%</small>
      </button>
      <div class="layerActions">
        <button data-reference-up="${layer.id}" title="Move up"><span data-icon="chevron-up"></span></button>
        <button data-reference-down="${layer.id}" title="Move down"><span data-icon="chevron-down"></span></button>
        <button data-reference-delete="${layer.id}" class="danger" title="Delete layer"><span data-icon="trash"></span></button>
      </div>
    </div>
  `).join("");
  list.querySelectorAll<HTMLButtonElement>("[data-reference-select]").forEach((button) => {
    button.addEventListener("click", () => selectReferenceLayer(button.dataset.referenceSelect ?? ""));
  });
  list.querySelectorAll<HTMLButtonElement>("[data-reference-visible]").forEach((button) => {
    button.addEventListener("click", () => {
      const layer = referenceLayers.find((candidate) => candidate.id === button.dataset.referenceVisible);
      if (layer) void setReferenceLayerVisible(layer.id, !layer.visible);
    });
  });
  list.querySelectorAll<HTMLButtonElement>("[data-reference-up]").forEach((button) => {
    button.addEventListener("click", () => {
      void moveReferenceLayerInStack(button.dataset.referenceUp ?? "", -1);
    });
  });
  list.querySelectorAll<HTMLButtonElement>("[data-reference-down]").forEach((button) => {
    button.addEventListener("click", () => {
      void moveReferenceLayerInStack(button.dataset.referenceDown ?? "", 1);
    });
  });
  list.querySelectorAll<HTMLButtonElement>("[data-reference-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      void deleteReferenceLayer(button.dataset.referenceDelete ?? "");
    });
  });
  list.querySelectorAll<HTMLDivElement>("[data-reference-row]").forEach((row) => {
    row.addEventListener("dragstart", () => {
      draggedReferenceId = row.dataset.referenceRow ?? "";
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      draggedReferenceId = "";
      row.classList.remove("dragging");
      list.querySelectorAll(".dropTarget").forEach((target) => target.classList.remove("dropTarget"));
    });
    row.addEventListener("dragover", (event) => {
      if (!draggedReferenceId || draggedReferenceId === row.dataset.referenceRow) return;
      event.preventDefault();
      row.classList.add("dropTarget");
    });
    row.addEventListener("dragleave", () => row.classList.remove("dropTarget"));
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.classList.remove("dropTarget");
      void moveReferenceLayerBefore(draggedReferenceId, row.dataset.referenceRow ?? "");
      draggedReferenceId = "";
    });
  });
}

function renderReferenceTransform() {
  const layer = referenceLayers.find((candidate) => candidate.id === focusedReferenceId);
  if (!layer || viewMode !== "plan" || tool !== "select") {
    referenceTransformLayer.innerHTML = "";
    return;
  }
  const controlScale = controlUnits();
  const box = referenceLayerBox(layer);
  const corners = ["nw", "ne", "se", "sw"].map((handle) => scaleHandleWorld(box, handle as ScaleHandle));
  const center = referenceLayerCenter(layer);
  const handleSize = 12 * controlScale;
  const halfHandle = handleSize / 2;
  const rotateDistance = Math.max(42 * controlScale, Math.min(layer.width, layer.height) * 0.24);
  const rotateAngle = degreesToRadians(layer.rotation - 90);
  const rotateHandle = { x: center.x + Math.cos(rotateAngle) * rotateDistance, y: center.y + Math.sin(rotateAngle) * rotateDistance };
  referenceTransformLayer.innerHTML = `
    <g class="referenceTransformBox">
      <path d="${pathData(corners, true)}" />
      <line x1="${center.x}" y1="${center.y}" x2="${rotateHandle.x}" y2="${rotateHandle.y}" />
      <circle data-reference-transform="move" cx="${center.x}" cy="${center.y}" r="${7 * controlScale}" />
      <circle data-reference-transform="rotate" class="rotateHandle" cx="${rotateHandle.x}" cy="${rotateHandle.y}" r="${9 * controlScale}" />
      ${scaleHandles.map((handle) => {
        const point = scaleHandleWorld(box, handle);
        return `<rect data-reference-transform="scale" data-scale-handle="${handle}" class="referenceScaleHandle ${handle}" x="${point.x - halfHandle}" y="${point.y - halfHandle}" width="${handleSize}" height="${handleSize}" transform="rotate(${box.rotation} ${point.x} ${point.y})" />`;
      }).join("")}
    </g>
  `;
}

function renderReferenceInspector() {
  const layer = referenceLayers.find((candidate) => candidate.id === (focusedReferenceId || activeReferenceId));
  document.querySelector<HTMLDivElement>("#referenceInspector")!.classList.toggle("empty", !layer);
  const inputs = [
    "#referenceName",
    "#referenceOpacity",
    "#referenceX",
    "#referenceY",
    "#referenceWidth",
    "#referenceHeight",
    "#referenceRotation"
  ].map((selector) => document.querySelector<HTMLInputElement>(selector)!);
  inputs.forEach((input) => {
    input.disabled = !layer;
  });
  document.querySelectorAll<HTMLButtonElement>("#referenceLayerUp, #referenceLayerDown, #fitReferenceLayer, #fillReferenceLayer, #quickFitReference, #quickFillReference, #quickResetReference, #resetReferenceLayer, #deleteReferenceLayer, #referenceRotateLeft, #referenceRotateRight, [data-reference-nudge], [data-reference-resize]").forEach((button) => {
    button.disabled = !layer;
  });
  if (!layer) {
    document.querySelector<HTMLInputElement>("#referenceName")!.value = "";
    document.querySelector<HTMLInputElement>("#referenceOpacity")!.value = String(referenceOpacity);
    document.querySelector<HTMLInputElement>("#referenceX")!.value = "";
    document.querySelector<HTMLInputElement>("#referenceY")!.value = "";
    document.querySelector<HTMLInputElement>("#referenceWidth")!.value = "";
    document.querySelector<HTMLInputElement>("#referenceHeight")!.value = "";
    document.querySelector<HTMLInputElement>("#referenceRotation")!.value = "0";
    return;
  }
  document.querySelector<HTMLInputElement>("#referenceName")!.value = layer.name;
  document.querySelector<HTMLInputElement>("#referenceOpacity")!.value = String(layer.opacity);
  document.querySelector<HTMLInputElement>("#referenceX")!.value = String(Math.round(layer.x));
  document.querySelector<HTMLInputElement>("#referenceY")!.value = String(Math.round(layer.y));
  document.querySelector<HTMLInputElement>("#referenceWidth")!.value = String(Math.round(layer.width));
  document.querySelector<HTMLInputElement>("#referenceHeight")!.value = String(Math.round(layer.height));
  document.querySelector<HTMLInputElement>("#referenceRotation")!.value = String(layer.rotation);
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
  const controlScale = controlUnits();
  const moveRadius = 7 * controlScale;
  const rotateRadius = 9 * controlScale;
  const radius = Math.max(46 * controlScale, Math.sqrt(areaBounds(selected.points)) * 0.56);
  const handleAngle = degreesToRadians(selected.rotation - 90);
  const rotateHandle = { x: center.x + Math.cos(handleAngle) * radius, y: center.y + Math.sin(handleAngle) * radius };
  const closeOutline = selected.kind !== "road" && selected.kind !== "fence";
  const freeTransform = freeTransformId === selected.id && selected.points.length > 1 ? freeTransformSvg(selected, controlScale) : "";
  transformLayer.innerHTML = `
    <g class="transformBox">
      <path d="${pathData(selected.points, closeOutline)}" />
      ${freeTransform}
      <line x1="${center.x}" y1="${center.y}" x2="${rotateHandle.x}" y2="${rotateHandle.y}" />
      <circle data-transform="move" cx="${center.x}" cy="${center.y}" r="${moveRadius}" />
      <circle data-transform="rotate" class="rotateHandle" cx="${rotateHandle.x}" cy="${rotateHandle.y}" r="${rotateRadius}" />
    </g>
  `;
}

function freeTransformSvg(feature: Feature, controlScale: number) {
  const box = orientedBox(feature);
  const points = ["nw", "ne", "se", "sw"].map((handle) => scaleHandleWorld(box, handle as ScaleHandle));
  const handleSize = 12 * controlScale;
  const halfHandle = handleSize / 2;
  return `
    <path class="freeTransformBounds" d="${pathData(points, true)}" />
    ${scaleHandles.map((handle) => {
      const point = scaleHandleWorld(box, handle);
      return `<rect data-transform="scale" data-scale-handle="${handle}" class="scaleHandle ${handle}" x="${point.x - halfHandle}" y="${point.y - halfHandle}" width="${handleSize}" height="${handleSize}" transform="rotate(${box.rotation} ${point.x} ${point.y})" />`;
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
      focusedReferenceId = "";
      render();
    });
  });
}

function renderSourceList() {
  const list = document.querySelector<HTMLDivElement>("#sourceList")!;
  list.innerHTML = sourceReferences.map((source) => `
    <div class="sourceItem">
      <strong>${escapeHtml(source.title)}</strong>
      <p>${escapeHtml(source.summary)}</p>
      <button data-source-append="${source.id}" ${selectedId ? "" : "disabled"}>Add to selected notes</button>
      <a href="${source.url}" target="_blank" rel="noreferrer">Open source</a>
    </div>
  `).join("");
  list.querySelectorAll<HTMLButtonElement>("[data-source-append]").forEach((button) => {
    button.addEventListener("click", () => appendSourceToSelected(button.dataset.sourceAppend ?? ""));
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
  document.querySelector<HTMLInputElement>("#referenceOpacity")!.value = String(activeReferenceLayer()?.opacity ?? referenceOpacity);
  document.querySelector<HTMLSelectElement>("#labelMode")!.value = labelMode;
  document.querySelector<HTMLInputElement>("#showReference")!.checked = showReference;
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
  const showLabel = clean || shouldShowFeatureLabel(feature);
  if (feature.kind === "label") {
    const point = feature.points[0];
    return showLabel ? `<text class="${classes}" data-id="${feature.id}" x="${point.x}" y="${point.y}">${escapeHtml(feature.label)}</text>` : "";
  }
  if (feature.kind === "entrance") {
    const point = feature.points[0];
    return `<g class="${classes}" data-id="${feature.id}">
      <circle cx="${point.x}" cy="${point.y}" r="22" />
      ${showLabel ? `<text x="${point.x + 34}" y="${point.y + 8}">${escapeHtml(feature.label)}</text>` : ""}
    </g>`;
  }
  return `<g class="${classes}" data-id="${feature.id}">
    <path d="${pathData(feature.points, feature.kind !== "road" && feature.kind !== "fence")}" />
    ${feature.label && showLabel ? labelAt(feature) : ""}
  </g>`;
}

function shouldShowFeatureLabel(feature: Feature) {
  if (labelMode === "hidden") return false;
  if (labelMode === "selected") return feature.id === selectedId;
  return true;
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
  download("undergroundmaps-natanz.json", JSON.stringify({ project: "UndergroundMaps", workspace: "Natanz", image, imagerySource, sourceReferences, features }, null, 2), "application/json");
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
    focusedReferenceId = "";
    saveState();
    saveImagerySource();
    render();
  };
  reader.readAsText(file);
}

async function loadReferenceImage(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (!files.length) return;
  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file);
    const dimensions = await imageDimensions(dataUrl);
    await addReferenceLayer(file.name, dataUrl, "file", dimensions);
  }
  input.value = "";
}

function loadImageryUrl() {
  if (!imagerySource.url) return;
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  loader.load(imagerySource.url, (texture) => {
    setTexture(texture);
    const sourceImage = texture.image as HTMLImageElement | ImageBitmap | undefined;
    void addReferenceLayer(imagerySource.credit || "URL reference", imagerySource.url, "url", {
      width: sourceImage?.width,
      height: sourceImage?.height
    });
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

async function initializeReferenceLayers() {
  try {
    referenceLayers = await loadReferenceLayers();
    if (activeReferenceId && !referenceLayers.some((layer) => layer.id === activeReferenceId)) activeReferenceId = "";
    if (!activeReferenceId) activeReferenceId = referenceLayers[0]?.id ?? "";
    focusedReferenceId = activeReferenceId;
    referenceOpacity = activeReferenceLayer()?.opacity ?? referenceOpacity;
    saveReferenceUiState();
    applyActiveReferenceTexture();
    render();
  } catch (error) {
    console.error("Unable to load saved reference images", error);
  }
}

async function addReferenceLayer(name: string, dataUrl: string, source: ReferenceLayer["source"], dimensions?: Partial<{ width: number; height: number }>) {
  const fitted = fittedReferenceTransform({
    naturalWidth: dimensions?.width,
    naturalHeight: dimensions?.height,
    width: dimensions?.width ?? image.width,
    height: dimensions?.height ?? image.height
  }, "fit");
  const layer = normalizeReferenceLayer({
    id: crypto.randomUUID(),
    name,
    dataUrl,
    order: nextReferenceTopOrder(),
    ...fitted,
    opacity: referenceOpacity,
    visible: true,
    source,
    naturalWidth: dimensions?.width,
    naturalHeight: dimensions?.height,
    createdAt: Date.now()
  });
  referenceLayers = [layer, ...referenceLayers];
  activeReferenceId = layer.id;
  focusedReferenceId = layer.id;
  selectedId = "";
  showReference = true;
  saveReferenceUiState();
  await persistReferenceLayer(layer);
  setTerrainTexture(layer.dataUrl);
  render();
}

function selectReferenceLayer(id: string) {
  const layer = referenceLayers.find((candidate) => candidate.id === id);
  if (!layer) return;
  activeReferenceId = layer.id;
  focusedReferenceId = layer.id;
  selectedId = "";
  freeTransformId = "";
  referenceOpacity = layer.opacity;
  saveReferenceUiState();
  setTerrainTexture(layer.dataUrl);
  render();
}

async function setReferenceLayerVisible(id: string, visible: boolean) {
  const layer = referenceLayers.find((candidate) => candidate.id === id);
  if (!layer) return;
  cancelScheduledReferencePersist();
  layer.visible = visible;
  await persistReferenceLayer(layer);
  if (layer.id === activeReferenceId && visible) setTerrainTexture(layer.dataUrl);
  render();
}

async function deleteReferenceLayer(id: string) {
  if (!id) return;
  cancelScheduledReferencePersist();
  referenceLayers = referenceLayers.filter((layer) => layer.id !== id);
  await removeReferenceLayer(id);
  if (activeReferenceId === id) activeReferenceId = referenceLayers[0]?.id ?? "";
  if (focusedReferenceId === id) focusedReferenceId = activeReferenceId;
  referenceOpacity = activeReferenceLayer()?.opacity ?? referenceOpacity;
  saveReferenceUiState();
  applyActiveReferenceTexture();
  render();
}

async function moveReferenceLayerInStack(id: string, direction: -1 | 1) {
  if (!id) return;
  const index = referenceLayers.findIndex((layer) => layer.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= referenceLayers.length) return;
  cancelScheduledReferencePersist();
  [referenceLayers[index], referenceLayers[nextIndex]] = [referenceLayers[nextIndex], referenceLayers[index]];
  reindexReferenceLayers();
  await persistReferenceLayers(referenceLayers);
  referenceRenderKey = "";
  render();
}

async function moveReferenceLayerBefore(dragId: string, targetId: string) {
  if (!dragId || !targetId || dragId === targetId) return;
  const dragged = referenceLayers.find((layer) => layer.id === dragId);
  if (!dragged) return;
  cancelScheduledReferencePersist();
  referenceLayers = referenceLayers.filter((layer) => layer.id !== dragId);
  const targetIndex = referenceLayers.findIndex((layer) => layer.id === targetId);
  referenceLayers.splice(Math.max(0, targetIndex), 0, dragged);
  reindexReferenceLayers();
  focusedReferenceId = dragged.id;
  activeReferenceId = dragged.id;
  referenceOpacity = dragged.opacity;
  saveReferenceUiState();
  await persistReferenceLayers(referenceLayers);
  referenceRenderKey = "";
  render();
}

function activeReferenceLayer() {
  return referenceLayers.find((layer) => layer.id === activeReferenceId);
}

function focusedReferenceLayer() {
  const layer = referenceLayers.find((candidate) => candidate.id === focusedReferenceId || candidate.id === activeReferenceId);
  if (layer) {
    focusedReferenceId = layer.id;
    activeReferenceId = layer.id;
  }
  return layer;
}

function applyActiveReferenceTexture() {
  const layer = activeReferenceLayer();
  if (layer) setTerrainTexture(layer.dataUrl);
  else {
    terrainTexture = null;
    renderModel();
  }
}

function saveReferenceUiState() {
  localStorage.setItem(referenceActiveKey, activeReferenceId);
  localStorage.setItem(referenceShowKey, String(showReference));
  localStorage.setItem(referenceOpacityKey, String(referenceOpacity));
}

function schedulePersistReferenceLayer(layer: ReferenceLayer) {
  if (referencePersistTimer) window.clearTimeout(referencePersistTimer);
  const snapshot = cloneReferenceLayer(layer);
  referencePersistTimer = window.setTimeout(() => {
    void persistReferenceLayer(snapshot);
    referencePersistTimer = undefined;
  }, 180);
}

function cancelScheduledReferencePersist() {
  if (!referencePersistTimer) return;
  window.clearTimeout(referencePersistTimer);
  referencePersistTimer = undefined;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function imageDimensions(src: string): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve({ width: probe.naturalWidth || probe.width, height: probe.naturalHeight || probe.height });
    probe.onerror = () => resolve(undefined);
    probe.src = src;
  });
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

function cloneReferenceLayer(layer: ReferenceLayer): ReferenceLayer {
  return { ...layer };
}

function referenceLayerCenter(layer: ReferenceLayer): Point {
  return {
    x: layer.x + layer.width / 2,
    y: layer.y + layer.height / 2
  };
}

function referenceLayerBox(layer: ReferenceLayer): OrientedBox {
  return {
    center: referenceLayerCenter(layer),
    rotation: layer.rotation,
    minX: -layer.width / 2,
    maxX: layer.width / 2,
    minY: -layer.height / 2,
    maxY: layer.height / 2
  };
}

function referenceLayerTransform(layer: ReferenceLayer) {
  const center = referenceLayerCenter(layer);
  return `rotate(${layer.rotation} ${center.x} ${center.y})`;
}

function fittedReferenceTransform(layer: Partial<ReferenceLayer>, mode: "fit" | "fill") {
  const naturalWidth = Math.max(1, layer.naturalWidth ?? layer.width ?? image.width);
  const naturalHeight = Math.max(1, layer.naturalHeight ?? layer.height ?? image.height);
  const scale = mode === "fit"
    ? Math.min(image.width / naturalWidth, image.height / naturalHeight)
    : Math.max(image.width / naturalWidth, image.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    x: (image.width - width) / 2,
    y: (image.height - height) / 2,
    width,
    height,
    rotation: 0
  };
}

function reindexReferenceLayers() {
  referenceLayers.forEach((layer, index) => {
    layer.order = index;
  });
}

function nextReferenceTopOrder() {
  return referenceLayers.length ? Math.min(...referenceLayers.map((layer) => layer.order)) - 1 : 0;
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
  const starters = [...natanzBaseFeatures(), ...natanzInfrastructureFeatures()];
  features = starters.map((feature) => ({ ...feature, id: crypto.randomUUID() }));
  selectedId = features[0]?.id ?? "";
  focusedReferenceId = "";
  saveState();
  render();
}

function addRoadsAndFences() {
  pushHistory();
  const newFeatures = natanzInfrastructureFeatures().map((feature) => ({ ...feature, id: crypto.randomUUID() }));
  features = [...features, ...newFeatures];
  selectedId = newFeatures[0]?.id ?? selectedId;
  focusedReferenceId = "";
  saveState();
  render();
}

function natanzBaseFeatures(): Array<Omit<Feature, "id">> {
  return [
    {
      kind: "surface",
      certainty: "inferred",
      label: "Surface support and assembly area",
      note: `Starter footprint for surface buildings visible in reference imagery.\n\n${sourceNote("isis-2026-entrances")}`,
      height: 36,
      depth: 0,
      rotation: 0,
      points: stampPoints({ x: 850, y: 1060 }, 520, 360, -4)
    },
    {
      kind: "underground",
      certainty: "inferred",
      label: "FEP hall A, shallow hardened",
      note: `Older Natanz FEP hall. Treat 8 m as reported construction depth and about 23 m as reported later overburden/hardening; QA footprint against imagery.\n\n${sourceNote("globalsecurity-fep-depth")}`,
      height: 38,
      depth: 23,
      rotation: 0,
      points: rectPoints(1110, 1080, 470, 310)
    },
    {
      kind: "underground",
      certainty: "inferred",
      label: "FEP hall B, shallow hardened",
      note: `Older Natanz FEP hall. Treat 8 m as reported construction depth and about 23 m as reported later overburden/hardening; QA footprint against imagery.\n\n${sourceNote("globalsecurity-fep-depth")}`,
      height: 38,
      depth: 23,
      rotation: 0,
      points: rectPoints(1630, 1080, 470, 310)
    },
    {
      kind: "entrance",
      certainty: "inferred",
      label: "Vehicle entrance ramp",
      note: `Vehicle entrance to the older underground FEP. Position is a QA starter only; adjust to reference imagery.\n\n${sourceNote("isis-2026-entrances")}`,
      height: 28,
      depth: 0,
      rotation: 0,
      points: [{ x: 1410, y: 1460 }]
    },
    {
      kind: "entrance",
      certainty: "inferred",
      label: "Personnel entrances",
      note: `Two personnel entrance buildings are discussed in public imagery analysis; use this as a marker cluster and split into separate markers if needed.\n\n${sourceNote("isis-2026-entrances")}`,
      height: 24,
      depth: 0,
      rotation: 0,
      points: [{ x: 960, y: 1385 }]
    },
    {
      kind: "underground",
      certainty: "speculative",
      label: "New mountain tunnel complex",
      note: `Speculative schematic placeholder for the newer mountain tunnel complex south of the main site. ISIS estimates possible burial around 78-145 m under the ridge, with about 110 m plausible if tunnel elevations meet.\n\n${sourceNote("isis-2022-tunnel-depth")}`,
      height: 64,
      depth: 110,
      rotation: -16,
      points: stampPoints({ x: 2050, y: 1650 }, 520, 320, -16)
    },
    {
      kind: "entrance",
      certainty: "speculative",
      label: "New tunnel portals",
      note: `Marker for newer tunnel portal areas described in public imagery reporting. Split into eastern/western portals after QA.\n\n${sourceNote("isis-2021-tunnel-roads")}`,
      height: 26,
      depth: 0,
      rotation: 0,
      points: [{ x: 2190, y: 1395 }]
    }
  ];
}

function natanzInfrastructureFeatures(): Array<Omit<Feature, "id">> {
  return [
    {
      kind: "fence",
      certainty: "inferred",
      label: "",
      note: "Approximate main site perimeter/security fence traced from visible reference imagery. Keep as a schematic boundary, not a surveyed line.",
      height: 10,
      depth: 0,
      rotation: 0,
      points: [
        { x: 330, y: 500 },
        { x: 2315, y: 455 },
        { x: 2495, y: 1945 },
        { x: 520, y: 2185 },
        { x: 330, y: 500 }
      ]
    },
    {
      kind: "fence",
      certainty: "speculative",
      label: "",
      note: `Approximate construction/security boundary for newer tunnel work area. Use only after QA against imagery.\n\n${sourceNote("isis-2021-tunnel-roads")}`,
      height: 10,
      depth: 0,
      rotation: 0,
      points: [
        { x: 1810, y: 1200 },
        { x: 2435, y: 1210 },
        { x: 2550, y: 1810 },
        { x: 1930, y: 1950 },
        { x: 1810, y: 1200 }
      ]
    },
    {
      kind: "road",
      certainty: "inferred",
      label: "",
      note: "Main internal service road spine. Trace and simplify against the active reference layer.",
      height: 8,
      depth: 0,
      rotation: 0,
      points: [
        { x: 480, y: 960 },
        { x: 790, y: 1110 },
        { x: 1060, y: 1260 },
        { x: 1395, y: 1435 },
        { x: 1730, y: 1510 }
      ]
    },
    {
      kind: "road",
      certainty: "inferred",
      label: "",
      note: `Vehicle access route toward the older FEP entrance area; public imagery reporting identifies the vehicle entrance as a distinct access point.\n\n${sourceNote("isis-2026-entrances")}`,
      height: 8,
      depth: 0,
      rotation: 0,
      points: [
        { x: 1120, y: 1500 },
        { x: 1280, y: 1475 },
        { x: 1410, y: 1460 },
        { x: 1565, y: 1495 }
      ]
    },
    {
      kind: "road",
      certainty: "speculative",
      label: "",
      note: `Approximate route from the support/staging area toward newer tunnel portal areas. ISIS describes roads leading to eastern and western tunnel entrance areas.\n\n${sourceNote("isis-2021-tunnel-roads")}`,
      height: 8,
      depth: 0,
      rotation: 0,
      points: [
        { x: 1740, y: 1280 },
        { x: 1945, y: 1355 },
        { x: 2190, y: 1395 },
        { x: 2390, y: 1485 }
      ]
    },
    {
      kind: "road",
      certainty: "speculative",
      label: "",
      note: `Approximate western construction/access road for the newer tunnel area. QA against imagery before publication.\n\n${sourceNote("isis-2021-tunnel-roads")}`,
      height: 8,
      depth: 0,
      rotation: 0,
      points: [
        { x: 1690, y: 1600 },
        { x: 1880, y: 1680 },
        { x: 2060, y: 1775 },
        { x: 2260, y: 1900 }
      ]
    }
  ];
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

function controlUnits() {
  const matrix = viewport.getScreenCTM();
  if (!matrix?.a) return 1;
  return 1 / Math.abs(matrix.a);
}

function svgPoint(event: PointerEvent, allowOutsideImage = false): Point {
  const point = stage.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = viewport.getScreenCTM()?.inverse();
  const mapped = matrix ? point.matrixTransform(matrix) : point;
  if (allowOutsideImage) return { x: mapped.x, y: mapped.y };
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

function normalizeLabelMode(value: string | null): LabelMode {
  return value === "selected" || value === "hidden" ? value : "all";
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

function normalizeReferenceLayer(raw: Partial<ReferenceLayer>): ReferenceLayer {
  const naturalWidth = raw.naturalWidth ?? raw.width ?? image.width;
  const naturalHeight = raw.naturalHeight ?? raw.height ?? image.height;
  return {
    id: raw.id ?? crypto.randomUUID(),
    name: raw.name?.trim() || "Reference image",
    dataUrl: raw.dataUrl ?? "",
    order: Number.isFinite(raw.order) ? raw.order! : -(raw.createdAt ?? Date.now()),
    x: Number.isFinite(raw.x) ? raw.x! : 0,
    y: Number.isFinite(raw.y) ? raw.y! : 0,
    width: Math.max(1, raw.width ?? image.width),
    height: Math.max(1, raw.height ?? image.height),
    rotation: normalizeDegrees(raw.rotation ?? 0),
    opacity: clamp(raw.opacity ?? referenceOpacity, 0, 1),
    visible: raw.visible ?? true,
    source: raw.source ?? "file",
    naturalWidth,
    naturalHeight,
    createdAt: raw.createdAt ?? Date.now()
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

async function loadReferenceLayers() {
  const db = await openReferenceDb();
  try {
    const transaction = db.transaction(referenceDbStore, "readonly");
    const request = transaction.objectStore(referenceDbStore).getAll();
    const layers = await idbRequest<ReferenceLayer[]>(request);
    return layers.map(normalizeReferenceLayer).sort((a, b) => a.order - b.order);
  } finally {
    db.close();
  }
}

async function persistReferenceLayer(layer: ReferenceLayer) {
  const db = await openReferenceDb();
  try {
    const transaction = db.transaction(referenceDbStore, "readwrite");
    transaction.objectStore(referenceDbStore).put(layer);
    await transactionComplete(transaction);
  } finally {
    db.close();
  }
}

async function persistReferenceLayers(layers: ReferenceLayer[]) {
  const db = await openReferenceDb();
  try {
    const transaction = db.transaction(referenceDbStore, "readwrite");
    const store = transaction.objectStore(referenceDbStore);
    layers.forEach((layer) => store.put(layer));
    await transactionComplete(transaction);
  } finally {
    db.close();
  }
}

async function removeReferenceLayer(id: string) {
  const db = await openReferenceDb();
  try {
    const transaction = db.transaction(referenceDbStore, "readwrite");
    transaction.objectStore(referenceDbStore).delete(id);
    await transactionComplete(transaction);
  } finally {
    db.close();
  }
}

function openReferenceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(referenceDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(referenceDbStore)) db.createObjectStore(referenceDbStore, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
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
