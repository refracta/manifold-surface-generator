import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'https://unpkg.com/three@0.160.0/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'https://unpkg.com/three@0.160.0/examples/jsm/exporters/OBJExporter.js';
import { Line2 } from 'https://unpkg.com/three@0.160.0/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'https://unpkg.com/three@0.160.0/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'https://unpkg.com/three@0.160.0/examples/jsm/lines/LineGeometry.js';

import { buildSurface, colorizeGeometry, SurfacePresets, createSurfaceParams, setClip, makeLineClippable, setLineClip } from './surface.js';
import { buildIsoGrid, buildEdgeShortestPath, buildParamStraight } from './geodesic.js';
import { MarkerLayer } from './markers.js';

const container = document.getElementById('canvas-container');
const markerLayer = new MarkerLayer(document.getElementById('marker-layer'));

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
renderer.setClearColor(new THREE.Color('#f5f5f8'), 1);

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
let clipLinesGroup = new THREE.Group();
scene.add(geodesicGroup);
scene.add(clipLinesGroup);

let params = createSurfaceParams('ripple'); // start preset

function regenerateSurface() {
  if (surfaceGroup) scene.remove(surfaceGroup);
  const { group, state } = buildSurface(params);
  surfaceGroup = group;
  surfaceState = state;
  scene.add(surfaceGroup);
  updateClip();
  rebuildGeodesics();
}

