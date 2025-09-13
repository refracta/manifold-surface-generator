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
    // ensure outline appears for clip-path shapes as well
    el.style.filter = 'drop-shadow(0 0 0 white) drop-shadow(0 0 6px rgba(0,0,0,0.35))';
    this.container.appendChild(el);
    this.markers.push({ position: position.clone(), el, size, color, alpha, sx:0, sy:0 });
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
      m.sx = x; m.sy = y;
      m.el.style.display = p.z < 1 ? 'block' : 'none';
    }
  }

  removeNearestAt(clientX, clientY, maxDist=20) {
    if (!this.markers.length) return false;
    let best = -1, bestD = maxDist*maxDist;
    for (let i=0;i<this.markers.length;i++) {
      const m = this.markers[i];
      const dx = m.sx - clientX, dy = m.sy - clientY; const d = dx*dx + dy*dy;
      if (d <= bestD) { bestD = d; best = i; }
    }
    if (best >= 0) {
      this.markers[best].el.remove();
      this.markers.splice(best,1);
      return true;
    }
    return false;
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
