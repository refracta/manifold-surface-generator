import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// Preset definitions (only show relevant controls per preset)
export const SurfacePresets = {
  ripple: {
    defaults: { resU: 100, resV: 80, scale: 1, amplitude: 0.4, frequency: 2.5, noise: 0.05 },
    controls: [
      { key: 'amplitude', label: 'Amplitude', type: 'range', min: 0, max: 1.5, step: 0.01 },
      { key: 'frequency', label: 'Frequency', type: 'range', min: 0.2, max: 8, step: 0.1 },
      { key: 'noise', label: 'Noise', type: 'range', min: 0, max: 0.6, step: 0.01 },
    ]
  },
  saddle: {
    defaults: { resU: 100, resV: 80, scale: 1, amplitude: 0.5 },
    controls: [ { key: 'amplitude', label: 'Amplitude', type: 'range', min: 0, max: 2, step: 0.01 } ]
  },
  paraboloid: {
    defaults: { resU: 100, resV: 80, scale: 1, amplitude: 0.6 },
    controls: [ { key: 'amplitude', label: 'Curvature', type: 'range', min: -2, max: 2, step: 0.01 } ]
  },
  swiss: {
    defaults: { resU: 180, resV: 50, scale: 1, turns: 3.5, thickness: 1.2, waviness: 0.15 },
    controls: [
      { key: 'turns', label: 'Turns', type: 'range', min: 1, max: 6, step: 0.1 },
      { key: 'thickness', label: 'Thickness', type: 'range', min: 0.4, max: 2.0, step: 0.05 },
      { key: 'waviness', label: 'Waviness', type: 'range', min: 0, max: 0.5, step: 0.01 },
    ]
  },
  bumps: {
    defaults: { resU: 120, resV: 90, scale: 1, amplitude: 0.35, frequency: 2.0, noise: 0.05 },
    controls: [
      { key: 'amplitude', label: 'Amplitude', type: 'range', min: 0, max: 1.2, step: 0.01 },
      { key: 'frequency', label: 'Frequency', type: 'range', min: 0.2, max: 6, step: 0.1 },
      { key: 'noise', label: 'Noise', type: 'range', min: 0, max: 0.6, step: 0.01 },
    ]
  },
  interference: {
    defaults: { resU: 160, resV: 120, scale: 1, amp1: 0.35, amp2: 0.25, freqU: 3.0, freqV: 2.0, rotate: 0.4, warp: 0.18 },
    controls: [
      { key: 'amp1', label: 'Amp U', type: 'range', min: 0, max: 1.2, step: 0.01 },
      { key: 'amp2', label: 'Amp V', type: 'range', min: 0, max: 1.2, step: 0.01 },
      { key: 'freqU', label: 'Freq U', type: 'range', min: 0.2, max: 10, step: 0.1 },
      { key: 'freqV', label: 'Freq V', type: 'range', min: 0.2, max: 10, step: 0.1 },
      { key: 'rotate', label: 'Rotate', type: 'range', min: -1.57, max: 1.57, step: 0.01 },
      { key: 'warp', label: 'Warp', type: 'range', min: 0, max: 0.6, step: 0.01 },
    ]
  },
  ridged: {
    defaults: { resU: 150, resV: 110, scale: 1, amplitude: 0.6, frequency: 3.2, power: 1.3 },
    controls: [
      { key: 'amplitude', label: 'Amplitude', type: 'range', min: 0, max: 1.5, step: 0.01 },
      { key: 'frequency', label: 'Frequency', type: 'range', min: 0.5, max: 10, step: 0.1 },
      { key: 'power', label: 'Sharpness', type: 'range', min: 0.5, max: 4, step: 0.05 },
    ]
  },
  mountains: {
    defaults: { resU: 160, resV: 120, scale: 1, amplitude: 0.7, bumpCount: 8, sharpness: 5.0, seed: 3 },
    controls: [
      { key: 'bumpCount', label: 'Bumps', type: 'number', min: 1, max: 50, step: 1 },
      { key: 'amplitude', label: 'Amplitude', type: 'range', min: 0, max: 1.2, step: 0.01 },
      { key: 'sharpness', label: 'Sharpness', type: 'range', min: 1.0, max: 12.0, step: 0.1 },
      { key: 'seed', label: 'Seed', type: 'number', min: 0, max: 9999, step: 1 },
    ]
  },
  gyroid: {
    defaults: { resU: 150, resV: 120, scale: 1, amplitude: 0.35, frequency: 2.2, iso: 0.0 },
    controls: [
      { key: 'amplitude', label: 'Amplitude', type: 'range', min: 0, max: 1.2, step: 0.01 },
      { key: 'frequency', label: 'Frequency', type: 'range', min: 0.5, max: 8, step: 0.1 },
      { key: 'iso', label: 'Iso Level', type: 'range', min: -1, max: 1, step: 0.01 },
    ]
  }
};

