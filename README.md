# STEP/STL Viewer

A frontend-only, browser-based 3D viewer for STEP, STL and GLB files. Drop in a
model, click any surface, and recolor it — no backend, no upload, everything
runs locally in your browser.

## Features

- **STEP (.step/.stp)** parsing via [occt-import-js](https://github.com/kovacsv/occt-import-js)
  (OpenCascade compiled to WebAssembly), which preserves true per-face
  boundaries and any colors baked into the file.
- **glTF binary (.glb)** import, which also reads back what this app exports.
  glTF carries its own materials, so those are kept as-is rather than
  re-deriving surfaces from the geometry — each mesh becomes a part, and a
  mesh with several materials exposes one surface per material. Compressed
  glTF (Draco, KTX2) isn't supported and reports a clear error.
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
- **Navigation**: orbit by dragging, zoom by scrolling. A corner axis widget
  shows the current orientation — click an axis to swing the camera to that
  view. "Fit" re-frames everything, and "Pan" switches dragging from orbit to
  pan, which matters on pointers with no comfortable right-drag or two-finger
  pan (an iPad trackpad, for instance).
- **Move and rotate files**: "Move" or "Rotate" turns on a drag gizmo — click
  a file, then drag an arrow to translate it or a ring to rotate it. A file
  moves as one piece and pivots about its own centre. Translation is free;
  rotation snaps to 45° steps, so 90° and 180° land exactly. Once you've
  placed a file by hand, adding more files won't re-flow it. Esc exits.
- Reset to the original colors at any time.
- **Render product images**: "Render Image" exports the current camera view as
  a PNG at up to 4K (or 1×/2×/4× the viewport for exact WYSIWYG framing), on a
  studio-gradient, transparent, or viewport background, with an optional
  shadow under the part. The grid and the selection highlight are excluded, so
  the output is a clean product shot. A preview appears before you download.
- Export the recolored model as a `.glb` (glTF binary) to use elsewhere.
- **Export STEP**: writes everything loaded as one combined `.step` file with
  the per-surface colors and your arrangement baked in. Note the tradeoff
  below — the geometry is faceted.
- Drag-and-drop or "Add File(s)" to load one or more models (.step/.stp/.stl/.glb) — select or drop
  several files at once (or add them one at a time) to assemble them into a
  single scene. Each file gets its own section in the sidebar with a remove
  button, and files are laid out side by side automatically so they don't
  overlap. "Clear Scene" empties the assembly; "Export GLB" exports
  everything currently loaded as one combined file.

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

## Hosting on GitHub Pages

A workflow at `.github/workflows/deploy.yml` builds the app and publishes
`dist/` to GitHub Pages on every push to `main`. To enable it:

1. In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
2. Push to `main` (or run the workflow manually from the **Actions** tab).
3. The deployed URL appears in the workflow run summary and under
   **Settings → Pages**, typically `https://<user>.github.io/<repo>/`.

The build uses a relative base path (`vite.config.ts`'s `base: './'`), so it
works whether the site is served from a domain root or a project subpath
like `/STEPrender/` — no extra configuration needed.

## How surface detection works

- **STEP**: OCCT tessellates each B-rep face into triangles and reports the
  triangle range for every face (`brep_faces`). Each face becomes its own
  material/group, so "surface" here matches the actual CAD faces.
- **STL**: there's no face metadata in the format, so surfaces are
  reconstructed with a union-find over the triangle adjacency graph — two
  triangles sharing an edge are merged into the same surface if the angle
  between their normals is below a threshold (20° by default). This merges
  the many facets of a curved surface while still splitting at sharp edges.

Those patches double as smoothing groups: vertex normals are averaged within
each patch and never across two, so a tessellated cylinder shades smoothly
while its rim stays crisp, matching how the same part looks as STEP.

## STEP export: what you get, and what you lose

The loader tessellates to triangles and discards the B-rep, and
`occt-import-js` only reads STEP — so the exporter writes what's actually in
memory: every triangle becomes a planar `ADVANCED_FACE` inside a
`MANIFOLD_SOLID_BREP`, one solid per part, with world transforms baked into
the coordinates and per-surface colors attached as `STYLED_ITEM`s.

That means the file opens in CAD, keeps each part as its own body, and carries
your colors and arrangement — but curved surfaces stay faceted, every triangle
shows up as its own face, and files are much larger than the original. For
exact CAD surfaces, the source STEP is still the source of truth.

Correctness is verified by round-tripping: the exported file is read back with
OpenCascade and must return the same face count, the same triangle count, and
the same colors.

## Rendering notes

Shading uses an image-based studio environment (three's `RoomEnvironment` via
PMREM) plus a key/fill light rig, and the Khronos PBR Neutral tone mapper,
which rolls off highlights without shifting hues — so a surface still reads as
the color you picked in the sidebar. The light rig, its shadow camera and the
shadow-catching ground plane are re-fitted to the scene's bounding box on every
change, because models here range from millimetre parts to metre-scale
assemblies.

Image export reuses the viewport canvas at a larger drawing-buffer size rather
than rendering through an offscreen target, so exports match the on-screen
frame exactly. Requested sizes are clamped to the GPU's maximum texture size
and to 40 megapixels.

## Tech stack

- [Vite](https://vitejs.dev/) + TypeScript
- [three.js](https://threejs.org/) for rendering (`OrbitControls`, `TransformControls`, `STLLoader`, `GLTFLoader`, `GLTFExporter`)
- [occt-import-js](https://github.com/kovacsv/occt-import-js) for STEP parsing
