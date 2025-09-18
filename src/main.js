import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'https://unpkg.com/three@0.160.0/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'https://unpkg.com/three@0.160.0/examples/jsm/exporters/OBJExporter.js';
import { Line2 } from 'https://unpkg.com/three@0.160.0/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'https://unpkg.com/three@0.160.0/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'https://unpkg.com/three@0.160.0/examples/jsm/lines/LineGeometry.js';

import { buildSurface, colorizeGeometry, SurfacePresets, createSurfaceParams, setClip, makeLineClippable, setLineClip, sampleSurfaceAtUV } from './surface.js';
import { buildIsoGrid, buildEdgeShortestPath, buildParamStraight } from './geodesic.js';
import { buildClipBoundary, buildDomainBoundary, clipPolylineToMask, estimateParamSpans, buildClipBoundarySuper } from './boundary.js';
import { MarkerLayer } from './markers.js';

const container = document.getElementById('canvas-container');
const markerLayer = new MarkerLayer(document.getElementById('marker-layer'));

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
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
// Save camera state on orbit changes (during and after)
let urlTimer = null; // declare early to avoid TDZ in scheduleUpdateURL
const __safeSchedule = () => { if (urlTimer===null) { setTimeout(()=>updateURLFromState?.(), 0); } else scheduleUpdateURL(); };
controls.addEventListener('change', __safeSchedule);
controls.addEventListener('end', __safeSchedule);
renderer.domElement.addEventListener('wheel', __safeSchedule, { passive: true });

// Lights
const amb = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(amb);
const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.5);
hemi.position.set(0,1,0); scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(2, 3, 2);
scene.add(dir);

// State (single-active-surface with multi-surface management)
let surfaceGroup = null; // active surface mesh group
let surfaceState = null; // active surface geometry/state
// Per-surface overlays live under each surfaceGroup (_geoGroup, _outlineGroup).
// Vectors and UV paths are attached to each surfaceGroup when created.
let vectorItems = [];
let uvItems = [];

// Multi-surface registry
const surfaces = [];
let activeSurfaceId = null;
let surfaceIdCounter = 1;

let params = null; // active surface params
let suppressURL = false;

function regenerateSurface() {
  if (!params) return;
  const entry = getActiveSurface ? getActiveSurface() : null;
  if (entry && entry.surfaceGroup) { try { scene.remove(entry.surfaceGroup); } catch {}
  }
  const { group, state } = buildSurface(params);
  if (entry) entry.surfaceGroup = group;
  surfaceGroup = group;
  surfaceState = state;
  scene.add(surfaceGroup);
  // overlay groups are per-surface (_geoGroup/_outlineGroup). Vectors/UV paths attach on creation.
  updateClip();
  rebuildGeodesics();
  rebuildBoundaryLines();
  rebuildVectorsAndUV();
  applyMaterialSettings();
}

function rebuildGeodesics() {
  if (!surfaceGroup || !surfaceState) return;
  if (!surfaceGroup._geoGroup) { surfaceGroup._geoGroup = new THREE.Group(); surfaceGroup.add(surfaceGroup._geoGroup); }
  const container = surfaceGroup._geoGroup; container.clear();
  if (!document.getElementById('geoEnable').checked) return;
  const style = document.getElementById('geoStyle').value;
  const color = new THREE.Color(document.getElementById('geoColor').value);
  const alpha = parseFloat(document.getElementById('geoAlpha').value);
  const width = parseFloat(document.getElementById('geoWidth').value);
  const dash = parseFloat(document.getElementById('geoDash')?.value || '0.14');
  const gap = parseFloat(document.getElementById('geoGap')?.value || '0.06');
  const count = parseInt(document.getElementById('geoCount').value, 10);
  const method = document.getElementById('geoMethod').value;

  let lines = [];
  let span = null;
  if (params.clip && params.clip.mode !== 'none') {
    span = estimateParamSpans(surfaceState, params.clip);
  }
  if (method === 'grid') {
    lines = buildIsoGrid(surfaceState, count, span);
  } else if (method === 'param-straight') {
    lines = buildParamStraight(surfaceState, count, span);
  }
  for (const geo of lines) {
    const pos = geo.getAttribute('position').array;
    const geos = (params.clip && params.clip.mode !== 'none') ? clipPolylineToMask(surfaceState, params.clip, pos) : [geo];
    for (const g of geos) {
      const line = toLine2(g, { style, color, alpha, width, depthTest: true, dash, gap });
      makeLineClippable(line.material, surfaceState.mesh);
      setLineClip(line.material, params.clip, params.scale);
      container.add(line);
    }
  }
  // Boundary lines handled separately
  // Edge-shortest path added interactively via buttons
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
  applyMaterialSettings();
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
document.getElementById('unlit').addEventListener('change', applyMaterialSettings);
document.getElementById('shadingStrength').addEventListener('input', applyMaterialSettings);
document.getElementById('emissiveIntensity').addEventListener('input', applyMaterialSettings);
document.getElementById('toneMapping').addEventListener('change', applyRendererSettings);
document.getElementById('exposure').addEventListener('input', applyRendererSettings);

document.getElementById('ambIntensity').addEventListener('input', () => { amb.intensity = parseFloat(document.getElementById('ambIntensity').value) * parseFloat(document.getElementById('shadingStrength').value); });
document.getElementById('hemiIntensity').addEventListener('input', () => { hemi.intensity = parseFloat(document.getElementById('hemiIntensity').value) * parseFloat(document.getElementById('shadingStrength').value); });
document.getElementById('dirIntensity').addEventListener('input', () => { dir.intensity = parseFloat(document.getElementById('dirIntensity').value) * parseFloat(document.getElementById('shadingStrength').value); });
document.getElementById('surfaceOpacity').addEventListener('input', updateColors);

// Clip/mask UI
function updateClip() {
  const mode = document.getElementById('clipMode').value;
  const rectW = parseFloat(document.getElementById('clipRectW').value);
  const rectH = parseFloat(document.getElementById('clipRectH').value);
  const radius = parseFloat(document.getElementById('clipRadius').value);
  params.clip = { mode, rectW, rectH, radius };
  if (surfaceState) { setClip(surfaceState.mesh.material, params.clip, params.scale); }
  if (surfaceGroup?._geoGroup) surfaceGroup._geoGroup.traverse(obj => {
    if (obj.material && obj.material.userData && obj.material.userData.clipUniforms) {
      setLineClip(obj.material, params.clip, params.scale);
    }
  });
  if (surfaceGroup?._outlineGroup) surfaceGroup._outlineGroup.traverse(obj => {
    if (obj.material && obj.material.userData && obj.material.userData.clipUniforms) {
      setLineClip(obj.material, overlayClipParams(), params.scale, true);
    }
  });
  // Regenerate geodesics so their polylines are CPU-clipped to new mask
  rebuildGeodesics();
  rebuildBoundaryLines();
}

function overlayClipParams() {
  // When mask mode is none, still use current UI values to preview lines
  const uiMode = document.getElementById('clipMode').value;
  if (params.clip && params.clip.mode !== 'none') return params.clip;
  if (uiMode === 'circle') {
    return { mode: 'circle', radius: parseFloat(document.getElementById('clipRadius').value) };
  }
  return { mode: 'rect', rectW: parseFloat(document.getElementById('clipRectW').value), rectH: parseFloat(document.getElementById('clipRectH').value) };
}

document.getElementById('clipMode').addEventListener('change', () => {
  const mode = document.getElementById('clipMode').value;
  document.getElementById('clipRect').style.display = (mode==='rect') ? 'flex' : 'none';
  document.getElementById('clipCircle').style.display = (mode==='circle') ? 'flex' : 'none';
  updateClip();
  updateRectLabels();
});
['clipRectW','clipRectH','clipRadius'].forEach(id => document.getElementById(id).addEventListener('input', ()=>{ updateClip(); updateRectLabels(); }));

document.getElementById('geoEnable').addEventListener('change', rebuildGeodesics);
document.getElementById('geoMethod').addEventListener('change', rebuildGeodesics);
document.getElementById('geoCount').addEventListener('change', rebuildGeodesics);
document.getElementById('geoWidth').addEventListener('input', rebuildGeodesics);
document.getElementById('geoStyle').addEventListener('change', rebuildGeodesics);
document.getElementById('geoColor').addEventListener('input', rebuildGeodesics);
document.getElementById('geoAlpha').addEventListener('input', rebuildGeodesics);
document.getElementById('geoDash')?.addEventListener('input', rebuildGeodesics);
document.getElementById('geoGap')?.addEventListener('input', rebuildGeodesics);

['clipLinesEnable','clipWidth','clipStyle','clipColor','clipAlpha','outlineFactor'].forEach(id => {
  const el = document.getElementById(id); if (el) el.addEventListener('input', rebuildBoundaryLines);
});
document.getElementById('clipDash')?.addEventListener('input', rebuildBoundaryLines);
document.getElementById('clipGap')?.addEventListener('input', rebuildBoundaryLines);

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
  const dash = parseFloat(document.getElementById('uvDash')?.value || '0.14');
  const gap = parseFloat(document.getElementById('uvGap')?.value || '0.06');
  let segments = [geo];
  if (params.clip && params.clip.mode !== 'none') {
    const pos = geo.getAttribute('position').array;
    segments = clipPolylineToMask(surfaceState, params.clip, pos);
  }
  for (const g of segments) {
    const line = toLine2(g, { style, color, alpha, width, depthTest: true, dash, gap });
    makeLineClippable(line.material, surfaceState.mesh);
    setLineClip(line.material, params.clip, params.scale);
    if (!surfaceGroup._geoGroup) { surfaceGroup._geoGroup = new THREE.Group(); surfaceGroup.add(surfaceGroup._geoGroup); }
    surfaceGroup._geoGroup.add(line);
  }
  pickedStart = pickedEnd = null; pickingStart = pickingEnd = false;
};
document.getElementById('clearGeodesics').onclick = () => { if (surfaceGroup?._geoGroup) surfaceGroup._geoGroup.clear(); rebuildGeodesics(); };