export function createSurfaceParams(presetName) {
  const base = SurfacePresets[presetName]?.defaults || SurfacePresets.ripple.defaults;
  return { type: presetName, ...JSON.parse(JSON.stringify(base)) };
}

function perlin2(x, y) { // tiny pseudo noise
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s);
}

function seededRand(seed) { let t = seed >>> 0; return () => (t = (t * 1664525 + 1013904223) >>> 0) / 0xFFFFFFFF; }

function domain({ resU, resV }) {
  const us = new Float32Array((resU+1)*(resV+1));
  const vs = new Float32Array((resU+1)*(resV+1));
  let k = 0; for (let j=0;j<=resV;j++) for (let i=0;i<=resU;i++) { us[k]=i/resU; vs[k]=j/resV; k++; }
  return { us, vs };
}

function mapTo3D(p, u, v) {
  const s = p.scale ?? 1;
  const x0 = (u-0.5)*2*s; const y0 = (v-0.5)*2*s;
  let x=x0, y=y0, z=0;
  switch (p.type) {
    case 'ripple': {
      const a = p.amplitude ?? 0.4, f = p.frequency ?? 2.5, n = p.noise ?? 0.0;
      const r = Math.hypot(x0*1.1, y0*0.9);
      z = a * Math.sin(f * r + 0.5*Math.sin(2*y0)) + n*(perlin2(x0*3,y0*3)-0.5);
      break;
    }
    case 'saddle': {
      const a = p.amplitude ?? 0.5; z = a * (x0*x0 - y0*y0); break;
    }
    case 'paraboloid': {
      const a = p.amplitude ?? 0.6; z = a * (x0*x0 + y0*y0); break;
    }
    case 'bumps': {
      const a = p.amplitude ?? 0.35; const f = p.frequency ?? 2.0; const n = p.noise ?? 0.0;
      z = a*Math.sin(f*x0)*Math.sin(f*0.7*y0) + n*(perlin2(x0*4,y0*4)-0.5);
      break;
    }
    case 'swiss': {
      const turns = p.turns ?? 3.5; const thick = p.thickness ?? 1.2; const wav = p.waviness ?? 0.15;
      const U = u * Math.PI * turns + 0.3;
      const R = 0.8 + 0.15*U;
      x = R * Math.cos(U);
      y = R * Math.sin(U);
      z = (v - 0.5) * thick + wav*Math.cos(2*U);
      break;
    }
    case 'interference': {
      const { amp1=0.35, amp2=0.25, freqU=3.0, freqV=2.0, rotate=0.0, warp=0.0 } = p;
      const cx = Math.cos(rotate), sx = Math.sin(rotate);
      const xr = cx*x0 - sx*y0; const yr = sx*x0 + cx*y0;
      z = amp1*Math.sin(freqU*xr) + amp2*Math.sin(freqV*yr) + warp*Math.sin(2*xr+3*yr);
      break;
    }
    case 'ridged': {
      const { amplitude=0.6, frequency=3.0, power=1.3 } = p;
      const rid = Math.pow(Math.abs(Math.sin(frequency*x0)) + Math.abs(Math.sin(0.8*frequency*y0)), power);
      z = amplitude*(rid-0.8);
      break;
    }
    case 'mountains': {
      const { amplitude=0.7, bumpCount=8, sharpness=5.0, seed=3 } = p;
      const rnd = seededRand(seed);
      // precompute centers deterministically
      if (!p._centers || p._centers.length !== bumpCount) {
        p._centers = Array.from({length:bumpCount},()=>({ x:(rnd()*2-1)*s, y:(rnd()*2-1)*s, w: 0.5 + rnd()*0.8 }));
      }
      let h=0; for (const c of p._centers) { const dx=x0-c.x, dy=y0-c.y; h += c.w*Math.exp(-(dx*dx+dy*dy)*sharpness); }
      z = amplitude*(h - 0.5);
      break;
    }
    case 'gyroid': {
      const { amplitude=0.35, frequency=2.2, iso=0.0 } = p;
      // Use a thin slice of the gyroid implicit surface: sin x cos y + sin y cos z + sin z cos x = iso
      // We approximate height z from x,y by solving a simplified form.
      const gx = Math.sin(frequency*x0)*Math.cos(frequency*y0) + Math.sin(frequency*y0)*Math.cos(frequency*x0);
      z = amplitude*(gx - iso) + 0.15*Math.sin(0.7*frequency*x0+1.1*frequency*y0);
      break;
    }
  }
  // mild boundary irregularity so the silhouette looks organic
  const b = 0.04 * Math.sin(6*u) * Math.cos(5*v);
  return new THREE.Vector3(x*(1+b), z, y*(1-b));
}

