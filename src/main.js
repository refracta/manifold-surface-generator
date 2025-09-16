import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'https://unpkg.com/three@0.160.0/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'https://unpkg.com/three@0.160.0/examples/jsm/exporters/OBJExporter.js';
import { Line2 } from 'https://unpkg.com/three@0.160.0/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'https://unpkg.com/three@0.160.0/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'https://unpkg.com/three@0.160.0/examples/jsm/lines/LineGeometry.js';

import { buildSurface, colorizeGeometry, SurfacePresets, createSurfaceParams, setClip, makeLineClippable, setLineClip, sampleSurfaceAtUV } from './surface.js';
import { buildIsoGrid, buildEdgeShortestPath, buildParamStraight } from './geodesic.js';
import { buildClipBoundary, buildDomainBoundary, clipPolylineToMask, estimateParamSpans } from './boundary.js';
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
controls.addEventListener('change', () => scheduleUpdateURL());
controls.addEventListener('end', () => scheduleUpdateURL());
renderer.domElement.addEventListener('wheel', () => scheduleUpdateURL(), { passive: true });

// Lights
const amb = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(amb);
const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.5);
hemi.position.set(0,1,0); scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(2, 3, 2);
scene.add(dir);

// State
let surfaceGroup = null; // contains mesh and optional lines
let surfaceState = null; // geometry bookkeeping
let geodesicGroup = new THREE.Group();
let clipLinesGroup = new THREE.Group();
let vectorGroup = new THREE.Group();
let uvPathGroup = new THREE.Group();
let vectorItems = [];
let uvItems = [];
scene.add(geodesicGroup);
scene.add(clipLinesGroup);
scene.add(vectorGroup);
scene.add(uvPathGroup);

let params = createSurfaceParams('ripple'); // start preset

function regenerateSurface() {
  if (surfaceGroup) scene.remove(surfaceGroup);
  const { group, state } = buildSurface(params);
  surfaceGroup = group;
  surfaceState = state;
  scene.add(surfaceGroup);
  updateClip();
  rebuildGeodesics();
  rebuildBoundaryLines();
  applyMaterialSettings();
}

function rebuildGeodesics() {
  geodesicGroup.clear();
  clipLinesGroup.clear();
  if (!document.getElementById('geoEnable').checked) return;
  const style = document.getElementById('geoStyle').value;
  const color = new THREE.Color(document.getElementById('geoColor').value);
  const alpha = parseFloat(document.getElementById('geoAlpha').value);
  const width = parseFloat(document.getElementById('geoWidth').value);
  const dash = parseFloat(document.getElementById('vecDash')?.value || '0.14');
  const gap = parseFloat(document.getElementById('vecGap')?.value || '0.06');
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
      geodesicGroup.add(line);
    }
  }
  // Boundary lines handled separately
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
  geodesicGroup.traverse(obj => {
    if (obj.material && obj.material.userData && obj.material.userData.clipUniforms) {
      setLineClip(obj.material, params.clip, params.scale);
    }
  });
  clipLinesGroup.traverse(obj => {
    if (obj.isLine2 || obj.isLine) {
      if (obj.material && obj.material.userData && obj.material.userData.clipUniforms) {
        setLineClip(obj.material, overlayClipParams(), params.scale, true);
      }
    }
  });
  // Regenerate geodesics so their polylines are CPU‑clipped to new mask
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

['clipLinesEnable','clipWidth','clipStyle','clipColor','clipAlpha'].forEach(id => {
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
    geodesicGroup.add(line);
  }
  pickedStart = pickedEnd = null; pickingStart = pickingEnd = false;
};
document.getElementById('clearGeodesics').onclick = () => { geodesicGroup.clear(); rebuildGeodesics(); };

// Vector tools state
let vecPickStart=false, vecPickEnd=false, vecStart=null, vecEnd=null;
const btnVecStart = document.getElementById('vecPickStart');
const btnVecEnd = document.getElementById('vecPickEnd');
btnVecStart.onclick=()=>{ if (vecPickStart) { vecPickStart=false; vecPickEnd=true; } else { vecPickStart=true; vecPickEnd=false; } updateToolButtons(); };
btnVecEnd.onclick=()=>{ if (vecPickEnd && vecStart && vecEnd) { addVectorArrow(vecStart, vecEnd); vecStart=vecEnd=null; markerLayer.clearTemps(); vecPickEnd=false; } else { vecPickEnd=true; vecPickStart=false; } updateToolButtons(); scheduleUpdateURL(); };
document.getElementById('addVector').onclick=()=>{
  if (!vecStart || !vecEnd) return;
  addVectorArrow(vecStart, vecEnd);
  vecStart=vecEnd=null; vecPickStart=vecPickEnd=false; markerLayer.clearTemps(); scheduleUpdateURL(); updateToolButtons();
};
document.getElementById('clearVectors').onclick=()=>{ vectorGroup.clear(); vectorItems=[]; scheduleUpdateURL(); };

