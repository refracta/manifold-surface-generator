import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// Build closed boundary polylines of the clip shape intersecting the surface mesh.
// Returns an array of BufferGeometries (polyline paths in local space of the mesh).
export function buildClipBoundary(state, clip) {
  if (!clip || clip.mode === 'none') return [];
  const pos = state.geometry.attributes.position;
  const idx = state.geometry.index;
  const scale = state.params.scale || 1;
  const w = ((clip.rectW ?? 1) * 0.5) * scale;
  const h = ((clip.rectH ?? 1) * 0.5) * scale;
  const r = (clip.radius ?? 1) * scale;

  function sdfRect(x, z) { return Math.max(Math.abs(x) - w, Math.abs(z) - h); }
  function sdfCircle(x, z) { return Math.hypot(x, z) - r; }
  const sdf = clip.mode === 'rect' ? sdfRect : sdfCircle;

  const segs = [];
  const aCount = idx ? idx.count : (pos.count);
  const getIndex = (i) => idx ? idx.getX(i) : i;
  for (let t = 0; t < aCount; t += 3) {
    const ia = getIndex(t+0), ib = getIndex(t+1), ic = getIndex(t+2);
    const ax = pos.getX(ia), ay = pos.getY(ia), az = pos.getZ(ia);
    const bx = pos.getX(ib), by = pos.getY(ib), bz = pos.getZ(ib);
    const cx = pos.getX(ic), cy = pos.getY(ic), cz = pos.getZ(ic);
    const fa = sdf(ax, az), fb = sdf(bx, bz), fc = sdf(cx, cz);
    const s0 = Math.sign(fa), s1 = Math.sign(fb), s2 = Math.sign(fc);
    if ((s0>0 && s1>0 && s2>0) || (s0<0 && s1<0 && s2<0)) continue; // no crossing
    const P = [[ax,ay,az,fa],[bx,by,bz,fb],[cx,cy,cz,fc]];
    const edges = [[0,1],[1,2],[2,0]];
    const pts = [];
    for (const [i,j] of edges) {
      const a = P[i], b = P[j];
      const fa1 = a[3], fb1 = b[3];
      if ((fa1>0 && fb1>0) || (fa1<0 && fb1<0)) continue;
      const denom = (fa1 - fb1);
      if (Math.abs(denom) < 1e-8) continue;
      const t1 = fa1 / denom; // where F crosses 0
      if (t1 < -1e-6 || t1 > 1+1e-6) continue;
      const x = a[0] + (b[0]-a[0])*t1;
      const y = a[1] + (b[1]-a[1])*t1;
      const z = a[2] + (b[2]-a[2])*t1;
      pts.push([x,y,z]);
    }
    if (pts.length === 2) segs.push(pts);
  }

  const loops = joinSegments(segs);
  return loops.map(loop => polylineToGeometry(loop));
}

// Domain boundary (UV rectangle) mapped into 3D by existing vertices along the mesh outer ring
export function buildDomainBoundary(state) {
  const { resU, resV } = state;
  const pos = state.geometry.attributes.position;
  const pts = [];
  // top edge (j=0, i=0..resU)
  for (let i=0;i<=resU;i++) {
    const idx = 0*(resU+1) + i; pts.push([pos.getX(idx), pos.getY(idx), pos.getZ(idx)]);
  }
  // right edge (i=resU, j=1..resV)
  for (let j=1;j<=resV;j++) {
    const idx = j*(resU+1) + resU; pts.push([pos.getX(idx), pos.getY(idx), pos.getZ(idx)]);
  }
  // bottom edge (j=resV, i=resU-1..0)
  for (let i=resU-1;i>=0;i--) {
    const idx = resV*(resU+1) + i; pts.push([pos.getX(idx), pos.getY(idx), pos.getZ(idx)]);
  }
  // left edge (i=0, j=resV-1..1)
  for (let j=resV-1;j>=1;j--) {
    const idx = j*(resU+1); pts.push([pos.getX(idx), pos.getY(idx), pos.getZ(idx)]);
  }
  return [polylineToGeometry(pts)];
}

