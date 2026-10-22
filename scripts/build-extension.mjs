// Builds the browser extension into extension/dist (load that folder as an unpacked extension).  npm run build:extension
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "extension/dist"), { recursive: true });
await build({
  entryPoints: [join(root, "extension/src/content.ts")], outfile: join(root, "extension/dist/content.js"), bundle: true, format: "iife", target: "chrome110", platform: "browser",
  alias: { "@": join(root, "src") }, logLevel: "warning",
});
for (const f of ["manifest.json", "popup.html", "popup.js"]) cpSync(join(root, "extension", f), join(root, "extension/dist", f));
console.log("Built extension/dist. In Chrome or Brave: open chrome://extensions, switch on Developer mode, press Load unpacked, choose the extension/dist folder.");