let uvPickStart=false, uvPickEnd=false, uvStart=null, uvEnd=null;
const btnUVStart = document.getElementById('uvPickStart');
const btnUVEnd = document.getElementById('uvPickEnd');
btnUVStart.onclick=()=>{ if (uvPickStart) { uvPickStart=false; uvPickEnd=true; } else { uvPickStart=true; uvPickEnd=false; } updateToolButtons(); };
btnUVEnd.onclick=()=>{ if (uvPickEnd && uvStart && uvEnd) { addUVLinePath(uvStart, uvEnd); uvStart=uvEnd=null; markerLayer.clearTemps(); uvPickEnd=false; } else { uvPickEnd=true; uvPickStart=false; } updateToolButtons(); scheduleUpdateURL(); };
document.getElementById('addUVPath').onclick=()=>{
  if (!uvStart || !uvEnd) return;
  addUVLinePath(uvStart, uvEnd);
  uvStart=uvEnd=null; uvPickStart=uvPickEnd=false; markerLayer.clearTemps(); scheduleUpdateURL(); updateToolButtons();
};
document.getElementById('clearUVPaths').onclick=()=>{ uvPathGroup.clear(); uvItems = []; scheduleUpdateURL(); };

// Right-click: remove nearest marker
renderer.domElement.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const rect = renderer.domElement.getBoundingClientRect();
  const removed = markerLayer.removeNearestAt(ev.clientX - rect.left, ev.clientY - rect.top, 24);
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
document.getElementById('clearMarkers').onclick = () => { markerLayer.clear(); scheduleUpdateURL(); };
markersEnable.addEventListener('change', () => markerLayer.setVisible(markersEnable.checked));
markerAlpha.addEventListener('input', () => markerLayer.setAlpha(parseFloat(markerAlpha.value)));
markerOutline?.addEventListener('input', () => { markerLayer.setDefaultOutline(parseFloat(markerOutline.value)); scheduleUpdateURL(); });
markerOutlineColor?.addEventListener('input', () => { markerLayer.setDefaultOutlineColor(markerOutlineColor.value); scheduleUpdateURL(); });

// Export
document.getElementById('savePng').onclick = () => savePNG(parseFloat(document.getElementById('pngScale').value||'1'));
document.getElementById('exportGLB').onclick = () => exportGLB(surfaceGroup);
document.getElementById('exportOBJ').onclick = () => exportOBJ(surfaceGroup);
document.getElementById('resetCamera').onclick = () => { camera.position.copy(defaultCamPos); controls.target.set(0,0,0); controls.update(); };
document.getElementById('resetAll').onclick = () => {
  markerLayer.clear();
  camera.position.copy(defaultCamPos);
  controls.target.set(0,0,0); controls.update();
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
  const hit = raycaster.intersectObject(surfaceState.mesh, true)[0];
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
  if (markersEnable.checked) {
    markerLayer.addMarker(hit.point.clone(), {
      shape: markerShape.value,
      size: parseInt(markerSize.value, 10),
      color: markerColor.value,
      alpha: parseFloat(markerAlpha.value),
    });
    scheduleUpdateURL();
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
  const data = renderer.domElement.toDataURL('image/png');

  // Restore
  renderer.setPixelRatio(oldPR);
  renderer.setSize(oldSize.x, oldSize.y, false);
  setLineResolutions(oldSize.x, oldSize.y);
  renderOnce();

  const a = document.createElement('a'); a.href = data; a.download = `manifold_${w*scale}x${h*scale}.png`; a.click();
}

function setLineResolutions(w,h){
  [...geodesicGroup.children, ...clipLinesGroup.children, ...vectorGroup.children, ...uvPathGroup.children].forEach(obj => { if (obj.material && obj.material.resolution) obj.material.resolution.set(w,h); });
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

function removeNearestVectorOrUV(px, py){
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  const dist2 = (x,y,a,b,c,d)=>{ // point to segment distance squared
    const vx=c-a, vy=d-b; const wx=x-a, wy=y-b; const c1=vx*wx+vy*wy; if (c1<=0) return (x-a)**2+(y-b)**2; const c2=vx*vx+vy*vy; if (c2<=c1) return (x-c)**2+(y-d)**2; const t=c1/c2; const qx=a+t*vx, qy=b+t*vy; return (x-qx)**2+(y-qy)**2; };
  function screen(p){ const v=p.clone().project(camera); return {x:(v.x*0.5+0.5)*w, y:(-v.y*0.5+0.5)*h}; }
  let best={type:null,idx:-1,d:1e12};
  // vectors
  vectorItems.forEach((it,idx)=>{
    const a=screen(new THREE.Vector3(it.sx,it.sy,it.sz));
    const b=screen(new THREE.Vector3(it.ex,it.ey,it.ez));
    const d=dist2(px,py,a.x,a.y,b.x,b.y); if (d<best.d) best={type:'vec',idx,d};
  });
  // uv paths
  uvItems.forEach((it,idx)=>{
    const obj = it.obj; if (!obj) return; const pos = obj.geometry.getAttribute('position'); let dmin=1e12;
    for (let i=0;i<pos.count-1;i++){
      const p0=screen(new THREE.Vector3(pos.getX(i),pos.getY(i),pos.getZ(i)));
      const p1=screen(new THREE.Vector3(pos.getX(i+1),pos.getY(i+1),pos.getZ(i+1)));
      const d=dist2(px,py,p0.x,p0.y,p1.x,p1.y); if (d<dmin) dmin=d;
    }
    if (dmin<best.d) best={type:'uv',idx,d:dmin};
  });
  const thresh=12*12; if (best.d>thresh || best.idx<0) return false;
  if (best.type==='vec') {
    const it=vectorItems[best.idx]; if (it.obj) vectorGroup.remove(it.obj); if (it.cone) vectorGroup.remove(it.cone); vectorItems.splice(best.idx,1); return true;
  } else if (best.type==='uv') {
    const it=uvItems[best.idx]; if (it.obj) uvPathGroup.remove(it.obj); uvItems.splice(best.idx,1); return true;
  }
  return false;
}

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

// ---------------- URL state sync (save/load) ----------------
let urlTimer = null; // declare before first use to avoid TDZ
const DEFAULTS = snapshotConfig();
applyConfigFromURL();
scheduleUpdateURL();

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
      surfaceState.mesh.material = mat;
    } else { prev.opacity = op; prev.transparent = op < 1; }
  } else {
    if (!(prev && prev.isMeshStandardMaterial)) {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.0, roughness: 0.6, side: THREE.DoubleSide, transparent: op < 1, opacity: op });
      surfaceState.mesh.material = mat;
    } else { prev.opacity = op; prev.transparent = op < 1; }
    surfaceState.mesh.material.emissive = new THREE.Color(0xffffff);
    surfaceState.mesh.material.emissiveIntensity = emiss;
  }
}

