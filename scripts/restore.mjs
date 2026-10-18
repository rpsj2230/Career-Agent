// Restores a backup made by scripts/backup.mjs into a Supabase project (after you ran the SQL in supabase/migrations there).
//   node scripts/restore.mjs <backup-dir>            shows what would be restored (changes nothing)
//   node scripts/restore.mjs <backup-dir> --apply    writes it
//   add --reset-owner to forget the old owner account so you can sign up again in the new project
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gunzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";

const dir = process.argv[2];
const apply = process.argv.includes("--apply"), resetOwner = process.argv.includes("--reset-owner");
if (!dir || !existsSync(join(dir, "manifest.json"))) { console.error("Usage: node scripts/restore.mjs <backup-dir> [--apply] [--reset-owner]"); process.exit(1); }
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (apply && (!url || !key)) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY of the project to restore INTO."); process.exit(1); }
const sb = apply ? createClient(url, key, { auth: { persistSession: false } }) : null;
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
console.log(`Backup from ${manifest.createdAt}`);

// the order of the manifest is the order the migrations create the tables: parents before children
for (const [table, count] of Object.entries(manifest.tables)) {
  const file = join(dir, "db", `${table}.ndjson.gz`);
  if (!existsSync(file)) continue;
  let rows = gunzipSync(readFileSync(file)).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (table === "settings" && resetOwner) rows = rows.filter((r) => r.key !== "owner");
  console.log(`${apply ? "restoring" : "would restore"} ${table}: ${rows.length}${rows.length !== count ? ` (backup says ${count})` : ""}`);
  if (!apply) continue;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}
const storage = join(dir, "storage");
if (existsSync(storage)) {
  const files = [];
  (function walk(d) { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files.push(p); } })(storage);
  for (const f of files) {
    const path = relative(storage, f).split("\\").join("/");
    console.log(`${apply ? "uploading" : "would upload"} storage/${path}`);
    if (!apply) continue;
    const { error } = await sb.storage.from("documents").upload(path, readFileSync(f), { upsert: true });
    if (error) throw new Error(`storage ${path}: ${error.message}`);
  }
}
console.log(apply ? "Restore finished." : "Dry run only. Add --apply to write.");
