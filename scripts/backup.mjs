// Exports the whole Career Agent database (and the non-application files in the "documents" bucket) into a folder.
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup.mjs <out-dir>
// The GitHub workflow .github/workflows/backup.yml then packs, encrypts and stores it. Reads only; changes nothing.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { isApplicationDocument, tablesFromMigrations } from "./lib/backup-lib.mjs";

const out = process.argv[2] ?? "backup-out";
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const migDir = new URL("../supabase/migrations/", import.meta.url);
const tables = tablesFromMigrations(readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(new URL(f, migDir), "utf8")));
mkdirSync(join(out, "db"), { recursive: true });

const manifest = { createdAt: new Date().toISOString(), tables: {}, storage: { files: 0, bytes: 0, skippedApplicationDocuments: 0 } };
const PAGE = 1000;

for (const table of tables) {
  // a stable order makes paging safe; tables without an id column use their key
  let order = null;
  for (const col of ["id", "key", "job_id", "country"]) { const probe = await sb.from(table).select(col).limit(1); if (!probe.error) { order = col; break; } }
  const probe = await sb.from(table).select("*", { count: "exact", head: true });
  if (probe.error) {
    if (/does not exist|schema cache|Could not find the table/i.test(probe.error.message)) { console.log(`skip ${table}: not in this database (migration not applied)`); continue; }
    throw new Error(`${table}: ${probe.error.message}`);
  }
  const lines = [];
  let missing = false;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select("*").range(from, from + PAGE - 1);
    if (order) q = q.order(order, { ascending: true });
    const { data, error } = await q;
    if (error && /does not exist|schema cache|Could not find the table/i.test(error.message)) { missing = true; break; }
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const row of data ?? []) lines.push(JSON.stringify(row));
    if (!data || data.length < PAGE) break;
  }
  if (missing) { console.log(`skip ${table}: not in this database (migration not applied)`); continue; }
  writeFileSync(join(out, "db", `${table}.ndjson.gz`), gzipSync(lines.join("\n") + (lines.length ? "\n" : "")));
  manifest.tables[table] = lines.length;
  console.log(`${table}: ${lines.length} row(s)`);
}

// Storage: everything in the "documents" bucket except the per-application resumes and cover letters
async function walk(prefix = "") {
  const { data, error } = await sb.storage.from("documents").list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error) throw new Error(`storage list ${prefix || "/"}: ${error.message}`);
  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (!item.id) { // a folder
      if (!prefix && isApplicationDocument(item.name)) { manifest.storage.skippedApplicationDocuments++; continue; }
      await walk(path);
      continue;
    }
    const dl = await sb.storage.from("documents").download(path);
    if (dl.error || !dl.data) throw new Error(`storage download ${path}: ${dl.error?.message}`);
    const bytes = Buffer.from(await dl.data.arrayBuffer());
    const dest = join(out, "storage", path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
    manifest.storage.files++; manifest.storage.bytes += bytes.length;
    console.log(`storage ${path} (${bytes.length} bytes)`);
  }
}
await walk();

writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Done: ${Object.keys(manifest.tables).length} table(s), ${Object.values(manifest.tables).reduce((a, b) => a + b, 0)} row(s), ${manifest.storage.files} stored file(s).`);
