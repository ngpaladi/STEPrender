# STEP/STL Viewer

A frontend-only, browser-based 3D viewer for STEP and STL files. Drop in a
model, click any surface, and recolor it — no backend, no upload, everything
runs locally in your browser.

## Features

- **STEP (.step/.stp)** parsing via [occt-import-js](https://github.com/kovacsv/occt-import-js)
  (OpenCascade compiled to WebAssembly), which preserves true per-face
  boundaries and any colors baked into the file.
- **STL (.stl)** parsing (ASCII and binary), with automatic surface
  detection: adjacent triangles are grouped into a "surface" when they share
  an edge and their normals stay within an angle threshold of each other —
  so a tessellated cylinder or fillet is one clickable surface, not hundreds
  of triangles, while distinct flat faces stay separate.
- Click any surface in the 3D view to select it — the sidebar highlights the
  matching entry and the surface gets a highlight glow.
- Per-surface color pickers in the sidebar, plus a "set all surfaces in this
  part" swatch for quick part-level recoloring.
- Multi-part STEP assemblies are listed part by part, each collapsible.
- Reset to the original colors at any time.
- Export the recolored model as a `.glb` (glTF binary) to use elsewhere.
- Drag-and-drop or "Open File" to load a model.

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL. To build a static production bundle:

```bash
npm run build
npm run preview   # serve the built dist/ folder locally
```

The output in `dist/` is fully static (HTML/CSS/JS + a `.wasm` file) and can
be hosted on any static file host — there is no server-side component.

## How surface detection works

- **STEP**: OCCT tessellates each B-rep face into triangles and reports the
  triangle range for every face (`brep_faces`). Each face becomes its own
  material/group, so "surface" here matches the actual CAD faces.
- **STL**: there's no face metadata in the format, so surfaces are
  reconstructed with a union-find over the triangle adjacency graph — two
  triangles sharing an edge are merged into the same surface if the angle
  between their normals is below a threshold (20° by default). This merges
  the many facets of a curved surface while still splitting at sharp edges.

## Tech stack

- [Vite](https://vitejs.dev/) + TypeScript
- [three.js](https://threejs.org/) for rendering (`OrbitControls`, `STLLoader`, `GLTFExporter`)
- [occt-import-js](https://github.com/kovacsv/occt-import-js) for STEP parsing
