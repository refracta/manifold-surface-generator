Project: manifold-surface-generator

Purpose
- Render visually pleasing manifold-like surfaces for paper figures.
- Provide rich, scrollable overlay controls on the top‑right.
- Allow capture/export of the current view and the surface mesh.

References Observed (references/ref1–ref4)
- Surfaces are smooth 2D manifolds embedded in 3D with gentle waves.
- Figures show shaded patches, grid-like geodesic lines, and markers.
- Geodesics appear as iso-parameter grids and shortest/curved paths.
- Markers overlay the view (screen‑space), not occluded by the mesh.

MVP Goals
- Three.js scene that renders a parametric surface patch (UV domain → 3D).
- Overlay control panel (fixed top‑right) that grows and becomes scrollable.
- Adjustable background color and surface colors (solid and N‑stop gradient).
- Camera: orbit controls, lighting, and optional wireframe.
- Screenshot capture (PNG download) of the current render.
- Mesh export (GLB/GLTF and OBJ at minimum).

Extended Goals
- Custom screen‑space markers (triangle, square, pentagon, circle):
  - Click on surface to place; configurable size/color; toggle visibility.
- Geodesic rendering on the surface with options:
  - Grid (iso‑u / iso‑v) lines.
  - Edge‑shortest path between user‑selected points (mesh Dijkstra).
  - Tangent‑step integrator from a seed and direction (approx. geodesic).
  - Line styles: solid, dashed, dotted; color and thickness controls.
  - Toggle visibility per layer.

Controls (initial set)
- Surface presets: ripple, saddle, paraboloid, Swiss‑roll, blended bump.
- Resolution (u×v), scale, wave amplitude/frequency, noise amount/seed.
- Color mode: solid or gradient; gradient stops editor (add/remove, position).
- Geodesic options: method, count, spacing/length, style, and color.
- Markers: enable/disable, shape, size, color, clear‑all.
- Export: Save PNG, Export GLB/GLTF/OBJ, Reset camera.

Code & Structure
- Plain ES modules, no bundler; import three.js and examples from CDN.
- Files:
  - index.html — entry and UI shell.
  - src/main.js — scene setup, render loop, controls wiring.
  - src/surface.js — parametric surface generator + color application.
  - src/geodesic.js — grid/shortest‑path/tangent‑step algorithms.
  - src/markers.js — screen‑space markers management.
  - styles.css — layout and control panel styling.

Style
- Keep functions small and focused; avoid global state leakage.
- Prefer descriptive names; no one‑letter variables.
- Comment only where non‑obvious (math/algorithms and data flows).

Testing/Validation
- Manual: verify UI behavior, color pickers, exports, and markers.
- Visual: compare to reference figures (grid on a wavy patch, dashed lines).