// Clip a single polyline (positions Float32Array [x,y,z,...]) to the inside of the given clip shape
// Returns an array of BufferGeometry segments (each is inside the region)
export function clipPolylineToMask(state, clip, positions) {
  if (!clip || clip.mode === 'none') {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions.slice ? positions.slice() : new Float32Array(positions), 3));
    return [g];
  }
  const scale = state.params.scale || 1;
  const w = ((clip.rectW ?? 1) * 0.5) * scale;
  const h = ((clip.rectH ?? 1) * 0.5) * scale;
  const r = (clip.radius ?? 1) * scale;

  function sdfRect(x, z) { return Math.max(Math.abs(x) - w, Math.abs(z) - h); }
  function sdfCircle(x, z) { return Math.hypot(x, z) - r; }
  const sdf = clip.mode === 'rect' ? sdfRect : sdfCircle;

  const N = positions.length / 3;
  const segments = [];
  let curr = [];
  function pushCurr() {
    if (curr.length >= 2) {
      const arr = new Float32Array(curr.length * 3);
      let k = 0; for (const p of curr) { arr[k++]=p[0]; arr[k++]=p[1]; arr[k++]=p[2]; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr,3));
      segments.push(g);
    }
    curr = [];
  }

  function P(i) { return [positions[i*3], positions[i*3+1], positions[i*3+2]]; }
  function F(p) { return sdf(p[0], p[2]); }

  for (let i=0;i<N-1;i++) {
    const a = P(i), b = P(i+1); const fa = F(a), fb = F(b);
    const aInside = fa <= 0, bInside = fb <= 0;
    if (aInside) {
      if (curr.length === 0) curr.push(a); else if (i===0) curr.push(a);
    }
    if (aInside !== bInside) {
      const t = fa / (fa - fb + 1e-12);
      const x = a[0] + (b[0]-a[0]) * t;
      const y = a[1] + (b[1]-a[1]) * t;
      const z = a[2] + (b[2]-a[2]) * t;
      const ip = [x,y,z];
      curr.push(ip);
      if (!bInside) { pushCurr(); }
      else { curr = [ip]; }
    } else if (bInside) {
      curr.push(b);
    }
  }
  pushCurr();
  return segments;
}

function joinSegments(segs) {
  const eps = 1e-3;
  const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`;
  const map = new Map();
  for (const [a,b] of segs) {
    const ka = key(a), kb = key(b);
    if (!map.has(ka)) map.set(ka, []); map.get(ka).push([a,b]);
    if (!map.has(kb)) map.set(kb, []); map.get(kb).push([b,a]);
  }
  const used = new Set();
  const loops = [];
  for (const [ka, list] of map.entries()) {
    for (const seg of list) {
      const segKey = JSON.stringify(seg);
      if (used.has(segKey)) continue;
      used.add(segKey);
      const path = [seg[0], seg[1]];
      let endKey = key(seg[1]);
      while (true) {
        const nextList = map.get(endKey) || [];
        let found = null;
        for (const s of nextList) {
          const k = JSON.stringify(s);
          if (!used.has(k)) { found = s; break; }
        }
        if (!found) break;
        used.add(JSON.stringify(found));
        path.push(found[1]);
        endKey = key(found[1]);
        if (key(path[0]) === endKey) break; // closed
      }
      loops.push(path);
    }
  }
  // Deduplicate loops by length and start key
  const uniq = [];
  const seen = new Set();
  for (const p of loops) {
    const k = `${p.length}:${p[0][0].toFixed(3)},${p[0][1].toFixed(3)},${p[0][2].toFixed(3)}`;
    if (!seen.has(k)) { seen.add(k); uniq.push(p); }
  }
  return uniq;
}

function polylineToGeometry(loop) {
  // ensure closed by repeating the first point at the end
  if (loop.length && (loop[0] !== loop[loop.length-1])) loop = [...loop, loop[0]];
  const arr = new Float32Array(loop.length*3);
  let k=0; for (const p of loop) { arr[k++]=p[0]; arr[k++]=p[1]; arr[k++]=p[2]; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr,3));
  return geo;
}
