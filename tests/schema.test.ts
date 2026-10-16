import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "@/lib/migrations";
import { buildStatus, classifySchemaError, isMissingSchemaError, REQUIRED_SCHEMA } from "@/lib/schema";

describe("embedded migrations", () => {
  it("match the SQL files exactly (run `npm run gen:migrations` if this fails)", () => {
    expect(MIGRATIONS.map((m) => m.id)).toEqual(["0001_init", "0002_portals_runs_logs_schedules"]);
    for (const m of MIGRATIONS) expect(m.sql, m.id).toBe(readFileSync(`supabase/migrations/${m.id}.sql`, "utf8"));
  });
  it("every migration named in REQUIRED_SCHEMA exists", () => {
    const ids = new Set(MIGRATIONS.map((m) => m.id));
    for (const r of REQUIRED_SCHEMA) expect(ids.has(r.migration), r.table).toBe(true);
  });
});

describe("classifySchemaError", () => {
  it("recognises missing tables and columns from Postgres and PostgREST", () => {
    expect(classifySchemaError({ code: "42P01", message: 'relation "public.integrations" does not exist' })).toBe("table");
    expect(classifySchemaError({ code: "PGRST205", message: "Could not find the table 'public.schedules' in the schema cache" })).toBe("table");
    expect(classifySchemaError({ code: "42703", message: "column jobs.portal does not exist" })).toBe("column");
    expect(classifySchemaError({ code: "PGRST204", message: "Could not find the 'portal' column of 'jobs' in the schema cache" })).toBe("column");
  });
  it("treats everything else as a different problem, and no error as healthy", () => {
    expect(classifySchemaError({ code: "401", message: "Invalid API key" })).toBe("other");
    expect(classifySchemaError(null)).toBeNull();
    expect(isMissingSchemaError("load schedules: relation \"schedules\" does not exist")).toBe(true);
    expect(isMissingSchemaError("fetch failed")).toBe(false);
  });
});

describe("buildStatus", () => {
  it("is healthy with no problems and lists each pending migration once", () => {
    expect(buildStatus([]).ok).toBe(true);
    const s = buildStatus([
      { table: "schedules", migration: "0002_x", kind: "table" },
      { table: "jobs", column: "portal", migration: "0002_x", kind: "column" },
    ]);
    expect(s.ok).toBe(false);
    expect(s.pendingMigrations).toEqual(["0002_x"]);
  });
  it("is not healthy when the database is unreachable", () => expect(buildStatus([], "t", "fetch failed").ok).toBe(false));
});
