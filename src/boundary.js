import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// Build closed boundary polylines of the clip shape intersecting the surface mesh.
// Returns an array of BufferGeometries (polyline paths in local space of the mesh).
export function buildClipBoundary(state, clip) {
  if (!clip || clip.mode === 'none') return [];
  const scale = state.params.scale || 1;
  const w = ((clip.rectW ?? 1) * 0.5) * scale;
  const h = ((clip.rectH ?? 1) * 0.5) * scale;
  const r = (clip.radius ?? 1) * scale;
  const sdf = (clip.mode === 'rect')
    ? (x,z)=>Math.max(Math.abs(x)-w, Math.abs(z)-h)
    : (x,z)=>Math.hypot(x,z)-r;
  if (clip.mode === 'rect') {
    const geos = rectPlanesBoundary(state, w, h);
    if (geos.length) return geos;
  }
  const geos = marchingGridBoundary(state, sdf);
  if (geos.length) return geos;
  return triangulatedBoundary(state, sdf);
}

function triangulatedBoundary(state, sdf){
  const pos = state.geometry.attributes.position;
  const idx = state.geometry.index;
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
      if (Math.abs(denom) < 1e-10) continue;
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

// Super-sampled marching-squares in UV domain; factor>1 increases samples per cell
export function buildClipBoundarySuper(state, clip, factor=1){
  if (!clip || clip.mode==='none') return [];
  const scale = state.params.scale || 1;
  const w = ((clip.rectW ?? 1) * 0.5) * scale;
  const h = ((clip.rectH ?? 1) * 0.5) * scale;
  const r = (clip.radius ?? 1) * scale;
  const sdf = (clip.mode==='rect') ? (x,z)=>Math.max(Math.abs(x)-w, Math.abs(z)-h) : (x,z)=>Math.hypot(x,z)-r;
  factor = Math.max(1, Math.floor(factor));

  const { resU, resV } = state; const U = resU*factor, V = resV*factor;
  const posAttr = state.geometry.attributes.position;
  function sampleAtUV(u,v){
    const i = u*resU, j = v*resV; const i0=Math.floor(i), j0=Math.floor(j); const i1=Math.min(resU,i0+1), j1=Math.min(resV,j0+1);
    const fu = i - i0, fv = j - j0; const idx=(ii,jj)=> jj*(resU+1)+ii;
    const p00={x:posAttr.getX(idx(i0,j0)), y:posAttr.getY(idx(i0,j0)), z:posAttr.getZ(idx(i0,j0))};
    const p10={x:posAttr.getX(idx(i1,j0)), y:posAttr.getY(idx(i1,j0)), z:posAttr.getZ(idx(i1,j0))};
    const p01={x:posAttr.getX(idx(i0,j1)), y:posAttr.getY(idx(i0,j1)), z:posAttr.getZ(idx(i0,j1))};
    const p11={x:posAttr.getX(idx(i1,j1)), y:posAttr.getY(idx(i1,j1)), z:posAttr.getZ(idx(i1,j1))};
    const a={x:p00.x+(p10.x-p00.x)*fu, y:p00.y+(p10.y-p00.y)*fu, z:p00.z+(p10.z-p00.z)*fu};
    const b={x:p01.x+(p11.x-p01.x)*fu, y:p01.y+(p11.y-p01.y)*fu, z:p01.z+(p11.z-p01.z)*fu};
    return { x:a.x+(b.x-a.x)*fv, y:a.y+(b.y-a.y)*fv, z:a.z+(b.z-a.z)*fv };
  }
  const segs=[]; const eps=1e-12;
  function cross(a,b,fa,fb){ const d=fb-fa; const t = Math.abs(d)<eps?0:(-fa/d); return { x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, z:a.z+(b.z-a.z)*t } }
  for (let j=0;j<V;j++){
    for (let i=0;i<U;i++){
      const u0=i/U, v0=j/V, u1=(i+1)/U, v1=(j+1)/V;
      const p00=sampleAtUV(u0,v0), p10=sampleAtUV(u1,v0), p11=sampleAtUV(u1,v1), p01=sampleAtUV(u0,v1);
      const f00=sdf(p00.x,p00.z), f10=sdf(p10.x,p10.z), f11=sdf(p11.x,p11.z), f01=sdf(p01.x,p01.z);
      const s00=f00<=0, s10=f10<=0, s11=f11<=0, s01=f01<=0; const crossings=[];
      if (s00!==s10) crossings.push(cross(p00,p10,f00,f10));
      if (s10!==s11) crossings.push(cross(p10,p11,f10,f11));
      if (s11!==s01) crossings.push(cross(p11,p01,f11,f01));
      if (s01!==s00) crossings.push(cross(p01,p00,f01,f00));
      if (crossings.length===2){ segs.push([[crossings[0].x,crossings[0].y,crossings[0].z],[crossings[1].x,crossings[1].y,crossings[1].z]]); }
      else if (crossings.length===4){ segs.push([[crossings[0].x,crossings[0].y,crossings[0].z],[crossings[1].x,crossings[1].y,crossings[1].z]]); segs.push([[crossings[2].x,crossings[2].y,crossings[2].z],[crossings[3].x,crossings[3].y,crossings[3].z]]); }
    }
  }
  const loops = joinSegments(segs);
  return loops.map(loop=>polylineToGeometry(loop));
}

// Robust rectangular boundary using grid crossings (avoids corner gaps)
function buildRectBoundaryGrid(state, w, h) {
  const { resU, resV } = state;
  const pos = state.geometry.attributes.position;
  const get = (i,j)=>{
    const idx = j*(resU+1)+i; return { x: pos.getX(idx), y: pos.getY(idx), z: pos.getZ(idx) };
  };
  const eps = 1e-6, epsInside = 1e-3;
  function interp(a,b,t){ return { x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, z:a.z+(b.z-a.z)*t }; }

  // helper: crossing along row j for plane x = target, only if |z|<=h
  function crossRowX(j, target){
    let last = get(0,j); let lastv = last.x - target;
    for (let i=1;i<=resU;i++){
      const cur = get(i,j); const curv = cur.x - target;
      if ((lastv<=0 && curv>=0) || (lastv>=0 && curv<=0)){
        const denom = (curv - lastv);
        const t = Math.abs(denom) < eps ? 0 : (-lastv / denom);
        const p = interp(last, cur, t);
        if (Math.abs(p.z) <= h + epsInside) return p;
      }
      last = cur; lastv = curv;
    }
    return null;
  }
  // helper: crossing along column i for plane z = target, only if |x|<=w
  function crossColZ(i, target){
    let last = get(i,0); let lastv = last.z - target;
    for (let j=1;j<=resV;j++){
      const cur = get(i,j); const curv = cur.z - target;
      if ((lastv<=0 && curv>=0) || (lastv>=0 && curv<=0)){
        const denom = (curv - lastv);
        const t = Math.abs(denom) < eps ? 0 : (-lastv / denom);
        const p = interp(last, cur, t);
        if (Math.abs(p.x) <= w + epsInside) return p;
      }
      last = cur; lastv = curv;
    }
    return null;
  }

  const bottom=[], right=[], top=[], left=[];
  for (let i=0;i<=resU;i++){ const p=crossColZ(i,-h); if (p) bottom.push(p); }
  for (let j=0;j<=resV;j++){ const p=crossRowX(j, +w); if (p) right.push(p); }
  for (let i=resU;i>=0;i--){ const p=crossColZ(i,+h); if (p) top.push(p); }
  for (let j=resV;j>=0;j--){ const p=crossRowX(j, -w); if (p) left.push(p); }

  const loop=[...bottom, ...right, ...top, ...left];
  return polylineToGeometry(loop);
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
  const sdf = sdfForClip(state, clip);

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

// Return SDF(x,z) for the given clip shape in local space
export function sdfForClip(state, clip) {
  if (!clip || clip.mode === 'none') return (x,z)=>-1; // always inside
  const scale = state.params.scale || 1;
  const w = ((clip.rectW ?? 1) * 0.5) * scale;
  const h = ((clip.rectH ?? 1) * 0.5) * scale;
  const r = (clip.radius ?? 1) * scale;
  if (clip.mode === 'rect') return (x,z)=>Math.max(Math.abs(x)-w, Math.abs(z)-h);
  return (x,z)=>Math.hypot(x,z)-r;
}

// Estimate the param spans [u0,u1], [v0,v1] of the mask using the center row/column
export function estimateParamSpans(state, clip) {
  const { resU, resV } = state;
  if (!clip || clip.mode === 'none') return { u:[0,1], v:[0,1] };
  const pos = state.geometry.attributes.position;
  const sdf = sdfForClip(state, clip);

  function spanAlongU() {
    const j0 = Math.round(resV/2);
    const idx = (i)=> j0*(resU+1)+i;
    let sPrev = sdf(pos.getX(idx(0)), pos.getZ(idx(0)));
    let inside = sPrev <= 0; let u0 = null, u1 = null;
    for (let i=0;i<resU;i++) {
      const s0 = sPrev; const s1 = sdf(pos.getX(idx(i+1)), pos.getZ(idx(i+1)));
      if (!inside && s1 <= 0) { // outside -> inside
        const t = s0 / (s0 - s1 + 1e-12); u0 = (i + t) / resU; inside = true;
      }
      if (inside && s1 > 0) { // inside -> outside
        const t = s0 / (s0 - s1 + 1e-12); u1 = (i + t) / resU; inside = false; break;
      }
      sPrev = s1;
    }
    if (inside) u1 = 1; // until end
    if (u0 === null) return [0,1];
    return [Math.max(0,u0), Math.min(1,u1 ?? 1)];
  }

  function spanAlongV() {
    const i0 = Math.round(resU/2);
    const idx = (j)=> j*(resU+1)+i0;
    let sPrev = sdf(pos.getX(idx(0)), pos.getZ(idx(0)));
    let inside = sPrev <= 0; let v0 = null, v1 = null;
    for (let j=0;j<resV;j++) {
      const s0 = sPrev; const s1 = sdf(pos.getX(idx(j+1)), pos.getZ(idx(j+1)));
      if (!inside && s1 <= 0) { const t = s0/(s0 - s1 + 1e-12); v0 = (j + t) / resV; inside = true; }
      if (inside && s1 > 0) { const t = s0/(s0 - s1 + 1e-12); v1 = (j + t) / resV; inside = false; break; }
      sPrev = s1;
    }
    if (inside) v1 = 1;
    if (v0 === null) return [0,1];
    return [Math.max(0,v0), Math.min(1,v1 ?? 1)];
  }

  return { u: spanAlongU(), v: spanAlongV() };
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

// Build four sides independently by intersecting triangles with planes x = ±w, z = ±h
function rectPlanesBoundary(state, w, h){
  const pos = state.geometry.attributes.position;
  const idx = state.geometry.index;
  const aCount = idx ? idx.count : pos.count;
  const getIndex = (i) => idx ? idx.getX(i) : i;

  function collectForPlane(kind){
    const segs=[]; const eps=1e-8;
    const side = (p)=>{
      if (kind==='xp') return p.x - w;
      if (kind==='xn') return p.x + w;
      if (kind==='zp') return p.z - h;
      return p.z + h;
    };
    const inRange = (p)=> (Math.abs(p.z) <= h+1e-3 && Math.abs(p.x) <= w+1e-3);
    for (let t=0;t<aCount;t+=3){
      const ia=getIndex(t), ib=getIndex(t+1), ic=getIndex(t+2);
      const A={ x:pos.getX(ia), y:pos.getY(ia), z:pos.getZ(ia) };
      const B={ x:pos.getX(ib), y:pos.getY(ib), z:pos.getZ(ib) };
      const C={ x:pos.getX(ic), y:pos.getY(ic), z:pos.getZ(ic) };
      const fA=side(A), fB=side(B), fC=side(C);
      const P=[[A,fA],[B,fB],[C,fC]]; const edges=[[0,1],[1,2],[2,0]]; const pts=[];
    for (const [i,j] of edges){
      const a=P[i][0], b=P[j][0]; const fa=P[i][1], fb=P[j][1];
      if ((fa<=0 && fb>=0) || (fa>=0 && fb<=0)){
        const d = fb-fa; const t = Math.abs(d)<eps ? 0 : (-fa/d);
        const p={ x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, z:a.z+(b.z-a.z)*t };
          if (inRange(p)) pts.push([p.x,p.y,p.z]);
      }
    }
      if (pts.length===2) segs.push([pts[0], pts[1]]);
    }
    const loops = joinSegments(segs);
    return loops.map(loop=>polylineToGeometry(loop));
  }

  return [
    ...collectForPlane('xp'),
    ...collectForPlane('xn'),
    ...collectForPlane('zp'),
    ...collectForPlane('zn'),
  ];
}

// Marching-squares on UV grid using SDF(x,z) to build boundary
function marchingGridBoundary(state, sdf){
  const { resU, resV } = state; const pos = state.geometry.attributes.position;
  const P = (i,j)=>({ x: pos.getX(j*(resU+1)+i), y: pos.getY(j*(resU+1)+i), z: pos.getZ(j*(resU+1)+i) });
  const F = (p)=>sdf(p.x,p.z);
  const segs=[]; const eps=1e-12;
  function lerp(a,b,t){ return { x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, z:a.z+(b.z-a.z)*t } }
  function cross(a,b,fa,fb){ const d=fb-fa; const t = Math.abs(d)<eps?0: (-fa/d); return lerp(a,b,t); }
  for (let j=0;j<resV;j++){
    for (let i=0;i<resU;i++){
      const p00=P(i,j), p10=P(i+1,j), p11=P(i+1,j+1), p01=P(i,j+1);
      const f00=F(p00), f10=F(p10), f11=F(p11), f01=F(p01);
      const s00=f00<=0, s10=f10<=0, s11=f11<=0, s01=f01<=0;
      const crossings=[];
      if (s00!==s10) crossings.push(cross(p00,p10,f00,f10)); // bottom
      if (s10!==s11) crossings.push(cross(p10,p11,f10,f11)); // right
      if (s11!==s01) crossings.push(cross(p11,p01,f11,f01)); // top
      if (s01!==s00) crossings.push(cross(p01,p00,f01,f00)); // left
      if (crossings.length===2){ segs.push([[crossings[0].x,crossings[0].y,crossings[0].z],[crossings[1].x,crossings[1].y,crossings[1].z]]); }
      else if (crossings.length===4){ // ambiguous: split into two pairs
        segs.push([[crossings[0].x,crossings[0].y,crossings[0].z],[crossings[1].x,crossings[1].y,crossings[1].z]]);
        segs.push([[crossings[2].x,crossings[2].y,crossings[2].z],[crossings[3].x,crossings[3].y,crossings[3].z]]);
      }
    }
  }
  const loops = joinSegments(segs);
  return loops.map(loop=>polylineToGeometry(loop));
}