export function buildSurface(p) {
  const { resU, resV } = p;
  const { us, vs } = domain(p);
  const positions = new Float32Array((resU+1)*(resV+1)*3);
  const uvs = new Float32Array((resU+1)*(resV+1)*2);
  const indices = [];

  let k=0, t=0;
  for (let j=0;j<=resV;j++) {
    for (let i=0;i<=resU;i++) {
      const u = us[t], v = vs[t];
      const pos = mapTo3D(p, u, v);
      positions[k+0]=pos.x; positions[k+1]=pos.y; positions[k+2]=pos.z; k+=3;
      uvs[(t*2)+0]=u; uvs[(t*2)+1]=v; t++;
    }
  }
  for (let j=0;j<resV;j++) {
    for (let i=0;i<resU;i++) {
      const a = j*(resU+1)+i;
      const b = a+1;
      const c = a+(resU+1);
      const d = c+1;
      indices.push(a,c,b, b,c,d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.0, roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 1 });
  const mesh = new THREE.Mesh(geometry, material);

  const group = new THREE.Group();
  group.add(mesh);

  colorizeGeometry(geometry, { mode: 'gradient', axis: 'u', stops: [ { t:0, color:'#a8c7ff' }, { t:1, color:'#ff9aa2' } ] });

  const state = {
    params: { ...p },
    geometry,
    mesh,
    resU, resV,
    us, vs,
  };
  return { group, state };
}

export function colorizeGeometry(geometry, options) {
  const positions = geometry.getAttribute('position');
  const uvs = geometry.getAttribute('uv');
  const count = positions.count;
  const colors = new Float32Array(count*3);
  const tmp = new THREE.Color();

  if (options.mode === 'solid') {
    tmp.set(options.color || '#cccccc');
    for (let i=0;i<count;i++) {
      colors[i*3+0]=tmp.r; colors[i*3+1]=tmp.g; colors[i*3+2]=tmp.b;
    }
  } else {
    const axis = options.axis || 'u';
    const stops = (options.stops && options.stops.length>=2) ? options.stops : [ {t:0,color:'#a8c7ff'},{t:1,color:'#ff9aa2'} ];
    const stopColors = stops.map(s => ({ t: s.t, c: new THREE.Color(s.color) }));
    function sample(t) {
      t = Math.min(1, Math.max(0, t));
      for (let i=0;i<stopColors.length-1;i++) {
        const a = stopColors[i], b = stopColors[i+1];
        if (t >= a.t && t <= b.t) {
          const k = (t - a.t) / (b.t - a.t + 1e-6);
          return a.c.clone().lerp(b.c, k);
        }
      }
      return stopColors[stopColors.length-1].c.clone();
    }
    for (let i=0;i<count;i++) {
      const u = uvs.getX(i), v = uvs.getY(i);
      let t = u;
      if (axis === 'v') t = v;
      else if (axis === 'height') { t = (positions.getY(i) + 1.2) / 2.4; }
      const c = sample(t);
      colors[i*3+0]=c.r; colors[i*3+1]=c.g; colors[i*3+2]=c.b;
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors,3));
  geometry.attributes.color.needsUpdate = true;
}