// Build a vector arrow between two picked points (straight segment + cone head)
function addVectorArrow(startInfo, endInfo){
  const color = new THREE.Color(document.getElementById('vecColor').value);
  const width = parseFloat(document.getElementById('vecWidth').value);
  const style = document.getElementById('vecStyle').value;
  const dash = parseFloat(document.getElementById('geoDash')?.value || '0.14');
  const gap = parseFloat(document.getElementById('geoGap')?.value || '0.06');
  const positions = new Float32Array([
    startInfo.position.x, startInfo.position.y, startInfo.position.z,
    endInfo.position.x, endInfo.position.y, endInfo.position.z,
  ]);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
  const line = toLine2(geo, { style, color, alpha: 1, width, depthTest: true, dash, gap });
  vectorGroup.add(line);
  // Arrow head
  const dir = new THREE.Vector3().subVectors(endInfo.position, startInfo.position);
  const len = dir.length(); if (len > 1e-6){
    dir.normalize();
    const headLen = Math.max(0.02, 0.06 * len);
    const headRad = Math.max(0.01, 0.02 * len);
    const coneGeo = new THREE.ConeGeometry(headRad, headLen, 12);
    const coneMat = new THREE.MeshStandardMaterial({ color: color.getHex(), emissive: 0x000000, roughness: 0.5, metalness: 0.0 });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.copy(endInfo.position);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir.clone().normalize());
    cone.position.add(dir.clone().multiplyScalar(-headLen*0.5));
    vectorGroup.add(cone);
  }
  // save for cfg
  vectorItems.push({ sx: startInfo.position.x, sy: startInfo.position.y, sz: startInfo.position.z,
                     ex: endInfo.position.x, ey: endInfo.position.y, ez: endInfo.position.z,
                     color: '#' + color.getHexString(), width, style, obj: line, cone });
}