// Vector tools state
let vecPickStart=false, vecPickEnd=false, vecStart=null, vecEnd=null;
const btnVecStart = document.getElementById('vecPickStart');
const btnVecEnd = document.getElementById('vecPickEnd');
if (btnVecStart) btnVecStart.onclick=()=>{ if (vecPickStart) { vecPickStart=false; vecPickEnd=true; } else { vecPickStart=true; vecPickEnd=false; } updateToolButtons(); };
if (btnVecEnd) btnVecEnd.onclick=()=>{ if (vecPickEnd && vecStart && vecEnd) { addVectorArrow(vecStart, vecEnd); vecStart=vecEnd=null; markerLayer.clearTemps(); vecPickEnd=false; } else { vecPickEnd=true; vecPickStart=false; } updateToolButtons(); scheduleUpdateURL(); };
document.getElementById('clearVectors').onclick=()=>{ const cur=getActiveSurface(); const list = cur?.vectorItems || vectorItems; for (const it of (list||[])){ try{ it.obj?.parent?.remove(it.obj); it.cone?.parent?.remove(it.cone);}catch{} } if (cur) cur.vectorItems=[]; vectorItems=[]; scheduleUpdateURL(); };

let uvPickStart=false, uvPickEnd=false, uvStart=null, uvEnd=null;
const btnUVStart = document.getElementById('uvPickStart');
const btnUVEnd = document.getElementById('uvPickEnd');
if (btnUVStart) btnUVStart.onclick=()=>{ if (uvPickStart) { uvPickStart=false; uvPickEnd=true; } else { uvPickStart=true; uvPickEnd=false; } updateToolButtons(); };
if (btnUVEnd) btnUVEnd.onclick=()=>{ if (uvPickEnd && uvStart && uvEnd) { addUVLinePath(uvStart, uvEnd); uvStart=uvEnd=null; markerLayer.clearTemps(); uvPickEnd=false; } else { uvPickEnd=true; uvPickStart=false; } updateToolButtons(); scheduleUpdateURL(); };
document.getElementById('clearUVPaths').onclick=()=>{ const cur=getActiveSurface(); const list = cur?.uvItems || uvItems; for (const it of (list||[])){ try{ it.obj?.parent?.remove(it.obj);}catch{} } if (cur) cur.uvItems=[]; uvItems = []; scheduleUpdateURL(); };

// Right-click: remove nearest marker
renderer.domElement.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const rect = renderer.domElement.getBoundingClientRect();
  const removed = removeNearestMarker(ev.clientX - rect.left, ev.clientY - rect.top);
  let any = removed;
  if (!removed) { any = removeNearestVectorOrUV(ev.clientX - rect.left, ev.clientY - rect.top) || any; }
  if (any) scheduleUpdateURL();
});

// Markers
const markersEnable = document.getElementById('markersEnable');
const markerShape = document.getElementById('markerShape');
const markerSize = document.getElementById('markerSize');
const markerColor = document.getElementById('markerColor');
const markerAlpha = document.getElementById('markerAlpha');
const markerOutline = document.getElementById('markerOutline');
const markerOutlineColor = document.getElementById('markerOutlineColor');
document.getElementById('clearMarkers').onclick = () => { const cur = (typeof getActiveSurface==='function') ? getActiveSurface() : null; if (cur) cur.markerItems = []; rebuildAllMarkersOverlay?.(); scheduleUpdateURL(); };
markersEnable.addEventListener('change', () => markerLayer.setVisible(markersEnable.checked));
markerAlpha.addEventListener('input', () => markerLayer.setAlpha(parseFloat(markerAlpha.value)));
markerOutline?.addEventListener('input', () => { markerLayer.setDefaultOutline(parseFloat(markerOutline.value)); scheduleUpdateURL(); });
markerOutlineColor?.addEventListener('input', () => { markerLayer.setDefaultOutlineColor(markerOutlineColor.value); scheduleUpdateURL(); });

// -------- Markers per-surface management --------
function ensureSurfaceMarkerList(){ const cur=getActiveSurface(); if (!cur) return null; if (!cur.markerItems) cur.markerItems=[]; return cur.markerItems; }
function rebuildAllMarkersOverlay(){
  markerLayer.clear();
  for (const s of surfaces){
    const list = s.markerItems || [];
    for (let i=0;i<list.length;i++){
      const m = list[i];
      const pos = new THREE.Vector3(m.x||0,m.y||0,m.z||0);
      const added = markerLayer.addMarker(pos, { shape: m.shape||'circle', size: m.size||24, color: m.color||'#e53935', alpha: m.alpha==null?1:m.alpha, outline: m.outline, outlineColor: m.outlineColor });
      if (added) { added._sid = s.id; added._mindex = i; }
    }
  }
}
function addMarkerToActiveSurface(worldPos){
  const list = ensureSurfaceMarkerList(); if (!list) return;
  list.push({ x: worldPos.x, y: worldPos.y, z: worldPos.z,
    shape: markerShape.value, size: parseInt(markerSize.value,10), color: markerColor.value,
    alpha: parseFloat(markerAlpha.value), outline: parseFloat(markerOutline?.value||'3'), outlineColor: markerOutlineColor?.value||'#ffffff' });
  rebuildAllMarkersOverlay();
}
function removeNearestMarker(px,py){
  // find nearest in overlay layer markers
  const markers = markerLayer.markers || []; if (!markers.length) return false;
  let best=-1, bestD=1e12; const maxD=24*24;
  for (let i=0;i<markers.length;i++){
    const m=markers[i]; const dx=m.sx-px, dy=m.sy-py; const d=dx*dx+dy*dy; if (d<bestD){ bestD=d; best=i; }
  }
  if (best<0 || bestD>maxD) return false;
  const m = markers[best]; const sid=m._sid; const idx=m._mindex;
  if (sid){ const surf = surfaces.find(s=>s.id===sid); if (surf && surf.markerItems && idx>=0 && idx<surf.markerItems.length){ surf.markerItems.splice(idx,1); }
  }
  // rebuild overlay entirely to refresh indices
  rebuildAllMarkersOverlay();
  return true;
}

// Export
document.getElementById('savePng').onclick = () => savePNG(parseFloat(document.getElementById('pngScale').value||'1'));
document.getElementById('exportGLB').onclick = () => exportGLB(surfaceGroup);
document.getElementById('exportOBJ').onclick = () => exportOBJ(surfaceGroup);
document.getElementById('resetCamera').onclick = () => { camera.position.copy(defaultCamPos); controls.target.set(0,0,0); controls.update(); };
document.getElementById('pngAutoCrop')?.addEventListener('change', scheduleUpdateURL);

document.getElementById('resetAll').onclick = () => {
  markerLayer.clear();
  camera.position.copy(defaultCamPos);
  controls.target.set(0,0,0); controls.update();
  // reset to one default surface
  while (surfaces.length) surfaces.pop();
  const first = createSurfaceEntry(createSurfaceParams('ripple'), 'Surface 1');
  setActiveSurface(first.id, { silent: true });
  applyConfig(DEFAULTS);
  // Explicitly remove cfg from URL immediately
  const sp = new URLSearchParams(window.location.search); sp.delete('cfg');
  const url = window.location.pathname + (sp.toString()?('?'+sp.toString()):'');
  window.history.replaceState({}, '', url);
  scheduleUpdateURL();
};

