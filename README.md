# manifold-surface-generator

An interactive Three.js tool to generate and render manifold-like surfaces suitable for paper figures. It includes a scrollable overlay control panel, screenshot capture, 3D export (GLTF/OBJ), customizable color gradients, geodesic rendering, and screen-space markers.

Quick start
- Open `index.html` in a modern browser (Chrome/Edge/Firefox). No build step.
- All dependencies are loaded from CDN.

Features
- Parametric surface presets: Ripple, Saddle, Paraboloid, Swiss Roll, Bumps, Interference Waves, Ridged Sheet, Mountains, Gyroid; adjustable resolution and per‑preset parameters (UI shows only relevant sliders).
- Colors: solid or N-stop gradient along U/V/height; alpha controls (surface opacity, geodesic/marker/background alpha).
- Geodesics: iso-grid, param-straight rays, interactive edge-shortest path; dashed/solid/dotted styles with color control.
- Markers: 2D overlay markers (triangle/square/pentagon/circle) with size/color; click to place; toggle and clear.
- Export: Save PNG, Export GLB/GLTF, Export OBJ; Reset camera.

References are in `references/`.
