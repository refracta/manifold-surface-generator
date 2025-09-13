import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'https://unpkg.com/three@0.160.0/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'https://unpkg.com/three@0.160.0/examples/jsm/exporters/OBJExporter.js';

import { buildSurface, colorizeGeometry, SurfaceParamsPresets } from './surface.js';
import { buildIsoGrid, buildEdgeShortestPath, buildParamStraight } from './geodesic.js';
import { MarkerLayer } from './markers.js';

const container = document.getElementById('canvas-container');
const markerLayer = new MarkerLayer(document.getElementById('marker-layer'));

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#f5f5f8');

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(2.6, 1.8, 2.6);
const defaultCamPos = camera.position.clone();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(2, 3, 2);
scene.add(dir);

// State
let surfaceGroup = null; // contains mesh and optional lines
let surfaceState = null; // geometry bookkeeping
let geodesicGroup = new THREE.Group();
scene.add(geodesicGroup);

const params = { ...SurfaceParamsPresets.ripple }; // start preset

function regenerateSurface() {
  if (surfaceGroup) scene.remove(surfaceGroup);
  const { group, state } = buildSurface(params);
  surfaceGroup = group;
  surfaceState = state;
  scene.add(surfaceGroup);
  rebuildGeodesics();
}

function rebuildGeodesics() {
  geodesicGroup.clear();
  if (!document.getElementById('geoEnable').checked) return;
  const style = document.getElementById('geoStyle').value;
  const color = new THREE.Color(document.getElementById('geoColor').value);
  const count = parseInt(document.getElementById('geoCount').value, 10);
  const method = document.getElementById('geoMethod').value;

  let lines = [];
  if (method === 'grid') {
    lines = buildIsoGrid(surfaceState, count);
  } else if (method === 'param-straight') {
    lines = buildParamStraight(surfaceState, count);
  }
  for (const geo of lines) {
    const material = new THREE.LineDashedMaterial({
      color: color.getHex(),
      linewidth: 1,
      dashSize: style === 'dotted' ? 0.05 : (style === 'dashed' ? 0.14 : 1),
      gapSize: style === 'dotted' ? 0.12 : (style === 'dashed' ? 0.06 : 0),
      scale: 1,
    });
    const line = new THREE.Line(geo, material);
    line.computeLineDistances();
    if (style === 'solid') line.material = new THREE.LineBasicMaterial({ color: color.getHex() });
    geodesicGroup.add(line);
  }
  // Edge‑shortest path added interactively via buttons
}

function updateColors() {
  const mode = document.getElementById('colorMode').value;
  if (mode === 'solid') {
    colorizeGeometry(surfaceState.geometry, { mode: 'solid', color: document.getElementById('solidColor').value });
  } else {
    const stops = readGradientStops();
    const axis = document.getElementById('gradAxis').value;
    colorizeGeometry(surfaceState.geometry, { mode: 'gradient', axis, stops });
  }
}

// UI wiring
function readGradientStops() {
  const rows = [...document.querySelectorAll('#stops .stop-row')];
  if (!rows.length) return [{ t: 0, color: '#a8c7ff' }, { t: 1, color: '#ff9aa2' }];
  return rows.map(r => ({ t: parseFloat(r.querySelector('input[type="range"]').value), color: r.querySelector('input[type="color"]').value }))
             .sort((a, b) => a.t - b.t);
}

function addStopRow(t = 0.5, color = '#ff9aa2') {
  const div = document.createElement('div');
  div.className = 'stop-row';
  div.innerHTML = `<label style="width:60px">Stop</label>
    <input type="range" min="0" max="1" step="0.01" value="${t}">
    <input type="color" value="${color}">
    <button type="button">x</button>`;
  div.querySelector('button').onclick = () => { div.remove(); updateColors(); };
  div.querySelectorAll('input').forEach(i => i.oninput = () => updateColors());
  document.getElementById('stops').appendChild(div);
}

function setPreset(name) {
  const p = SurfaceParamsPresets[name];
  Object.assign(params, p);
  document.getElementById('amplitude').value = String(params.amplitude);
  document.getElementById('frequency').value = String(params.frequency);
  document.getElementById('noise').value = String(params.noise);
  regenerateSurface();
  updateColors();
}

document.getElementById('preset').addEventListener('change', (e) => setPreset(e.target.value));
document.getElementById('resU').addEventListener('change', () => { params.resU = clampInt('resU', 8, 512); regenerateSurface(); updateColors(); });
document.getElementById('resV').addEventListener('change', () => { params.resV = clampInt('resV', 8, 512); regenerateSurface(); updateColors(); });
document.getElementById('scale').addEventListener('input', (e) => { params.scale = parseFloat(e.target.value); regenerateSurface(); updateColors(); });
document.getElementById('amplitude').addEventListener('input', (e) => { params.amplitude = parseFloat(e.target.value); regenerateSurface(); updateColors(); });
document.getElementById('frequency').addEventListener('input', (e) => { params.frequency = parseFloat(e.target.value); regenerateSurface(); updateColors(); });
document.getElementById('noise').addEventListener('input', (e) => { params.noise = parseFloat(e.target.value); regenerateSurface(); updateColors(); });
document.getElementById('wireframe').addEventListener('change', (e) => { surfaceState.material.wireframe = e.target.checked; });