// Picking / Click detection
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let isDown = false, moved = false, downX = 0, downY = 0;
const CLICK_MOVE_THRESH = 6; // px

renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return; // left only
  isDown = true; moved = false; downX = ev.clientX; downY = ev.clientY;
});

renderer.domElement.addEventListener('pointermove', (ev) => {
  if (!isDown) return;
  const dx = ev.clientX - downX, dy = ev.clientY - downY;
  if (Math.hypot(dx, dy) > CLICK_MOVE_THRESH) moved = true;
});

renderer.domElement.addEventListener('pointerup', (ev) => {
  if (ev.button !== 0) return; // left only
  const wasClick = isDown && !moved;
  isDown = false; moved = false;
  if (!wasClick) return; // ignore drags

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  // Raycast against all surface meshes if available
  let hit = null;
  try {
    const meshes = [];
    if (surfaceState?.mesh) meshes.push(surfaceState.mesh);
    // Collect any additional meshes attached to scene under root children
    scene.traverse(obj=>{ if (obj.isMesh && obj.geometry && obj.material) meshes.push(obj); });
    const hits = raycaster.intersectObjects(meshes, true);
    hit = hits && hits[0];
  } catch {}
  // restrict interactions to active surface only
  if (hit && surfaceGroup) {
    let o = hit.object, ok = false;
    while (o) { if (o === surfaceGroup) { ok = true; break; } o = o.parent; }
    if (!ok) return;
  }
  if (!hit) return;

  if (pickingStart || pickingEnd) {
    const hitUV = hit.uv || new THREE.Vector2();
    const info = { uv: new THREE.Vector2(hitUV.x, hitUV.y), position: hit.point.clone() };
    if (pickingStart) { pickedStart = info; pickingStart = false; }
    if (pickingEnd) { pickedEnd = info; pickingEnd = false; }
    return;
  }
  if (vecPickStart || vecPickEnd) {
    const hitUV = hit.uv || new THREE.Vector2();
    const info = { uv: new THREE.Vector2(hitUV.x, hitUV.y), position: hit.point.clone() };
    if (vecPickStart) { vecStart = info; vecPickStart = false; markerLayer.clearTemps(); markerLayer.addTempLabel(info.position,'S'); vecPickEnd = true; }
    else if (vecPickEnd) { vecEnd = info; addVectorArrow(vecStart, vecEnd); vecStart=vecEnd=null; vecPickEnd=false; markerLayer.clearTemps(); scheduleUpdateURL(); }
    updateToolButtons();
    return;
  }
  if (uvPickStart || uvPickEnd) {
    const hitUV = hit.uv || new THREE.Vector2();
    const info = { uv: new THREE.Vector2(hitUV.x, hitUV.y), position: hit.point.clone() };
    if (uvPickStart) { uvStart = info; uvPickStart = false; markerLayer.clearTemps(); markerLayer.addTempLabel(info.position,'S'); uvPickEnd = true; }
    else if (uvPickEnd) { uvEnd = info; addUVLinePath(uvStart, uvEnd); uvStart=uvEnd=null; uvPickEnd=false; markerLayer.clearTemps(); scheduleUpdateURL(); }
    updateToolButtons();
    return;
  }
  if (markersEnable.checked) { addMarkerToActiveSurface(hit.point.clone()); scheduleUpdateURL(); }
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
  // update resolution for fat line materials across scene
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  setLineResolutions(w,h);
});

// Export helpers
function savePNG(scale=1) {
  scale = Math.max(1, Math.min(8, isNaN(scale)?1:scale));
  const canvas = renderer.domElement;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const oldPR = renderer.getPixelRatio();
  const oldSize = new THREE.Vector2(); renderer.getSize(oldSize);

  // Upscale render
  renderer.setPixelRatio(1);
  renderer.setSize(w*scale, h*scale, false);
  // Update fat line materials resolution
  setLineResolutions(w*scale, h*scale);
  renderer.render(scene, camera);

  const autoCrop = document.getElementById('pngAutoCrop')?.checked ?? true;
  let data;
  let finalW = w*scale, finalH = h*scale;
  if (autoCrop) {
    const tempCanvas = document.createElement('canvas'); tempCanvas.width = w*scale; tempCanvas.height = h*scale;
    const ctx = tempCanvas.getContext('2d');
    ctx.drawImage(renderer.domElement, 0, 0);
    const imgData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const bg = ctx.getImageData(0,0,1,1).data;
    const bounds = computeCropBounds(imgData, bg);
    if (bounds) {
      const cropCanvas = document.createElement('canvas');
      finalW = bounds.width; finalH = bounds.height;
      cropCanvas.width = finalW; cropCanvas.height = finalH;
      const cropCtx = cropCanvas.getContext('2d');
      cropCtx.putImageData(imgData, -bounds.left, -bounds.top);
      data = cropCanvas.toDataURL('image/png');
    } else {
      data = tempCanvas.toDataURL('image/png');
    }
  } else {
    data = renderer.domElement.toDataURL('image/png');
  }

  // Restore
  renderer.setPixelRatio(oldPR);
  renderer.setSize(oldSize.x, oldSize.y, false);
  setLineResolutions(oldSize.x, oldSize.y);
  renderOnce();

  const a = document.createElement('a'); a.href = data; a.download = `manifold_${finalW}x${finalH}.png`; a.click();
}

