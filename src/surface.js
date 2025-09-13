import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

export const SurfaceParamsPresets = {
  ripple: { type: 'ripple', resU: 80, resV: 60, scale: 1, amplitude: 0.4, frequency: 2.5, noise: 0.05 },
  saddle: { type: 'saddle', resU: 80, resV: 60, scale: 1, amplitude: 0.5, frequency: 1.5, noise: 0.0 },
  paraboloid: { type: 'paraboloid', resU: 80, resV: 60, scale: 1, amplitude: 0.6, frequency: 1.0, noise: 0.0 },
  swiss: { type: 'swiss', resU: 150, resV: 40, scale: 1, amplitude: 0.4, frequency: 1.0, noise: 0.0 },
  bumps: { type: 'bumps', resU: 100, resV: 80, scale: 1, amplitude: 0.35, frequency: 2.0, noise: 0.05 },
};

function perlin2(x, y) { // tiny pseudo noise
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s);
}

function domain({ resU, resV }) {
  const us = new Float32Array((resU+1)*(resV+1));
  const vs = new Float32Array((resU+1)*(resV+1));
  let k = 0; for (let j=0;j<=resV;j++) for (let i=0;i<=resU;i++) { us[k]=i/resU; vs[k]=j/resV; k++; }
  return { us, vs };
}

function mapTo3D(p, u, v) {
  const { type, amplitude:a, frequency:f, noise:n, scale:s } = p;
  const x0 = (u-0.5)*2*s; const y0 = (v-0.5)*2*s;
  let x=x0, y=y0, z=0;
  if (type === 'ripple') {
    const r = Math.hypot(x0*1.1, y0*0.9);
    z = a * Math.sin(f * r + 0.5*Math.sin(2*y0)) + n*(perlin2(x0*3,y0*3)-0.5);
  } else if (type === 'saddle') {
    z = a * (x0*x0 - y0*y0);
  } else if (type === 'paraboloid') {
    z = a * (x0*x0 + y0*y0);
  } else if (type === 'bumps') {
    const b1 = Math.exp(-(x0*x0+y0*y0)*1.6);
    const b2 = Math.exp(-((x0-0.6)**2+(y0+0.2)**2)*6.0);
    const b3 = Math.exp(-((x0+0.2)**2+(y0-0.6)**2)*7.0);
    z = a*(0.7*b1 + 0.9*b2 + 0.6*b3 - 0.3);
  } else if (type === 'swiss') {
    const U = u * Math.PI * 3.5 + 0.3; // [0, ~11]
    const R = 0.8 + 0.15*U;
    x = R * Math.cos(U);
    y = R * Math.sin(U);
    z = (v - 0.5) * 1.2 + 0.15*Math.cos(2*U);
  }
  // add a mild boundary irregularity so the silhouette looks organic
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

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.0, roughness: 0.9, side: THREE.DoubleSide });
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

