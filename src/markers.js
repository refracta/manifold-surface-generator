import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

export class MarkerLayer {
  constructor(container) {
    this.container = container; // DOM overlay container
    this.markers = []; // { position: THREE.Vector3, el: HTMLElement }
    this.visible = true;
  }

  addMarker(position, { shape='circle', size=14, color='#e53935', alpha=1 }={}) {
    const el = document.createElement('div');
    el.className = `marker ${shape}`;
    el.style.width = `${size}px`; el.style.height = `${size}px`;
    el.style.background = hexToRgba(color, alpha);
    el.style.boxShadow = '0 0 0 1px #fff, 0 0 8px rgba(0,0,0,0.3)';
    this.container.appendChild(el);
    this.markers.push({ position: position.clone(), el, size, color, alpha });
  }

  clear() {
    for (const m of this.markers) m.el.remove();
    this.markers.length = 0;
  }

  update(camera, renderer) {
    const width = renderer.domElement.clientWidth, height = renderer.domElement.clientHeight;
    for (const m of this.markers) {
      const p = m.position.clone().project(camera);
      const x = (p.x * 0.5 + 0.5) * width;
      const y = ( -p.y * 0.5 + 0.5) * height;
      m.el.style.left = `${x}px`; m.el.style.top = `${y}px`;
      m.el.style.display = p.z < 1 ? 'block' : 'none';
    }
  }

  setVisible(v) {
    this.visible = v; this.container.style.display = v ? 'block' : 'none';
  }

  setAlpha(alpha) {
    for (const m of this.markers) { m.alpha = alpha; m.el.style.background = hexToRgba(m.color, alpha); }
  }
}

function hexToRgba(hex, a=1) {
  const h = hex.replace('#','');
  const r = parseInt(h.substring(0,2),16);
  const g = parseInt(h.substring(2,4),16);
  const b = parseInt(h.substring(4,6),16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