function setLineResolutions(w,h){
  // Update resolutions for all line materials across all surfaces
  const seen = new Set();
  scene.traverse(o=>{ if ((o.isLine2 || o.isLine) && o.material && o.material.resolution && !seen.has(o)) { seen.add(o); o.material.resolution.set(w,h); } });
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

function updateToolButtons(){
  const e = (id, on)=> { const el=document.getElementById(id); if (el) el.classList.toggle('active', !!on); };
  e('vecPickStart', vecPickStart); e('vecPickEnd', vecPickEnd);
  e('uvPickStart', uvPickStart); e('uvPickEnd', uvPickEnd);
}

function updateRectLabels(){
  const wEl = document.getElementById('clipRectW');
  const hEl = document.getElementById('clipRectH');
  const wVal = document.getElementById('clipRectWVal');
  const hVal = document.getElementById('clipRectHVal');
  if (wEl && wVal) wVal.textContent = parseFloat(wEl.value).toFixed(2);
  if (hEl && hVal) hVal.textContent = parseFloat(hEl.value).toFixed(2);
}

function updateOffsetLabels(){
  const ox = document.getElementById('offsetX');
  const oy = document.getElementById('offsetY');
  const oz = document.getElementById('offsetZ');
  const vx = document.getElementById('offsetXVal');
  const vy = document.getElementById('offsetYVal');
  const vz = document.getElementById('offsetZVal');
  if (ox && vx) vx.textContent = Number(ox.value ?? 0).toFixed(2);
  if (oy && vy) vy.textContent = Number(oy.value ?? 0).toFixed(2);
  if (oz && vz) vz.textContent = Number(oz.value ?? 0).toFixed(2);
}

function removeNearestVectorOrUV(px, py){
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  const dist2 = (x,y,a,b,c,d)=>{ const vx=c-a, vy=d-b; const wx=x-a, wy=y-b; const c1=vx*wx+vy*wy; if (c1<=0) return (x-a)**2+(y-b)**2; const c2=vx*vx+vy*vy; if (c2<=c1) return (x-c)**2+(y-d)**2; const t=c1/c2; const qx=a+t*vx, qy=b+t*vy; return (x-qx)**2+(y-qy)**2; };
  const screen = (p)=>{ const v=p.clone().project(camera); return {x:(v.x*0.5+0.5)*w, y:(-v.y*0.5+0.5)*h}; };
  let best = { type:null, entry:null, idx:-1, d:1e12 };
  for (const entry of surfaces){
    const vItems = entry.vectorItems || [];
    vItems.forEach((it,idx)=>{
      const wpA = new THREE.Vector3(it.sx,it.sy,it.sz);
      const wpB = new THREE.Vector3(it.ex,it.ey,it.ez);
      if (entry.surfaceGroup) { entry.surfaceGroup.localToWorld(wpA); entry.surfaceGroup.localToWorld(wpB); }
      const a=screen(wpA);
      const b=screen(wpB);
      const d=dist2(px,py,a.x,a.y,b.x,b.y); if (d<best.d) best={type:'vec',entry,idx,d};
    });
    const uItems = entry.uvItems || [];
    uItems.forEach((it,idx)=>{
      const obj = it.obj; if (!obj) return; const pos = obj.geometry.getAttribute('position'); let dmin=1e12;
      const wp0=new THREE.Vector3(), wp1=new THREE.Vector3(); obj.updateMatrixWorld(true);
      for (let i=0;i<pos.count-1;i++){
        wp0.set(pos.getX(i),pos.getY(i),pos.getZ(i)); wp1.set(pos.getX(i+1),pos.getY(i+1),pos.getZ(i+1));
        obj.localToWorld(wp0); obj.localToWorld(wp1);
        const p0=screen(wp0); const p1=screen(wp1);
        const d=dist2(px,py,p0.x,p0.y,p1.x,p1.y); if (d<dmin) dmin=d;
      }
      if (dmin<best.d) best={type:'uv',entry,idx,d:dmin};
    });
  }
  const thresh=12*12; if (best.d>thresh || best.idx<0 || !best.entry) return false;
  if (best.type==='vec') {
    const list = best.entry.vectorItems || []; const it=list[best.idx];
    if (it?.obj) it.obj.parent?.remove(it.obj); if (it?.cone) it.cone.parent?.remove(it.cone);
    list.splice(best.idx,1); if (best.entry.id===activeSurfaceId) vectorItems = list; return true;
  } else if (best.type==='uv') {
    const list = best.entry.uvItems || []; const it=list[best.idx];
    if (it?.obj) it.obj.parent?.remove(it.obj);
    list.splice(best.idx,1); if (best.entry.id===activeSurfaceId) uvItems = list; return true;
  }
  return false;
}

function computeCropBounds(imageData, bg){
  const { width, height, data } = imageData;
  let top=height, bottom=-1, left=width, right=-1;
  const tol = 8;
  for (let y=0;y<height;y++){
    for (let x=0;x<width;x++){
      const idx = (y*width + x)*4;
      const r=data[idx], g=data[idx+1], b=data[idx+2], a=data[idx+3];
      if (Math.abs(r-bg[0])<=tol && Math.abs(g-bg[1])<=tol && Math.abs(b-bg[2])<=tol && Math.abs(a-bg[3])<=tol) continue;
      if (x<left) left=x;
      if (x>right) right=x;
      if (y<top) top=y;
      if (y>bottom) bottom=y;
    }
  }
  if (right<left || bottom<top) return null;
  return { left, top, right, bottom, width: right-left+1, height: bottom-top+1 };
}

// Initial UI setup
document.getElementById('colorMode').value = 'gradient';
document.getElementById('solidRow').style.display = 'none';
document.getElementById('gradientEditor').style.display = 'flex';
addStopRow(0, '#a8c7ff');
addStopRow(1, '#ff9aa2');
document.getElementById('bgAlpha').value = '1';
updateBackground();

// -------- Multi-surface: minimal manager (render all meshes; edit active) --------
function getSurface(id) { return surfaces.find(s => s.id === id); }
function getActiveSurface() { return getSurface(activeSurfaceId); }

function createSurfaceEntry(baseParams, name) {
  const id = `surface_${surfaceIdCounter++}`;
  const p = baseParams ? JSON.parse(JSON.stringify(baseParams)) : createSurfaceParams('ripple');
  const entry = { id, name: name || `Surface ${surfaces.length + 1}`, params: p, savedConfig: null, offset: { x:0, y:0, z:0 } };
  surfaces.push(entry);
  return entry;
}

function bindActive(entry) {
  params = entry.params;
  vectorItems = entry.vectorItems || (entry.vectorItems = []);
  uvItems = entry.uvItems || (entry.uvItems = []);
}

function saveActive() {
  const cur = getActiveSurface(); if (!cur) return;
  cur.params = params;
  cur.savedConfig = snapshotConfig();
}

function setActiveSurface(id, opts={}){
  if (activeSurfaceId === id) return;
  if (activeSurfaceId) saveActive();
  const entry = getSurface(id); if (!entry) return;
  activeSurfaceId = id;
  bindActive(entry);
  // Apply saved UI for that surface if available
  if (entry.savedConfig) {
    // applyConfig will rebuild geometry and then apply offset at the end
    applyConfig(entry.savedConfig);
  } else {
    regenerateSurface();
    if (surfaceGroup) {
      surfaceGroup.position.set(entry.offset.x, entry.offset.y, entry.offset.z);
    }
  }
  // Reflect offset in UI fields
  const ox = document.getElementById('offsetX');
  const oy = document.getElementById('offsetY');
  const oz = document.getElementById('offsetZ');
  if (ox) ox.value = String(entry.offset.x||0);
  if (oy) oy.value = String(entry.offset.y||0);
  if (oz) oz.value = String(entry.offset.z||0);
  updateOffsetLabels();
  updateSurfaceManagerUI();
  if (typeof rebuildAllMarkersOverlay==='function') rebuildAllMarkersOverlay();
}

function updateSurfaceManagerUI(){
  const sel = document.getElementById('surfaceSelect');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML='';
    for (const s of surfaces) { const o=document.createElement('option'); o.value=s.id; o.textContent=s.name||s.id; sel.appendChild(o); }
    if (activeSurfaceId) sel.value = activeSurfaceId; else if (sel.options.length) sel.selectedIndex=0;
  }
  const nameEl = document.getElementById('surfaceName');
  if (nameEl) { const cur=getActiveSurface(); nameEl.value = cur?.name || ''; }
}

function updateSurfaceSelect(){ updateSurfaceManagerUI(); }

// Hook manager UI
document.getElementById('surfaceSelect')?.addEventListener('change', (e)=>setActiveSurface(e.target.value));
document.getElementById('addSurface')?.addEventListener('click', ()=>{
  saveActive(); const base = params || createSurfaceParams('ripple'); const entry = createSurfaceEntry(base);
  setActiveSurface(entry.id);
});
document.getElementById('removeSurface')?.addEventListener('click', ()=>{
  if (!activeSurfaceId) return; const idx = surfaces.findIndex(s=>s.id===activeSurfaceId); if (idx<0) return;
  const mesh = surfaceGroup; if (mesh && mesh.parent) mesh.parent.remove(mesh);
  surfaces.splice(idx,1);
  const next = surfaces[idx] || surfaces[idx-1] || surfaces[0];
  if (next) setActiveSurface(next.id); else { params=null; surfaceGroup=null; surfaceState=null; }
  updateSurfaceManagerUI();
  if (typeof rebuildAllMarkersOverlay==='function') rebuildAllMarkersOverlay();
});
document.getElementById('surfaceName')?.addEventListener('input', (e)=>{ const cur=getActiveSurface(); if(cur){ cur.name=e.target.value||''; updateSurfaceManagerUI(); }});

// Location sliders per active surface
function applyOffsetFromUI(){
  const sx=parseFloat(document.getElementById('offsetX')?.value||'0');
  const sy=parseFloat(document.getElementById('offsetY')?.value||'0');
  const sz=parseFloat(document.getElementById('offsetZ')?.value||'0');
  if (surfaceGroup) surfaceGroup.position.set(sx,sy,sz);
  const cur=getActiveSurface(); if (cur) cur.offset={x:sx,y:sy,z:sz};  scheduleUpdateURL();
  updateOffsetLabels();
}
['offsetX','offsetY','offsetZ'].forEach(id=>document.getElementById(id)?.addEventListener('input', applyOffsetFromUI));

// Boot: start with one surface
const first = createSurfaceEntry(createSurfaceParams('ripple'), 'Surface 1');
setActiveSurface(first.id);
updateColors();
animate();

// ---------------- URL state sync (save/load) ----------------
const DEFAULTS = snapshotConfig();

function snapshotAppState(){
  // Save current active
  const active = activeSurfaceId;
  const arr = surfaces.map(s => ({ id: s.id, name: s.name,
    config: (function(){
      const oldParams = params; const oldActive = activeSurfaceId; const oldVec = vectorItems; const oldUV = uvItems;
      let cfg;
      try { activeSurfaceId = s.id; params = s.params; vectorItems = s.vectorItems || []; uvItems = s.uvItems || []; cfg = snapshotConfig(); }
      catch(e){ cfg = s.savedConfig || DEFAULTS; }
      finally { params = oldParams; activeSurfaceId = oldActive; vectorItems = oldVec; uvItems = oldUV; }
      // Ensure location reflects this surface entry's offset, not the current active group's transform
      if (!cfg) cfg = {};
      const off = s.offset || { x:0, y:0, z:0 };
      cfg.location = { x: Number(off.x||0), y: Number(off.y||0), z: Number(off.z||0) };
      return cfg;
    })() }));
  return { active, surfaces: arr };
}

let DEFAULT_APP = snapshotAppState();

applyConfigFromURL();

