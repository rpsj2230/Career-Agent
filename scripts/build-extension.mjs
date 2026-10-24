// Builds the browser extension into extension/dist (load that folder as an unpacked extension), and a zip of it for download from the app.  npm run build:extension
import { build } from "esbuild";
import JSZip from "jszip";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "extension/dist"), { recursive: true });
const common = { bundle: true, format: "iife", target: "chrome110", platform: "browser", alias: { "@": join(root, "src") }, logLevel: "warning" };
await build({ ...common, entryPoints: [join(root, "extension/src/content.ts")], outfile: join(root, "extension/dist/content.js") });
await build({ ...common, entryPoints: [join(root, "extension/src/lib.ts")], outfile: join(root, "extension/dist/lib.js") });
const files = ["manifest.json", "popup.html", "popup.css", "popup.js", "background.js", "run.js"];
const icons = ["icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png", "icons/rp-logo-white.png"];
for (const f of files) cpSync(join(root, "extension", f), join(root, "extension/dist", f));
mkdirSync(join(root, "extension/dist/icons"), { recursive: true });
for (const f of icons) cpSync(join(root, "extension", f), join(root, "extension/dist", f));

// the zip the app offers for download (public/ is served by the app; the code contains nothing personal). It is committed, and rebuilt before every `npm run build`.
const zip = new JSZip();
// fixed dates and order: the same sources always give the same bytes, so the committed zip only changes when the extension does
for (const f of [...files, ...icons, "content.js", "lib.js"].sort()) zip.file(f, readFileSync(join(root, "extension/dist", f)), { date: new Date(Date.UTC(2026, 0, 1)), createFolders: false });
mkdirSync(join(root, "public/downloads"), { recursive: true });
writeFileSync(join(root, "public/downloads/career-agent-extension.zip"), await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
console.log("Built extension/dist and public/downloads/career-agent-extension.zip. In Chrome or Brave: chrome://extensions, Developer mode, Load unpacked, choose the unzipped folder (or extension/dist).");
