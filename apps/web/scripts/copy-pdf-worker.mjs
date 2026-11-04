// Copies the pdf.js worker into /public so it is served as a static asset.
// Bundling the worker through webpack/turbopack is brittle; a static URL is not.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
const src = path.join(pkgDir, "build", "pdf.worker.min.mjs");
const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "public");
mkdirSync(outDir, { recursive: true });
copyFileSync(src, path.join(outDir, "pdf.worker.min.mjs"));