function setAppState(state){
  if (!state || !Array.isArray(state.surfaces) || state.surfaces.length===0) return;
  // clear scene meshes
  if (surfaceGroup && surfaceGroup.parent) surfaceGroup.parent.remove(surfaceGroup);
  surfaces.splice(0, surfaces.length);
  // rebuild surfaces
  for (const entry of state.surfaces){
    const e = createSurfaceEntry(null, entry.name || entry.id);
    e.id = entry.id || `surface_${surfaceIdCounter++}`;
    e.savedConfig = entry.config || null;
    // adopt stored location into offset so we don't rely on active surfaceGroup state
    const loc = entry?.config?.location;
    if (loc && typeof loc === 'object') {
      e.offset = { x: Number(loc.x||0), y: Number(loc.y||0), z: Number(loc.z||0) };
    }
  }
  updateSurfaceManagerUI();
  if (typeof rebuildAllMarkersOverlay==='function') rebuildAllMarkersOverlay();
  const target = state.active && surfaces.find(s=>s.id===state.active) ? state.active : surfaces[0].id;
  suppressURL = true;
  setActiveSurface(target, { silent: true });
  // build meshes for all (switch around silently), applying each savedConfig
  const cur = activeSurfaceId;
  for (const s of surfaces){
    setActiveSurface(s.id, { silent: true });
    if (s.savedConfig) applyConfig(s.savedConfig);
    regenerateSurface();
    // ensure offset is applied on the created mesh
    if (s.surfaceGroup && s.offset) s.surfaceGroup.position.set(s.offset.x, s.offset.y, s.offset.z);
  }
  setActiveSurface(cur, { silent: true });
  suppressURL = false;
  if (typeof rebuildAllMarkersOverlay==='function') rebuildAllMarkersOverlay();
}

function updateURLFromState() {
  const cur = snapshotAppState();
  const diff = deepDiff(cur, DEFAULT_APP) || {};
  const sp = new URLSearchParams(window.location.search);
  if (Object.keys(diff).length === 0) {
    sp.delete('cfg');
  } else {
    // Single-encode via URLSearchParams; store raw JSON
    sp.set('cfg', JSON.stringify(diff));
  }
  const url = window.location.pathname + (sp.toString() ? ('?' + sp.toString()) : '');
  window.history.replaceState({}, '', url);
}
function scheduleUpdateURL(){ if (suppressURL) return; if (urlTimer) clearTimeout(urlTimer); urlTimer=setTimeout(updateURLFromState, 200); }

function applyConfigFromURL() {
  const sp = new URLSearchParams(window.location.search);
  const raw = sp.get('cfg');
  if (!raw) { scheduleUpdateURL(); return; }
  let diff = null;
  // Prefer single-encoded read: parse raw JSON; if that fails, try one decode pass
  try { diff = JSON.parse(raw); }
  catch(e) {
    try { diff = JSON.parse(decodeURIComponent(raw)); } catch { diff = null; }
  }
  if (!diff) { console.warn('Invalid cfg param'); scheduleUpdateURL(); return; }
  // If multi-surface state
  if (Array.isArray(diff.surfaces)) { setAppState(diff); scheduleUpdateURL(); return; }
  // Backward-compat: single-surface
  applyConfig(diff);
  scheduleUpdateURL();
}

// Debounced URL update on any input/change inside the panel
const panelEl = document.getElementById('overlay-panel');
panelEl.addEventListener('input', scheduleUpdateURL);
panelEl.addEventListener('change', scheduleUpdateURL);

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
    rand.addEventListener('change', scheduleUpdateURL);
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

function toLine2(bufferGeo, { style, color, alpha, width, depthTest=true, depthWrite, dash, gap, zOffset=-1 }) {
  const positions = bufferGeo.getAttribute('position').array;
  const densified = densifyPositions(positions, Math.max(1, Math.ceil(width * 0.6)));
  const geo = new LineGeometry();
  geo.setPositions(Array.from(densified));
  const isSolid = (style === 'solid');
  const mat = new LineMaterial({
    color: color.getHex(), transparent: alpha < 1, opacity: alpha, linewidth: width,
    dashed: !isSolid, dashSize: (dash!=null?dash:(style==='dotted'?0.05:0.14)), gapSize: (gap!=null?gap:(style==='dotted'?0.12:0.06)),
  });
  mat.depthTest = depthTest; // depth test controls occlusion
  mat.depthWrite = (depthWrite == null ? depthTest : depthWrite); // optionally disable depth write
  if (depthTest) { mat.polygonOffset = true; mat.polygonOffsetFactor = zOffset; mat.polygonOffsetUnits = zOffset; }
  mat.alphaToCoverage = false; // avoid dotted appearance on some GPUs
  mat.resolution.set(renderer.domElement.clientWidth, renderer.domElement.clientHeight);
  const line = new Line2(geo, mat);
  if (!isSolid) line.computeLineDistances();
  return line;
}

// Rebuild vectors and UV paths for the active surface after geometry changes
function rebuildVectorsAndUV(){
  const cur = getActiveSurface(); if (!cur || !surfaceGroup || !surfaceState) return;
  // Rebuild vectors
  const vDash = parseFloat(document.getElementById('vecDash')?.value || '0.14');
  const vGap = parseFloat(document.getElementById('vecGap')?.value || '0.06');
  if (Array.isArray(cur.vectorItems)) {
    for (const it of cur.vectorItems) { try{ it.obj?.parent?.remove(it.obj); it.cone?.parent?.remove(it.cone);}catch{} }
    for (const it of cur.vectorItems) {
      const a = new THREE.Vector3(it.sx, it.sy, it.sz);
      const b = new THREE.Vector3(it.ex, it.ey, it.ez);
      const positions = new Float32Array([ a.x,a.y,a.z, b.x,b.y,b.z ]);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
      const matColor = new THREE.Color(it.color || '#000000');
      const line = toLine2(geo, { style: it.style || 'solid', color: matColor, alpha: 1, width: it.width || 1.0, depthTest: true, dash: vDash, gap: vGap });
      surfaceGroup.add(line);
      // arrow head
      const dir = new THREE.Vector3().subVectors(b, a); let cone=null; const len=dir.length();
      if (len>1e-6){ dir.normalize(); const headLen=Math.max(0.02,0.06*len); const headRad=Math.max(0.01,0.02*len);
        const coneGeo=new THREE.ConeGeometry(headRad, headLen, 12); const coneMat=new THREE.MeshStandardMaterial({ color: matColor.getHex(), emissive: 0x000000, roughness: 0.5, metalness: 0.0 });
        cone=new THREE.Mesh(coneGeo, coneMat); cone.position.copy(b); cone.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir.clone().normalize()); cone.position.add(dir.clone().multiplyScalar(-headLen*0.5)); surfaceGroup.add(cone);
      }
      it.obj = line; it.cone = cone;
    }
  }
  // Rebuild UV paths
  const uDash = parseFloat(document.getElementById('uvDash')?.value || '0.14');
  const uGap = parseFloat(document.getElementById('uvGap')?.value || '0.06');
  if (Array.isArray(cur.uvItems)) {
    for (const it of cur.uvItems) { try{ it.obj?.parent?.remove(it.obj);}catch{} }
    for (const it of cur.uvItems) {
      const segs = 200; const positions = new Float32Array(segs*3);
      for (let i=0;i<segs;i++){ const t=i/(segs-1); const u=it.su*(1-t)+it.eu*t; const v=it.sv*(1-t)+it.ev*t; const p=sampleSurfaceAtUV(surfaceState,u,v); positions[i*3+0]=p.x; positions[i*3+1]=p.y; positions[i*3+2]=p.z; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
      const matColor = new THREE.Color(it.color || '#000000');
      const line = toLine2(geo, { style: it.style || 'solid', color: matColor, alpha: 1, width: it.width || 1.0, depthTest: true, dash: uDash, gap: uGap });
      makeLineClippable(line.material, surfaceState.mesh);
      setLineClip(line.material, params.clip, params.scale);
      surfaceGroup.add(line); it.obj = line;
    }
  }
}

// densify line positions to reduce sharp miter artifacts for thick solid lines
function densifyPositions(arr, nSub) {
  if (!arr || arr.length < 6 || nSub <= 1) return arr;
  const out = [];
  const N = arr.length/3;
  for (let i=0;i<N-1;i++) {
    const x1=arr[i*3], y1=arr[i*3+1], z1=arr[i*3+2];
    const x2=arr[(i+1)*3], y2=arr[(i+1)*3+1], z2=arr[(i+1)*3+2];
    out.push(x1,y1,z1);
    for (let s=1;s<nSub;s++) {
      const t=s/nSub; out.push(x1+(x2-x1)*t, y1+(y2-y1)*t, z1+(z2-z1)*t);
    }
  }
  out.push(arr[(N-1)*3], arr[(N-1)*3+1], arr[(N-1)*3+2]);
  return new Float32Array(out);
}

