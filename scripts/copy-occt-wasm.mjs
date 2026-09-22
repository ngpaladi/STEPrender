// occt-import-js ships its .wasm binary inside node_modules; the app fetches
// it at runtime from a static path, so it needs to live under public/. Rather
// than committing a ~7MB vendored binary to the repo, we copy it into place
// whenever dependencies are installed (or before dev/build, in case
// node_modules was restored without running install scripts).
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(rootDir, 'node_modules', 'occt-import-js', 'dist', 'occt-import-js.wasm');
const destDir = path.join(rootDir, 'public');
const dest = path.join(destDir, 'occt-import-js.wasm');

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log('Copied occt-import-js.wasm into public/');
