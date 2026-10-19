// Pure helpers for the database backup (tested in tests/backup.test.ts).

/** Table names in the order the migrations create them, which is also a safe order to restore them (parents before children). */
export function tablesFromMigrations(sqlFiles) {
  const out = [];
  for (const sql of sqlFiles) for (const m of sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)) if (!out.includes(m[1])) out.push(m[1]);
  // every per-person table points at a profile, so the profiles come back first even though their table is created after the others
  return out.includes("profiles") ? ["profiles", ...out.filter((t) => t !== "profiles")] : out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Storage files worth keeping: your master resume and similar. The resume and cover letter written for each application live in a folder named after the job's id and are left out (they can be rewritten from the database). */
export const isApplicationDocument = (path) => UUID.test(path.split("/")[0] ?? "");

/** Daily backups are named db-YYYY-MM-DD.tar.gz.enc. Keep the newest `keep`; return the names to delete (the oldest), so day 61 replaces day 1. */
export function backupsToDelete(names, keep = 60) {
  const dated = names.filter((n) => /^db-\d{4}-\d{2}-\d{2}\.tar\.gz\.enc$/.test(n)).sort();
  return dated.length > keep ? dated.slice(0, dated.length - keep) : [];
}

export const backupName = (date = new Date()) => `db-${date.toISOString().slice(0, 10)}.tar.gz.enc`;