document.getElementById('bgColor').addEventListener('input', (e) => { scene.background = new THREE.Color(e.target.value); renderOnce(); });
document.getElementById('colorMode').addEventListener('change', (e) => {
  const solid = e.target.value === 'solid';
  document.getElementById('solidRow').style.display = solid ? 'flex' : 'none';
  document.getElementById('gradientEditor').style.display = solid ? 'none' : 'flex';
  updateColors();
});
document.getElementById('solidColor').addEventListener('input', updateColors);
document.getElementById('gradAxis').addEventListener('change', updateColors);
document.getElementById('addStop').addEventListener('click', () => { addStopRow(Math.random(), '#'+Math.floor(Math.random()*16777215).toString(16).padStart(6,'0')); updateColors(); });

document.getElementById('geoEnable').addEventListener('change', rebuildGeodesics);
document.getElementById('geoMethod').addEventListener('change', rebuildGeodesics);
document.getElementById('geoCount').addEventListener('change', rebuildGeodesics);
document.getElementById('geoStyle').addEventListener('change', rebuildGeodesics);
document.getElementById('geoColor').addEventListener('input', rebuildGeodesics);

// Interactive edge-shortest path
let pickingStart = false, pickingEnd = false; let pickedStart = null, pickedEnd = null;
document.getElementById('pickStart').onclick = () => { pickingStart = true; pickingEnd = false; };
document.getElementById('pickEnd').onclick = () => { pickingEnd = true; pickingStart = false; };
document.getElementById('addPath').onclick = () => {
  if (!pickedStart || !pickedEnd) return;
  const geo = buildEdgeShortestPath(surfaceState, pickedStart, pickedEnd);
  const style = document.getElementById('geoStyle').value;
  const color = new THREE.Color(document.getElementById('geoColor').value);
  const mat = style === 'solid' ? new THREE.LineBasicMaterial({ color: color.getHex() }) : new THREE.LineDashedMaterial({ color: color.getHex(), dashSize: style==='dotted'?0.05:0.14, gapSize: style==='dotted'?0.12:0.06});
  const line = new THREE.Line(geo, mat); line.computeLineDistances();
  geodesicGroup.add(line);
  pickedStart = pickedEnd = null; pickingStart = pickingEnd = false;
};
document.getElementById('clearGeodesics').onclick = () => { geodesicGroup.clear(); rebuildGeodesics(); };

// Markers
const markersEnable = document.getElementById('markersEnable');
const markerShape = document.getElementById('markerShape');
const markerSize = document.getElementById('markerSize');
const markerColor = document.getElementById('markerColor');
document.getElementById('clearMarkers').onclick = () => markerLayer.clear();

// Export
document.getElementById('savePng').onclick = savePNG;
document.getElementById('exportGLB').onclick = () => exportGLB(surfaceGroup);
document.getElementById('exportOBJ').onclick = () => exportOBJ(surfaceGroup);
document.getElementById('resetCamera').onclick = () => { camera.position.copy(defaultCamPos); controls.target.set(0,0,0); controls.update(); };

// Picking
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (ev) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(surfaceState.mesh, true)[0];
  if (!hit) return;

  if (pickingStart || pickingEnd) {
    const idx = hit.face ? hit.face.a : 0;
    const hitUV = hit.uv || new THREE.Vector2();
    const info = { uv: new THREE.Vector2(hitUV.x, hitUV.y), position: hit.point.clone() };
    if (pickingStart) { pickedStart = info; pickingStart = false; }
    if (pickingEnd) { pickedEnd = info; pickingEnd = false; }
    return;
  }
  if (markersEnable.checked) {
    markerLayer.addMarker(hit.point.clone(), {
      shape: markerShape.value,
      size: parseInt(markerSize.value, 10),
      color: markerColor.value,
    });
  }
});

// Render
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  markerLayer.update(camera, renderer);
}

function renderOnce() { renderer.render(scene, camera); }

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Export helpers
function savePNG() {
  const data = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a'); a.href = data; a.download = 'manifold.png'; a.click();
}

function exportGLB(group) {
  const exporter = new GLTFExporter();
  exporter.parse(group, (gltf) => {
    const blob = new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'surface.gltf'; a.click();
  }, { binary: false });
}

function exportOBJ(group) {
  const exporter = new OBJExporter();
  const obj = exporter.parse(group);
  const blob = new Blob([obj], { type: 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'surface.obj'; a.click();
}

function clampInt(id, min, max) { const v = parseInt(document.getElementById(id).value, 10); return Math.max(min, Math.min(max, isNaN(v)?min:v)); }

// Initial UI setup
document.getElementById('colorMode').value = 'gradient';
document.getElementById('solidRow').style.display = 'none';
document.getElementById('gradientEditor').style.display = 'flex';
addStopRow(0, '#a8c7ff');
addStopRow(1, '#ff9aa2');

// Start
regenerateSurface();
updateColors();
animate();