// Build a path that follows straight line in UV and maps to surface
function addUVLinePath(startInfo, endInfo){
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
  uvPathGroup.add(line);
  uvItems.push({ su: startInfo.uv.x, sv: startInfo.uv.y, eu: endInfo.uv.x, ev: endInfo.uv.y,
                 color: '#' + color.getHexString(), width, style, obj: line });
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
  clipLinesGroup.clear();
  if (!surfaceState) return;
  if (!document.getElementById('clipLinesEnable').checked) return;
  const style = document.getElementById('clipStyle').value;
  const color = new THREE.Color(document.getElementById('clipColor').value);
  const alpha = parseFloat(document.getElementById('clipAlpha').value);
  const width = parseFloat(document.getElementById('clipWidth').value);
  const dash = parseFloat(document.getElementById('clipDash')?.value || '0.14');
  const gap = parseFloat(document.getElementById('clipGap')?.value || '0.06');

  let boundaryGeos;
  if (params.clip && params.clip.mode !== 'none') {
    boundaryGeos = buildClipBoundary(surfaceState, params.clip);
  } else {
    boundaryGeos = buildDomainBoundary(surfaceState);
  }
  for (const g of boundaryGeos) {
    // Draw boundary as overlay to avoid z-fighting holes on solid style
    const line = toLine2(g, { style, color, alpha, width, depthTest: false, dash, gap, depthWrite: false, zOffset: 0 });
    clipLinesGroup.add(line);
  }
}

// Take a snapshot of current UI state and params
function snapshotConfig() {
  const cfg = { preset: params.type, resU: params.resU, resV: params.resV, scale: params.scale,
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
      alpha: parseFloat(document.getElementById('clipAlpha').value)
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
      items: markerLayer.markers.map(m => ({ x: m.position.x, y: m.position.y, z: m.position.z, shape: m.shape || 'circle', size: m.size, color: m.color, alpha: m.alpha, outline: m.outline, outlineColor: m.outlineColor }))
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

function updateURLFromState() {
  const cur = snapshotConfig();
  const diff = deepDiff(cur, DEFAULTS) || {};
  const sp = new URLSearchParams(window.location.search);
  if (Object.keys(diff).length === 0) {
    sp.delete('cfg');
  } else {
    sp.set('cfg', encodeURIComponent(JSON.stringify(diff)));
  }
  const url = window.location.pathname + (sp.toString() ? ('?' + sp.toString()) : '');
  window.history.replaceState({}, '', url);
}
function scheduleUpdateURL(){ if (urlTimer) clearTimeout(urlTimer); urlTimer=setTimeout(updateURLFromState, 200); }

function applyConfigFromURL() {
  const sp = new URLSearchParams(window.location.search);
  const raw = sp.get('cfg'); if (!raw) return;
  try { const diff = JSON.parse(decodeURIComponent(raw)); applyConfig(diff); } catch(e) { console.warn('Invalid cfg param', e); }
}

function applyConfig(diff) {
  if (!diff || typeof diff !== 'object') return;
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
    if (m.rectW!=null) document.getElementById('clipRectW').value = m.rectW;
    if (m.rectH!=null) document.getElementById('clipRectH').value = m.rectH;
    if (m.radius!=null) document.getElementById('clipRadius').value = m.radius;
    if (m.show!=null) document.getElementById('clipLinesEnable').checked = !!m.show;
    if (m.width!=null) document.getElementById('clipWidth').value = m.width;
    if (m.style) document.getElementById('clipStyle').value = m.style;
    if (m.dash!=null) { const e=document.getElementById('clipDash'); if(e) e.value=m.dash; }
    if (m.gap!=null) { const e=document.getElementById('clipGap'); if(e) e.value=m.gap; }
    if (m.color) document.getElementById('clipColor').value = m.color;
    if (m.alpha!=null) document.getElementById('clipAlpha').value = m.alpha;
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
    if (g.style) document.getElementById('geoStyle').value = g.style;
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

  // Restore vectors/uvpaths
  if (diff.vectors) {
    document.getElementById('vecColor').value = diff.vectors.color || '#000000';
    if (diff.vectors.width!=null) document.getElementById('vecWidth').value = diff.vectors.width;
    if (diff.vectors.style) document.getElementById('vecStyle').value = diff.vectors.style;
    if (diff.vectors.dash!=null) document.getElementById('vecDash').value = diff.vectors.dash;
    if (diff.vectors.gap!=null) document.getElementById('vecGap').value = diff.vectors.gap;
    vectorGroup.clear(); vectorItems = [];
    if (Array.isArray(diff.vectors.items)) {
      for (const it of diff.vectors.items) {
        if (it.color) document.getElementById('vecColor').value = it.color;
        if (it.width!=null) document.getElementById('vecWidth').value = it.width;
        if (it.style) document.getElementById('vecStyle').value = it.style;
        const a = { position: new THREE.Vector3(it.sx, it.sy, it.sz), uv: new THREE.Vector2() };
        const b = { position: new THREE.Vector3(it.ex, it.ey, it.ez), uv: new THREE.Vector2() };
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
    if (diff.uvpaths.style) document.getElementById('uvStyle').value = diff.uvpaths.style;
    if (diff.uvpaths.dash!=null) document.getElementById('uvDash').value = diff.uvpaths.dash;
    if (diff.uvpaths.gap!=null) document.getElementById('uvGap').value = diff.uvpaths.gap;
    uvPathGroup.clear(); uvItems = [];
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