function rebuildGeodesics() {
  geodesicGroup.clear();
  clipLinesGroup.clear();
  if (!document.getElementById('geoEnable').checked) return;
  const style = document.getElementById('geoStyle').value;
  const color = new THREE.Color(document.getElementById('geoColor').value);
  const alpha = parseFloat(document.getElementById('geoAlpha').value);
  const width = parseFloat(document.getElementById('geoWidth').value);
  const count = parseInt(document.getElementById('geoCount').value, 10);
  const method = document.getElementById('geoMethod').value;

  let lines = [];
  if (method === 'grid') {
    lines = buildIsoGrid(surfaceState, count);
  } else if (method === 'param-straight') {
    lines = buildParamStraight(surfaceState, count);
  }
  for (const geo of lines) {
    const line = toLine2(geo, { style, color, alpha, width });
    makeLineClippable(line.material, surfaceState.mesh);
    setLineClip(line.material, params.clip, params.scale);
    geodesicGroup.add(line);
  }

  // Mask overlay lines (outside masked region) if enabled
  if (document.getElementById('clipLinesEnable').checked && params.clip && params.clip.mode !== 'none') {
    const cstyle = document.getElementById('clipStyle').value;
    const ccolor = new THREE.Color(document.getElementById('clipColor').value);
    const calpha = parseFloat(document.getElementById('clipAlpha').value);
    const cwidth = parseFloat(document.getElementById('clipWidth').value);
    for (const geo of lines) {
      const line = toLine2(geo, { style: cstyle, color: ccolor, alpha: calpha, width: cwidth });
      makeLineClippable(line.material, surfaceState.mesh, true /* invert */);
      setLineClip(line.material, params.clip, params.scale, true);
      clipLinesGroup.add(line);
    }
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
  const op = parseFloat(document.getElementById('surfaceOpacity').value);
  surfaceState.mesh.material.opacity = op; surfaceState.mesh.material.transparent = op < 1;
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
  params = createSurfaceParams(name);
  // update general inputs
  document.getElementById('resU').value = String(params.resU);
  document.getElementById('resV').value = String(params.resV);
  document.getElementById('scale').value = String(params.scale);
  buildPresetParamsUI(name);
  regenerateSurface();
  updateColors();
}

document.getElementById('preset').addEventListener('change', (e) => setPreset(e.target.value));
document.getElementById('resU').addEventListener('change', () => { params.resU = clampInt('resU', 8, 512); regenerateSurface(); updateColors(); });
document.getElementById('resV').addEventListener('change', () => { params.resV = clampInt('resV', 8, 512); regenerateSurface(); updateColors(); });
document.getElementById('scale').addEventListener('input', (e) => { params.scale = parseFloat(e.target.value); regenerateSurface(); updateColors(); });
document.getElementById('wireframe').addEventListener('change', (e) => { if (surfaceState) { surfaceState.mesh.material.wireframe = e.target.checked; surfaceState.mesh.material.needsUpdate = true; }});

function updateBackground() {
  const c = document.getElementById('bgColor').value; const a = parseFloat(document.getElementById('bgAlpha').value);
  renderer.setClearColor(new THREE.Color(c), a);
}
document.getElementById('bgColor').addEventListener('input', updateBackground);
document.getElementById('bgAlpha').addEventListener('input', updateBackground);
document.getElementById('colorMode').addEventListener('change', (e) => {
  const solid = e.target.value === 'solid';
  document.getElementById('solidRow').style.display = solid ? 'flex' : 'none';
  document.getElementById('gradientEditor').style.display = solid ? 'none' : 'flex';
  updateColors();
});
document.getElementById('solidColor').addEventListener('input', updateColors);
document.getElementById('gradAxis').addEventListener('change', updateColors);
document.getElementById('addStop').addEventListener('click', () => { addStopRow(Math.random(), '#'+Math.floor(Math.random()*16777215).toString(16).padStart(6,'0')); updateColors(); });
document.getElementById('surfaceOpacity').addEventListener('input', updateColors);

// Clip/mask UI
function updateClip() {
  const mode = document.getElementById('clipMode').value;
  const rectW = parseFloat(document.getElementById('clipRectW').value);
  const rectH = parseFloat(document.getElementById('clipRectH').value);
  const radius = parseFloat(document.getElementById('clipRadius').value);
  params.clip = { mode, rectW, rectH, radius };
  if (surfaceState) { setClip(surfaceState.mesh.material, params.clip, params.scale); }
  geodesicGroup.traverse(obj => {
    if (obj.isLine && obj.material && obj.material.userData && obj.material.userData.clipUniforms) {
      setLineClip(obj.material, params.clip, params.scale);
    }
  });
  clipLinesGroup.traverse(obj => {
    if (obj.isLine2 || obj.isLine) {
      if (obj.material && obj.material.userData && obj.material.userData.clipUniforms) {
        setLineClip(obj.material, params.clip, params.scale, true);
      }
    }
  });
}

document.getElementById('clipMode').addEventListener('change', () => {
  const mode = document.getElementById('clipMode').value;
  document.getElementById('clipRect').style.display = (mode==='rect') ? 'flex' : 'none';
  document.getElementById('clipCircle').style.display = (mode==='circle') ? 'flex' : 'none';
  updateClip();
});
['clipRectW','clipRectH','clipRadius'].forEach(id => document.getElementById(id).addEventListener('input', updateClip));

document.getElementById('geoEnable').addEventListener('change', rebuildGeodesics);
document.getElementById('geoMethod').addEventListener('change', rebuildGeodesics);
document.getElementById('geoCount').addEventListener('change', rebuildGeodesics);
document.getElementById('geoWidth').addEventListener('input', rebuildGeodesics);
document.getElementById('geoStyle').addEventListener('change', rebuildGeodesics);
document.getElementById('geoColor').addEventListener('input', rebuildGeodesics);
document.getElementById('geoAlpha').addEventListener('input', rebuildGeodesics);

['clipLinesEnable','clipWidth','clipStyle','clipColor','clipAlpha'].forEach(id => {
  const el = document.getElementById(id); if (el) el.addEventListener('input', rebuildGeodesics);
});

// Interactive edge-shortest path
let pickingStart = false, pickingEnd = false; let pickedStart = null, pickedEnd = null;
document.getElementById('pickStart').onclick = () => { pickingStart = true; pickingEnd = false; };
document.getElementById('pickEnd').onclick = () => { pickingEnd = true; pickingStart = false; };
document.getElementById('addPath').onclick = () => {
  if (!pickedStart || !pickedEnd) return;
  const geo = buildEdgeShortestPath(surfaceState, pickedStart, pickedEnd);
  const style = document.getElementById('geoStyle').value;
  const color = new THREE.Color(document.getElementById('geoColor').value);
  const alpha = parseFloat(document.getElementById('geoAlpha').value);
  const width = parseFloat(document.getElementById('geoWidth').value);
  const line = toLine2(geo, { style, color, alpha, width });
  makeLineClippable(line.material, surfaceState.mesh);
  setLineClip(line.material, params.clip, params.scale);
  geodesicGroup.add(line);
  pickedStart = pickedEnd = null; pickingStart = pickingEnd = false;
};
document.getElementById('clearGeodesics').onclick = () => { geodesicGroup.clear(); rebuildGeodesics(); };

// Right-click: remove nearest marker
renderer.domElement.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const rect = renderer.domElement.getBoundingClientRect();
  markerLayer.removeNearestAt(ev.clientX - rect.left, ev.clientY - rect.top, 24);
});

// Markers
const markersEnable = document.getElementById('markersEnable');
const markerShape = document.getElementById('markerShape');
const markerSize = document.getElementById('markerSize');
const markerColor = document.getElementById('markerColor');
const markerAlpha = document.getElementById('markerAlpha');
document.getElementById('clearMarkers').onclick = () => markerLayer.clear();
markersEnable.addEventListener('change', () => markerLayer.setVisible(markersEnable.checked));
markerAlpha.addEventListener('input', () => markerLayer.setAlpha(parseFloat(markerAlpha.value)));

// Export
document.getElementById('savePng').onclick = savePNG;
document.getElementById('exportGLB').onclick = () => exportGLB(surfaceGroup);
document.getElementById('exportOBJ').onclick = () => exportOBJ(surfaceGroup);
document.getElementById('resetCamera').onclick = () => { camera.position.copy(defaultCamPos); controls.target.set(0,0,0); controls.update(); };