function applyRendererSettings() {
  const tm = document.getElementById('toneMapping').value;
  const map = { none: THREE.NoToneMapping, aces: THREE.ACESFilmicToneMapping, reinhard: THREE.ReinhardToneMapping, cineon: THREE.CineonToneMapping, linear: THREE.LinearToneMapping };
  renderer.toneMapping = map[tm] ?? THREE.NoToneMapping;
  renderer.toneMappingExposure = parseFloat(document.getElementById('exposure').value);
}

function applyMaterialSettings() {
  if (!surfaceState) return;
  const unlit = document.getElementById('unlit').checked;
  const emiss = parseFloat(document.getElementById('emissiveIntensity').value);
  const shadeK = parseFloat(document.getElementById('shadingStrength').value);
  const op = parseFloat(document.getElementById('surfaceOpacity').value);
  // Update lights with shading strength
  const ambBase = parseFloat(document.getElementById('ambIntensity').value);
  const hemiBase = parseFloat(document.getElementById('hemiIntensity').value);
  const dirBase = parseFloat(document.getElementById('dirIntensity').value);
  amb.intensity = ambBase * shadeK;
  hemi.intensity = hemiBase * shadeK;
  dir.intensity = dirBase * shadeK;

  const prev = surfaceState.mesh.material;
  if (unlit) {
    if (!(prev && prev.isMeshBasicMaterial)) {
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: op < 1, opacity: op });
      // ensure clipping works on unlit as well
      makeClippable(mat);
      surfaceState.mesh.material = mat;
    } else { prev.opacity = op; prev.transparent = op < 1; }
  } else {
    if (!(prev && prev.isMeshStandardMaterial)) {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.0, roughness: 0.6, side: THREE.DoubleSide, transparent: op < 1, opacity: op });
      makeClippable(mat);
      surfaceState.mesh.material = mat;
    } else { prev.opacity = op; prev.transparent = op < 1; }
    surfaceState.mesh.material.emissive = new THREE.Color(0xffffff);
    surfaceState.mesh.material.emissiveIntensity = emiss;
  }
  // reapply current clip on new material
  setClip(surfaceState.mesh.material, params.clip, params.scale);
}

// Build a vector arrow between two picked points (straight segment + cone head)
function addVectorArrow(startInfo, endInfo){
  const cur = getActiveSurface();
  const color = new THREE.Color(document.getElementById('vecColor').value);
  const width = parseFloat(document.getElementById('vecWidth').value);
  const style = document.getElementById('vecStyle').value;
  const dash = parseFloat(document.getElementById('vecDash')?.value || '0.14');
  const gap = parseFloat(document.getElementById('vecGap')?.value || '0.06');
  const aW = startInfo.position.clone();
  const bW = endInfo.position.clone();
  const a = surfaceGroup ? surfaceGroup.worldToLocal(aW) : aW;
  const b = surfaceGroup ? surfaceGroup.worldToLocal(bW) : bW;
  const positions = new Float32Array([ a.x, a.y, a.z, b.x, b.y, b.z ]);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
  const line = toLine2(geo, { style, color, alpha: 1, width, depthTest: true, dash, gap });
  (surfaceGroup||scene).add(line);
  // Arrow head
  const dir = new THREE.Vector3().subVectors(b, a);
  let cone = null;
  const len = dir.length(); if (len > 1e-6){
    dir.normalize();
    const headLen = Math.max(0.02, 0.06 * len);
    const headRad = Math.max(0.01, 0.02 * len);
    const coneGeo = new THREE.ConeGeometry(headRad, headLen, 12);
    const coneMat = new THREE.MeshStandardMaterial({ color: color.getHex(), emissive: 0x000000, roughness: 0.5, metalness: 0.0 });
    cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.copy(b);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir.clone().normalize());
    cone.position.add(dir.clone().multiplyScalar(-headLen*0.5));
    (surfaceGroup||scene).add(cone);
  }
  // save for cfg
  if (cur) { if (!cur.vectorItems) cur.vectorItems = []; }
  const list = cur?.vectorItems || vectorItems;
  list.push({ sx: a.x, sy: a.y, sz: a.z,
                     ex: b.x, ey: b.y, ez: b.z,
                     color: '#' + color.getHexString(), width, style, obj: line, cone });
  vectorItems = list;
}

