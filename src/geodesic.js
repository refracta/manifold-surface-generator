import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// Build iso‑parameter grid lines as on‑surface polylines
export function buildIsoGrid(state, count = 8, span) {
  const { resU, resV, params } = state;
  const geos = [];
  const totU = count, totV = count;
  const u0 = span?.u ? span.u[0] : 0; const u1 = span?.u ? span.u[1] : 1;
  const v0 = span?.v ? span.v[0] : 0; const v1 = span?.v ? span.v[1] : 1;
  const usedI = new Set(); const usedJ = new Set();
  // u‑constant lines within [u0,u1]
  for (let k=1;k<=totU;k++) {
    const u = u0 + (k/(totU+1)) * (u1 - u0);
    const positions = [];
    const iIdx = Math.max(0, Math.min(resU, Math.round(u*resU)));
    if (usedI.has(iIdx)) continue; usedI.add(iIdx);
    for (let j=0;j<=resV;j++) {
      const idx = j*(resU+1) + iIdx;
      const x = state.geometry.attributes.position.getX(idx);
      const y = state.geometry.attributes.position.getY(idx);
      const z = state.geometry.attributes.position.getZ(idx);
      positions.push(x,y,z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    geos.push(geo);
  }
  // v‑constant lines within [v0,v1]
  for (let k=1;k<=totV;k++) {
    const v = v0 + (k/(totV+1)) * (v1 - v0);
    const positions = [];
    const jIdx = Math.max(0, Math.min(resV, Math.round(v*resV)));
    if (usedJ.has(jIdx)) continue; usedJ.add(jIdx);
    for (let i=0;i<=resU;i++) {
      const idx = jIdx*(resU+1) + i;
      const x = state.geometry.attributes.position.getX(idx);
      const y = state.geometry.attributes.position.getY(idx);
      const z = state.geometry.attributes.position.getZ(idx);
      positions.push(x,y,z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    geos.push(geo);
  }
  return geos;
}

// Build a path by walking straight in parameter space from center
export function buildParamStraight(state, count = 6, span) {
  const geos = [];
  const { resU, resV } = state;
  const centerU = span?.u ? (span.u[0]+span.u[1])/2 : 0.5;
  const centerV = span?.v ? (span.v[0]+span.v[1])/2 : 0.5;
  const centerI = Math.round(centerU*resU), centerJ = Math.round(centerV*resV);
  const dirs = [];
  for (let k=0;k<count;k++) {
    const a = (k / count) * Math.PI * 2;
    dirs.push([Math.cos(a), Math.sin(a)]);
  }
  for (const [du, dv] of dirs) {
    const positions = [];
    let u = centerI/(resU), v = centerJ/(resV);
    const steps = Math.max(resU,resV);
    for (let s=0;s<steps;s++) {
      const i = Math.max(0, Math.min(resU, Math.round(u*resU)));
      const j = Math.max(0, Math.min(resV, Math.round(v*resV)));
      const idx = j*(resU+1)+i;
      const x = state.geometry.attributes.position.getX(idx);
      const y = state.geometry.attributes.position.getY(idx);
      const z = state.geometry.attributes.position.getZ(idx);
      positions.push(x,y,z);
      u += du/steps; v += dv/steps;
      if (u<0||u>1||v<0||v>1) break;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    geos.push(geo);
  }
  return geos;
}

// Dijkstra shortest path on the grid graph between two picked points (nearest vertices)
export function buildEdgeShortestPath(state, startInfo, endInfo) {
  const { resU, resV } = state;
  const startIdx = nearestIndex(state, startInfo);
  const endIdx = nearestIndex(state, endInfo);
  const neighbors = (i) => {
    const res = []; const u = i % (resU+1); const v = Math.floor(i/(resU+1));
    function pushIf(ii) { if (ii>=0 && ii < (resU+1)*(resV+1)) res.push(ii); }
    pushIf(i-1); pushIf(i+1); pushIf(i-(resU+1)); pushIf(i+(resU+1));
    return res;
  };
  const pos = state.geometry.attributes.position;
  const N = (resU+1)*(resV+1);
  const dist = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const visited = new Uint8Array(N);
  dist[startIdx] = 0;
  for (;;) {
    let u=-1, best=Infinity; for (let i=0;i<N;i++) if (!visited[i] && dist[i]<best) { best=dist[i]; u=i; }
    if (u===-1 || u===endIdx) break; visited[u]=1;
    for (const v of neighbors(u)) {
      const dx = pos.getX(u)-pos.getX(v); const dy = pos.getY(u)-pos.getY(v); const dz = pos.getZ(u)-pos.getZ(v);
      const w = Math.hypot(dx, dy, dz);
      const alt = dist[u] + w;
      if (alt < dist[v]) { dist[v]=alt; prev[v]=u; }
    }
  }
  const path = [];
  for (let u=endIdx; u!==-1; u=prev[u]) path.push(u);
  path.reverse();
  const positions = [];
  for (const i of path) { positions.push(pos.getX(i), pos.getY(i), pos.getZ(i)); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
  return geo;
}

function nearestIndex(state, pick) {
  const { resU, resV } = state;
  const u = Math.max(0, Math.min(1, pick.uv.x));
  const v = Math.max(0, Math.min(1, pick.uv.y));
  const i = Math.round(u*resU), j = Math.round(v*resV);
  return j*(resU+1)+i;
}