// Picking
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (ev) => {
  // Only left-button creates markers or picks geodesic endpoints
  if (ev.button !== 0) return;
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
      alpha: parseFloat(markerAlpha.value),
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
  // update resolution for fat line materials
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  [...geodesicGroup.children, ...clipLinesGroup.children].forEach(obj => { if (obj.material && obj.material.resolution) obj.material.resolution.set(w,h); });
});

// Export helpers
function savePNG() {
  const data = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a'); a.href = data; a.download = 'manifold.png'; a.click();
}

function exportGLB(group) {
  const exporter = new GLTFExporter();
  exporter.parse(group, (result) => {
    let blob, filename;
    if (result instanceof ArrayBuffer) {
      blob = new Blob([result], { type: 'model/gltf-binary' });
      filename = 'surface.glb';
    } else {
      blob = new Blob([JSON.stringify(result)], { type: 'model/gltf+json' });
      filename = 'surface.gltf';
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  }, { binary: true });
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
document.getElementById('bgAlpha').value = '1';
updateBackground();

// Start
setPreset('ripple');
updateColors();
animate();

// Build dynamic controls for the selected preset
function buildPresetParamsUI(presetName) {
  const container = document.getElementById('presetParams');
  container.innerHTML = '';
  const def = SurfacePresets[presetName];
  if (!def) return;
  for (const c of def.controls) {
    const row = document.createElement('div'); row.className = 'row';
    const label = document.createElement('label'); label.textContent = c.label; row.appendChild(label);
    let input;
    if (c.type === 'number') {
      input = document.createElement('input'); input.type = 'number'; input.step = c.step ?? 1; input.min = c.min ?? 0; input.max = c.max ?? 9999; input.value = params[c.key];
    } else { // range
      input = document.createElement('input'); input.type = 'range'; input.min = c.min; input.max = c.max; input.step = c.step; input.value = params[c.key];
    }
    input.id = `param_${c.key}`;
    input.addEventListener('input', () => { params[c.key] = (c.type==='number') ? parseFloat(input.value) : parseFloat(input.value); regenerateSurface(); updateColors(); });
    row.appendChild(input);
    // Randomize checkbox per parameter (default: all checked except Noise)
    const rand = document.createElement('input'); rand.type = 'checkbox'; rand.id = `rand_${c.key}`; rand.checked = (c.key.toLowerCase() !== 'noise');
    const randLabel = document.createElement('span'); randLabel.textContent = 'Rnd'; randLabel.style.fontSize = '12px';
    const wrap = document.createElement('div'); wrap.style.display = 'flex'; wrap.style.alignItems = 'center'; wrap.style.gap = '4px'; wrap.appendChild(randLabel); wrap.appendChild(rand);
    row.appendChild(wrap);
    container.appendChild(row);
  }
  // Randomize button
  const row = document.createElement('div'); row.className = 'row';
  const spacer = document.createElement('div'); spacer.style.width = '90px'; row.appendChild(spacer);
  const btn = document.createElement('button'); btn.textContent = 'Randomize'; btn.id = 'randomPreset';
  btn.addEventListener('click', () => randomizeCurrentPreset());
  row.appendChild(btn);
  container.appendChild(row);
}

function toLine2(bufferGeo, { style, color, alpha, width }) {
  const positions = bufferGeo.getAttribute('position').array;
  const geo = new LineGeometry();
  geo.setPositions(Array.from(positions));
  const mat = new LineMaterial({
    color: color.getHex(), transparent: alpha < 1, opacity: alpha, linewidth: width,
    dashed: style !== 'solid', dashSize: style==='dotted'?0.05:0.14, gapSize: style==='dotted'?0.12:0.06,
  });
  mat.resolution.set(renderer.domElement.clientWidth, renderer.domElement.clientHeight);
  const line = new Line2(geo, mat);
  return line;
}

function randomizeCurrentPreset() {
  const def = SurfacePresets[params.type]; if (!def) return;
  for (const c of def.controls) {
    // Skip if this parameter is not checked for randomization
    const cb = document.getElementById(`rand_${c.key}`); if (cb && !cb.checked) continue;
    const min = c.min ?? 0; const max = c.max ?? 1; const step = c.step ?? 0.01;
    let value;
    if (c.type === 'number' && (Number.isInteger(step) || step >= 1)) {
      const k = Math.floor(Math.random() * (Math.floor((max-min)/step)+1));
      value = min + k*step;
    } else {
      const steps = Math.max(1, Math.round((max - min) / step));
      const k = Math.floor(Math.random() * (steps + 1));
      value = min + k * step;
    }
    params[c.key] = value;
    const input = document.getElementById(`param_${c.key}`); if (input) input.value = String(value);
  }
  // If mountains preset, reset centers when bumpCount/seed change
  if (params.type === 'mountains') delete params._centers; // force recompute with current seed
  regenerateSurface();
  updateColors();
}