// Build a path that follows straight line in UV and maps to surface
function addUVLinePath(startInfo, endInfo){
  const cur = getActiveSurface();
  const color = new THREE.Color(document.getElementById('uvColor').value);
  const width = parseFloat(document.getElementById('uvWidth').value);
  const style = document.getElementById('uvStyle').value;
  const dash = parseFloat(document.getElementById('geoDash')?.value || '0.14');
  const gap = parseFloat(document.getElementById('geoGap')?.value || '0.06');
  const segs = 200;
  const positions = new Float32Array(segs*3);
  for (let i=0;i<segs;i++){
    const t = i/(segs-1);
    const u = startInfo.uv.x*(1-t) + endInfo.uv.x*t;
    const v = startInfo.uv.y*(1-t) + endInfo.uv.y*t;
    const p = sampleSurfaceAtUV(surfaceState, u, v);
    positions[i*3+0]=p.x; positions[i*3+1]=p.y; positions[i*3+2]=p.z;
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
  const line = toLine2(geo, { style, color, alpha: 1, width, depthTest: true, dash, gap });
  makeLineClippable(line.material, surfaceState.mesh);
  setLineClip(line.material, params.clip, params.scale);
  (surfaceGroup||scene).add(line);
  if (cur) { if (!cur.uvItems) cur.uvItems = []; }
  const list = cur?.uvItems || uvItems;
  list.push({ su: startInfo.uv.x, sv: startInfo.uv.y, eu: endInfo.uv.x, ev: endInfo.uv.y,
                 color: '#' + color.getHexString(), width, style, obj: line });
  uvItems = list;
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

// Rebuild boundary (closed) lines for the current domain or mask
function rebuildBoundaryLines() {
  if (!surfaceGroup || !surfaceState) return;
  if (!surfaceGroup._outlineGroup) { surfaceGroup._outlineGroup = new THREE.Group(); surfaceGroup.add(surfaceGroup._outlineGroup); }
  const container = surfaceGroup._outlineGroup; container.clear();
  if (!document.getElementById('clipLinesEnable').checked) return;
  const style = document.getElementById('clipStyle').value;
  const color = new THREE.Color(document.getElementById('clipColor').value);
  const alpha = parseFloat(document.getElementById('clipAlpha').value);
  const width = parseFloat(document.getElementById('clipWidth').value);
  const dash = parseFloat(document.getElementById('clipDash')?.value || '0.14');
  const gap = parseFloat(document.getElementById('clipGap')?.value || '0.06');

  let boundaryGeos;
  if (params.clip && params.clip.mode !== 'none') {
    const factor = parseInt(document.getElementById('outlineFactor')?.value||'2',10);
    boundaryGeos = (buildClipBoundarySuper?.(surfaceState, params.clip, factor)) || buildClipBoundary(surfaceState, params.clip);
  } else {
    boundaryGeos = buildDomainBoundary(surfaceState);
  }
  for (const g of boundaryGeos) {
    // Occluding outline: depthTest on, slight positive polygonOffset to reduce z-fighting
    const line = toLine2(g, { style, color, alpha, width, depthTest: true, dash, gap, depthWrite: false, zOffset: 1 });
    container.add(line);
  }
}

// Take a snapshot of current UI state and params (for active surface)
function snapshotConfig() {
  const cfg = { preset: params.type, resU: params.resU, resV: params.resV, scale: params.scale, location: (surfaceGroup? { x: surfaceGroup.position.x, y: surfaceGroup.position.y, z: surfaceGroup.position.z } : {x:0,y:0,z:0}),
    presetParams: {}, wireframe: !!document.getElementById('wireframe').checked,
    camera: { pos: [camera.position.x, camera.position.y, camera.position.z], target: [controls.target.x, controls.target.y, controls.target.z], fov: camera.fov },
    mask: {
      mode: document.getElementById('clipMode').value,
      rectW: parseFloat(document.getElementById('clipRectW').value),
      rectH: parseFloat(document.getElementById('clipRectH').value),
      radius: parseFloat(document.getElementById('clipRadius').value),
      show: !!document.getElementById('clipLinesEnable').checked,
      width: parseFloat(document.getElementById('clipWidth').value),
      style: document.getElementById('clipStyle').value,
      dash: parseFloat(document.getElementById('clipDash')?.value || '0.14'),
      gap: parseFloat(document.getElementById('clipGap')?.value || '0.06'),
      color: document.getElementById('clipColor').value,
      alpha: parseFloat(document.getElementById('clipAlpha').value),
      outlineSamp: parseInt(document.getElementById('outlineFactor')?.value||'2',10)
    },
    colors: {
      bg: document.getElementById('bgColor').value,
      bgA: parseFloat(document.getElementById('bgAlpha').value),
      mode: document.getElementById('colorMode').value,
      solid: document.getElementById('solidColor').value,
      opacity: parseFloat(document.getElementById('surfaceOpacity').value),
      axis: document.getElementById('gradAxis').value,
      stops: readGradientStops(),
      unlit: !!document.getElementById('unlit')?.checked,
      shadingStrength: parseFloat(document.getElementById('shadingStrength')?.value || '1'),
      emissiveIntensity: parseFloat(document.getElementById('emissiveIntensity')?.value || '0'),
      toneMapping: document.getElementById('toneMapping')?.value || 'none',
      exposure: parseFloat(document.getElementById('exposure')?.value || '1')
    },
    geodesics: {
      enable: !!document.getElementById('geoEnable').checked,
      method: document.getElementById('geoMethod').value,
      count: parseInt(document.getElementById('geoCount').value,10),
      width: parseFloat(document.getElementById('geoWidth').value),
      style: document.getElementById('geoStyle').value,
      dash: parseFloat(document.getElementById('geoDash')?.value || '0.14'),
      gap: parseFloat(document.getElementById('geoGap')?.value || '0.06'),
      color: document.getElementById('geoColor').value,
      alpha: parseFloat(document.getElementById('geoAlpha').value)
    },
    markers: {
      enable: !!document.getElementById('markersEnable').checked,
      shape: document.getElementById('markerShape').value,
      size: parseInt(document.getElementById('markerSize').value,10),
      color: document.getElementById('markerColor').value,
      alpha: parseFloat(document.getElementById('markerAlpha').value),
      outline: parseFloat(document.getElementById('markerOutline')?.value || '3'),
      outlineColor: document.getElementById('markerOutlineColor')?.value || '#ffffff',
      items: ((typeof getActiveSurface==='function') && getActiveSurface()?.markerItems) || []
    }
    ,lighting: {
      amb: parseFloat(document.getElementById('ambIntensity')?.value || '0.6'),
      hemi: parseFloat(document.getElementById('hemiIntensity')?.value || '0.5'),
      dir: parseFloat(document.getElementById('dirIntensity')?.value || '0.8')
    }
    ,vectors: {
      color: document.getElementById('vecColor').value,
      width: parseFloat(document.getElementById('vecWidth').value),
      style: document.getElementById('vecStyle').value,
      dash: parseFloat(document.getElementById('vecDash')?.value || '0.14'),
      gap: parseFloat(document.getElementById('vecGap')?.value || '0.06'),
      items: vectorItems.map(it=>({ sx:it.sx,sy:it.sy,sz:it.sz, ex:it.ex,ey:it.ey,ez:it.ez, color:it.color, width:it.width, style:it.style }))
    }
    ,uvpaths: {
      color: document.getElementById('uvColor').value,
      width: parseFloat(document.getElementById('uvWidth').value),
      style: document.getElementById('uvStyle').value,
      dash: parseFloat(document.getElementById('uvDash')?.value || '0.14'),
      gap: parseFloat(document.getElementById('uvGap')?.value || '0.06'),
      items: uvItems.map(it=>({ su:it.su,sv:it.sv, eu:it.eu,ev:it.ev, color:it.color, width:it.width, style:it.style }))
    }
    ,export: {
      pngScale: parseFloat(document.getElementById('pngScale')?.value || '1'),
      autoCrop: !!document.getElementById('pngAutoCrop')?.checked
    }
  };
  // preset specific values
  const def = SurfacePresets[cfg.preset];
  if (def) {
    cfg.presetRand = {};
    for (const c of def.controls) {
      cfg.presetParams[c.key] = params[c.key];
      const cb = document.getElementById(`rand_${c.key}`); if (cb) cfg.presetRand[c.key] = !!cb.checked;
    }
  }
  return cfg;
}

function deepDiff(cur, def) {
  if (Array.isArray(cur) && Array.isArray(def)) {
    return JSON.stringify(cur) === JSON.stringify(def) ? undefined : cur;
  } else if (typeof cur === 'object' && cur && typeof def === 'object' && def) {
    const out = {}; let any=false; for (const k of new Set([...Object.keys(cur), ...Object.keys(def)])) {
      const d = deepDiff(cur[k], def[k]); if (d !== undefined) { out[k]=d; any=true; }
    }
    return any ? out : undefined;
  } else {
    return (cur === def) ? undefined : cur;
  }
}

// (moved) updateURLFromState / scheduleUpdateURL / applyConfigFromURL are defined earlier for multi-surface state.

function applyConfig(diff) {
  if (!diff || typeof diff !== 'object') return;
  // Location (surface offset)
  if (diff.location) {
    const l = diff.location; const sx = Number(l.x ?? 0), sy = Number(l.y ?? 0), sz = Number(l.z ?? 0);
    const ox = document.getElementById('offsetX'); const oy = document.getElementById('offsetY'); const oz = document.getElementById('offsetZ');
    if (ox) ox.value = String(sx); if (oy) oy.value = String(sy); if (oz) oz.value = String(sz);
    const cur = (typeof getActiveSurface==='function') ? getActiveSurface() : null; if (cur) cur.offset = { x:sx, y:sy, z:sz };
    updateOffsetLabels();
  }
  // Preset first
  if (diff.preset && diff.preset !== params.type) { document.getElementById('preset').value = diff.preset; setPreset(diff.preset); }
  if (diff.resU) { document.getElementById('resU').value = diff.resU; params.resU = diff.resU; }
  if (diff.resV) { document.getElementById('resV').value = diff.resV; params.resV = diff.resV; }
  if (diff.scale) { document.getElementById('scale').value = diff.scale; params.scale = diff.scale; }
  if (diff.presetParams) {
    for (const [k,v] of Object.entries(diff.presetParams)) { params[k] = v; const el = document.getElementById(`param_${k}`); if (el) el.value = v; }
  }
  if (diff.presetRand) {
    for (const [k,v] of Object.entries(diff.presetRand)) { const el = document.getElementById(`rand_${k}`); if (el) el.checked = !!v; }
  }
  if (diff.camera) {
    const c = diff.camera;
    if (Array.isArray(c.pos)) camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
    if (Array.isArray(c.target)) controls.target.set(c.target[0], c.target[1], c.target[2]);
    if (typeof c.fov === 'number') { camera.fov = c.fov; camera.updateProjectionMatrix(); }
    controls.update();
  }
  // Mask
  if (diff.mask) {
    const m = diff.mask;
    if (m.mode) document.getElementById('clipMode').value = m.mode;
    // backward-compat: width/height or w/h map to rectW/rectH
    const rectW = (m.rectW!=null) ? m.rectW : (m.width!=null ? m.width : (m.w!=null ? m.w : undefined));
    const rectH = (m.rectH!=null) ? m.rectH : (m.height!=null ? m.height : (m.h!=null ? m.h : undefined));
    if (rectW!=null) document.getElementById('clipRectW').value = rectW;
    if (rectH!=null) document.getElementById('clipRectH').value = rectH;
    if (m.radius!=null) document.getElementById('clipRadius').value = m.radius;
    if (m.show!=null) document.getElementById('clipLinesEnable').checked = !!m.show;
    if (m.width!=null) document.getElementById('clipWidth').value = m.width;
    if (m.style) {
      const val = (m.style === 'solid') ? 'solid' : 'pattern';
      document.getElementById('clipStyle').value = val;
    }
    if (m.dash!=null) { const e=document.getElementById('clipDash'); if(e) e.value=m.dash; }
    if (m.gap!=null) { const e=document.getElementById('clipGap'); if(e) e.value=m.gap; }
    if (m.color) document.getElementById('clipColor').value = m.color;
    if (m.alpha!=null) document.getElementById('clipAlpha').value = m.alpha;
    if (m.outlineSamp!=null) { const e=document.getElementById('outlineFactor'); if (e) e.value = m.outlineSamp; }
  }
  // Colors
  if (diff.colors) {
    const c = diff.colors;
    if (c.bg) document.getElementById('bgColor').value = c.bg;
    if (c.bgA!=null) document.getElementById('bgAlpha').value = c.bgA;
    if (c.mode) document.getElementById('colorMode').value = c.mode;
    if (c.solid) document.getElementById('solidColor').value = c.solid;
    if (c.opacity!=null) document.getElementById('surfaceOpacity').value = c.opacity;
    if (c.axis) document.getElementById('gradAxis').value = c.axis;
    if (c.stops) { document.getElementById('stops').innerHTML=''; for (const s of c.stops) addStopRow(s.t, s.color); }
    if (c.unlit!=null) document.getElementById('unlit').checked = !!c.unlit;
    if (c.shadingStrength!=null) document.getElementById('shadingStrength').value = c.shadingStrength;
    if (c.emissiveIntensity!=null) document.getElementById('emissiveIntensity').value = c.emissiveIntensity;
    if (c.toneMapping) document.getElementById('toneMapping').value = c.toneMapping;
    if (c.exposure!=null) document.getElementById('exposure').value = c.exposure;
  }
  // Geodesics
  if (diff.geodesics) {
    const g = diff.geodesics;
    if (g.enable!=null) document.getElementById('geoEnable').checked = !!g.enable;
    if (g.method) document.getElementById('geoMethod').value = g.method;
    if (g.count!=null) document.getElementById('geoCount').value = g.count;
    if (g.width!=null) document.getElementById('geoWidth').value = g.width;
    if (g.style) document.getElementById('geoStyle').value = (g.style==='solid'?'solid':'pattern');
    if (g.dash!=null) { const e=document.getElementById('geoDash'); if(e) e.value=g.dash; }
    if (g.gap!=null) { const e=document.getElementById('geoGap'); if(e) e.value=g.gap; }
    if (g.color) document.getElementById('geoColor').value = g.color;
    if (g.alpha!=null) document.getElementById('geoAlpha').value = g.alpha;
  }
  // Markers
  if (diff.markers) {
    const mk = diff.markers; if (mk.enable!=null) document.getElementById('markersEnable').checked = !!mk.enable;
    if (mk.shape) document.getElementById('markerShape').value = mk.shape;
    if (mk.size!=null) document.getElementById('markerSize').value = mk.size;
    if (mk.color) document.getElementById('markerColor').value = mk.color;
    if (mk.alpha!=null) document.getElementById('markerAlpha').value = mk.alpha;
    if (mk.outline!=null) { const e=document.getElementById('markerOutline'); if (e) e.value = mk.outline; markerLayer.setDefaultOutline(parseFloat(e.value)); }
    if (mk.outlineColor) { const e=document.getElementById('markerOutlineColor'); if (e) e.value = mk.outlineColor; markerLayer.setDefaultOutlineColor(e.value); }
    if ('items' in mk) {
      markerLayer.clear();
      if (Array.isArray(mk.items)) {
        for (const it of mk.items) {
          const p = new THREE.Vector3(it.x||0, it.y||0, it.z||0);
          markerLayer.addMarker(p, { shape: it.shape||'circle', size: it.size||24, color: it.color||'#e53935', alpha: it.alpha==null?1:it.alpha, outline: it.outline, outlineColor: it.outlineColor });
        }
      }
    }
  }
  // Lighting
  if (diff.lighting) {
    const l = diff.lighting;
    if (l.amb!=null) document.getElementById('ambIntensity').value = l.amb;
    if (l.hemi!=null) document.getElementById('hemiIntensity').value = l.hemi;
    if (l.dir!=null) document.getElementById('dirIntensity').value = l.dir;
  }
  if (diff.export) {
    if (diff.export.pngScale!=null) {
      const e=document.getElementById('pngScale'); if (e) e.value = diff.export.pngScale;
    }
    if (diff.export.autoCrop!=null) {
      const e=document.getElementById('pngAutoCrop'); if (e) e.checked = !!diff.export.autoCrop;
    }
  }
  // Wireframe
  if (diff.wireframe!=null) document.getElementById('wireframe').checked = !!diff.wireframe;

  // Apply all
  updateBackground();
  regenerateSurface();
  updateColors();
  updateClip();
  rebuildGeodesics();
  rebuildBoundaryLines();
  applyRendererSettings();
  applyMaterialSettings();
  // Finally, apply the current surface offset to the newly built mesh
  const curS = (typeof getActiveSurface==='function') ? getActiveSurface() : null;
  if (surfaceGroup && curS && curS.offset) {
    surfaceGroup.position.set(curS.offset.x||0, curS.offset.y||0, curS.offset.z||0);
  }

  // Restore vectors/uvpaths
  if (diff.vectors) {
    document.getElementById('vecColor').value = diff.vectors.color || '#000000';
    if (diff.vectors.width!=null) document.getElementById('vecWidth').value = diff.vectors.width;
    if (diff.vectors.style) document.getElementById('vecStyle').value = (diff.vectors.style==='solid'?'solid':'pattern');
    if (diff.vectors.dash!=null) document.getElementById('vecDash').value = diff.vectors.dash;
    if (diff.vectors.gap!=null) document.getElementById('vecGap').value = diff.vectors.gap;
    const curSurf = (typeof getActiveSurface==='function') ? getActiveSurface() : null;
    if (curSurf && Array.isArray(curSurf.vectorItems)) { curSurf.vectorItems.forEach(it=>{ try{ it.obj?.parent?.remove(it.obj); it.cone?.parent?.remove(it.cone);}catch{} }); curSurf.vectorItems = []; }
    vectorItems = (curSurf && curSurf.vectorItems) ? curSurf.vectorItems : [];
    if (Array.isArray(diff.vectors.items)) {
      for (const it of diff.vectors.items) {
        if (it.color) document.getElementById('vecColor').value = it.color;
        if (it.width!=null) document.getElementById('vecWidth').value = it.width;
        if (it.style) document.getElementById('vecStyle').value = it.style;
        // items store local coordinates; convert to world for addVectorArrow()
        const aL = new THREE.Vector3(it.sx, it.sy, it.sz);
        const bL = new THREE.Vector3(it.ex, it.ey, it.ez);
        const aW = surfaceGroup ? surfaceGroup.localToWorld(aL.clone()) : aL;
        const bW = surfaceGroup ? surfaceGroup.localToWorld(bL.clone()) : bL;
        const a = { position: aW, uv: new THREE.Vector2() };
        const b = { position: bW, uv: new THREE.Vector2() };
        addVectorArrow(a,b);
      }
      // restore UI to cfg defaults
      document.getElementById('vecColor').value = diff.vectors.color || document.getElementById('vecColor').value;
      if (diff.vectors.width!=null) document.getElementById('vecWidth').value = diff.vectors.width;
      if (diff.vectors.style) document.getElementById('vecStyle').value = diff.vectors.style;
    }
  }
  if (diff.uvpaths) {
    document.getElementById('uvColor').value = diff.uvpaths.color || '#000000';
    if (diff.uvpaths.width!=null) document.getElementById('uvWidth').value = diff.uvpaths.width;
    if (diff.uvpaths.style) document.getElementById('uvStyle').value = (diff.uvpaths.style==='solid'?'solid':'pattern');
    if (diff.uvpaths.dash!=null) document.getElementById('uvDash').value = diff.uvpaths.dash;
    if (diff.uvpaths.gap!=null) document.getElementById('uvGap').value = diff.uvpaths.gap;
    const curSurf2 = (typeof getActiveSurface==='function') ? getActiveSurface() : null;
    if (curSurf2 && Array.isArray(curSurf2.uvItems)) { curSurf2.uvItems.forEach(it=>{ try{ it.obj?.parent?.remove(it.obj);}catch{} }); curSurf2.uvItems = []; }
    uvItems = (curSurf2 && curSurf2.uvItems) ? curSurf2.uvItems : [];
    if (Array.isArray(diff.uvpaths.items)) {
      for (const it of diff.uvpaths.items) {
        if (it.color) document.getElementById('uvColor').value = it.color;
        if (it.width!=null) document.getElementById('uvWidth').value = it.width;
        if (it.style) document.getElementById('uvStyle').value = it.style;
        const a = { position: new THREE.Vector3(), uv: new THREE.Vector2(it.su, it.sv) };
        const b = { position: new THREE.Vector3(), uv: new THREE.Vector2(it.eu, it.ev) };
        addUVLinePath(a,b);
      }
      document.getElementById('uvColor').value = diff.uvpaths.color || document.getElementById('uvColor').value;
      if (diff.uvpaths.width!=null) document.getElementById('uvWidth').value = diff.uvpaths.width;
      if (diff.uvpaths.style) document.getElementById('uvStyle').value = diff.uvpaths.style;
    }
  }
}






















