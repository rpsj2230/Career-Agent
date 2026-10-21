import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0004_data_api_grants.sql", "utf8").replace(/--.*$/gm, "");

describe("0004 data API grants", () => {
  it("gives the server-side role access to existing and future tables, sequences and functions", () => {
    for (const what of ["tables", "sequences"]) {
      expect(sql).toMatch(new RegExp(`grant all on all ${what} in schema public to service_role`));
      expect(sql).toMatch(new RegExp(`alter default privileges in schema public grant all on ${what} to service_role`));
    }
    expect(sql).toMatch(/grant execute on all functions in schema public to service_role/);
    expect(sql).toMatch(/alter default privileges in schema public grant execute on functions to service_role/);
  });
  it("never opens anything to the browser-facing roles", () => {
    expect(sql).not.toMatch(/\banon\b/);
    expect(sql).not.toMatch(/\bauthenticated\b/);
    expect(sql).not.toMatch(/\bto public\b/i);
  });
  it("only grants (nothing is dropped or changed), so running it again is safe", () => {
    expect(sql).not.toMatch(/\b(drop|delete|truncate|revoke)\b/i);
  });
});
