import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class MarkerLayer {
  constructor(container) {
    this.container = container; // DOM overlay container
    this.markers = []; // { position, el, svg, shapeEl, ... }
    this.visible = true;
    this.outline = 3; // px
    this.outlineColor = '#ffffff';
  }

  addMarker(position, { shape='circle', size=14, color='#e53935', alpha=1, outline, outlineColor }={}) {
    const wrap = document.createElement('div');
    wrap.className = 'marker';
    wrap.style.width = `${size}px`; wrap.style.height = `${size}px`;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', `${size}`);
    svg.setAttribute('height', `${size}`);
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

    const ow = (outline != null) ? outline : this.outline;
    const oc = outlineColor || this.outlineColor || '#ffffff';
    let shapeEl;
    if (shape === 'circle') {
      shapeEl = document.createElementNS(SVG_NS, 'circle');
      const r = (size/2) - Math.max(1, ow);
      shapeEl.setAttribute('cx', `${size/2}`);
      shapeEl.setAttribute('cy', `${size/2}`);
      shapeEl.setAttribute('r', `${Math.max(1, r)}`);
    } else if (shape === 'square') {
      const m = Math.max(1, ow);
      shapeEl = document.createElementNS(SVG_NS, 'rect');
      shapeEl.setAttribute('x', `${m}`);
      shapeEl.setAttribute('y', `${m}`);
      shapeEl.setAttribute('width', `${size-2*m}`);
      shapeEl.setAttribute('height', `${size-2*m}`);
      shapeEl.setAttribute('rx', '2');
    } else {
      // triangle or pentagon
      const n = (shape === 'triangle') ? 3 : 5;
      const pts = regularPolygonPoints(n, size, ow, (shape === 'triangle') ? -Math.PI/2 : -Math.PI/2);
      shapeEl = document.createElementNS(SVG_NS, 'polygon');
      shapeEl.setAttribute('points', pts.map(p => p.join(',')).join(' '));
    }
    shapeEl.setAttribute('fill', hexToRgba(color, alpha));
    shapeEl.setAttribute('stroke', oc);
    shapeEl.setAttribute('stroke-linejoin', 'round');
    shapeEl.setAttribute('stroke-linecap', 'round');
    shapeEl.setAttribute('stroke-width', `${ow}`);

    svg.appendChild(shapeEl);
    wrap.appendChild(svg);
    this.container.appendChild(wrap);
    this.markers.push({ position: position.clone(), el: wrap, svg, shapeEl, size, color, alpha, shape, outline: ow, outlineColor: oc, sx:0, sy:0 });
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
    for (const m of this.markers) { m.alpha = alpha; m.shapeEl.setAttribute('fill', hexToRgba(m.color, alpha)); }
  }

  setDefaultOutline(px) { this.outline = Math.max(0, px); }

  setDefaultOutlineColor(hex) { this.outlineColor = hex || '#ffffff'; }
}

function regularPolygonPoints(n, size, margin=0, rotation=0) {
  const cx = size/2, cy = size/2; const r = (size/2) - Math.max(1, margin);
  const pts = [];
  for (let i=0;i<n;i++) {
    const a = rotation + i*(2*Math.PI/n);
    pts.push([cx + r*Math.cos(a), cy + r*Math.sin(a)]);
  }
  return pts;
}

function hexToRgba(hex, a=1) {
  const h = hex.replace('#','');
  const r = parseInt(h.substring(0,2),16);
  const g = parseInt(h.substring(2,4),16);
  const b = parseInt(h.substring(4,6),16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
