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
  const arr = new Float32Array(loop.length*3);
  let k=0; for (const p of loop) { arr[k++]=p[0]; arr[k++]=p[1]; arr[k++]=p[2]; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr,3));
  return geo;
}

