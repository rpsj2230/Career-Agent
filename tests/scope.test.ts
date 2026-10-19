import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSharedSetting, profilesEnabled, resetProfilesEnabledForTests, scopeClient, settingKeys, SHARED_SETTING_KEYS, sharedOnlyClient, type Scope } from "@/lib/scope";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

type Rec = { table: string; calls: [string, unknown[]][] };

/** A stand-in for the Supabase client that records exactly what the scoped wrapper asks of it. */
function fake(result: unknown = { data: [], error: null }) {
  const seen: Rec[] = [];
  const raw = {
    from(table: string) {
      const rec: Rec = { table, calls: [] };
      seen.push(rec);
      const p: unknown = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
          return (...args: unknown[]) => { rec.calls.push([String(prop), args]); return p; };
        },
      });
      return p;
    },
    storage: { from: () => "storage" },
  } as unknown as SupabaseClient;
  return { raw, seen };
}

const inProfile = (id: string): (() => Promise<Scope>) => async () => ({ kind: "profiles", profileId: async () => id });
const legacy = async (): Promise<Scope> => ({ kind: "legacy" });

describe("scopeClient: profile mode", () => {
  it("adds the profile to a read, right after select, before any other filter", async () => {
    const { raw, seen } = fake();
    await scopeClient(raw, inProfile(A)).from("jobs").select("id,title").eq("status", "new").order("found_at").limit(5);
    expect(seen[0].table).toBe("jobs");
    expect(seen[0].calls).toEqual([["select", ["id,title"]], ["eq", ["profile_id", A]], ["eq", ["status", "new"]], ["order", ["found_at"]], ["limit", [5]]]);
  });

  it("keeps .single() and .maybeSingle() working after the profile filter", async () => {
    const { raw, seen } = fake();
    await scopeClient(raw, inProfile(A)).from("applications").select("*").eq("id", "x").maybeSingle();
    expect(seen[0].calls.map((c) => c[0])).toEqual(["select", "eq", "eq", "maybeSingle"]);
  });

  it("stamps the profile on inserted rows (one or many)", async () => {
    const { raw, seen } = fake();
    const db = scopeClient(raw, inProfile(A));
    await db.from("activity_log").insert({ kind: "x" });
    await db.from("jobs").insert([{ title: "a" }, { title: "b" }]);
    expect(seen[0].calls[0]).toEqual(["insert", [{ kind: "x", profile_id: A }, undefined]]);
    expect(seen[1].calls[0][1][0]).toEqual([{ title: "a", profile_id: A }, { title: "b", profile_id: A }]);
  });

  it("refuses a write that names another profile", async () => {
    const { raw, seen } = fake();
    const db = scopeClient(raw, inProfile(A));
    await expect(Promise.resolve(db.from("jobs").insert({ title: "a", profile_id: B }))).rejects.toThrow(/another profile/);
    await expect(Promise.resolve(db.from("jobs").upsert([{ title: "a" }, { title: "b", profile_id: B }]))).rejects.toThrow(/another profile/);
    expect(seen.every((s) => s.calls.length === 0 || s.calls[0][0] !== "insert")).toBe(true);
  });

  it("accepts a write that names the same profile", async () => {
    const { raw, seen } = fake();
    await scopeClient(raw, inProfile(A)).from("jobs").insert({ title: "a", profile_id: A });
    expect((seen[0].calls[0][1][0] as { profile_id: string }).profile_id).toBe(A);
  });

  it("puts the profile into onConflict only where the unique key includes it", async () => {
    const { raw, seen } = fake();
    const db = scopeClient(raw, inProfile(A));
    await db.from("jobs").upsert([{ source: "s", external_id: "e" }], { onConflict: "source,external_id", ignoreDuplicates: true });
    await db.from("answer_bank").upsert({ key: "k" }, { onConflict: "key" });
    await db.from("daily_reports").upsert({ report_date: "2026-01-01" }, { onConflict: "report_date,timezone" });
    await db.from("country_prefs").upsert({ country: "sg" }, { onConflict: "country" });
    await db.from("applications").upsert({ job_id: "j" }, { onConflict: "job_id" }); // unique per job, and a job already belongs to one profile
    await db.from("settings").upsert({ key: "caps", value: {} }); // the default key already includes the profile
    expect(seen[0].calls[0][1][1]).toEqual({ onConflict: "profile_id,source,external_id", ignoreDuplicates: true });
    expect((seen[1].calls[0][1][1] as { onConflict: string }).onConflict).toBe("profile_id,key");
    expect((seen[2].calls[0][1][1] as { onConflict: string }).onConflict).toBe("profile_id,report_date,timezone");
    expect((seen[3].calls[0][1][1] as { onConflict: string }).onConflict).toBe("profile_id,country");
    expect((seen[4].calls[0][1][1] as { onConflict: string }).onConflict).toBe("job_id");
    expect((seen[5].calls[0][1][1] as Record<string, unknown>).onConflict).toBeUndefined();
  });

  it("limits updates and deletes to the profile, and never lets an update move a row to another profile", async () => {
    const { raw, seen } = fake();
    const db = scopeClient(raw, inProfile(A));
    await db.from("applications").update({ status: "approved", profile_id: B }).eq("id", "x").select("id");
    await db.from("jobs").delete().eq("id", "y");
    expect(seen[0].calls).toEqual([["update", [{ status: "approved" }, undefined]], ["eq", ["profile_id", A]], ["eq", ["id", "x"]], ["select", ["id"]]]);
    expect(seen[1].calls).toEqual([["delete", [undefined]], ["eq", ["profile_id", A]], ["eq", ["id", "y"]]]);
  });

  it("scopes every per-person table and leaves the shared ones alone", async () => {
    const { raw, seen } = fake();
    const db = scopeClient(raw, inProfile(A));
    for (const t of ["profile", "answer_bank", "settings", "jobs", "job_scores", "documents", "applications", "apply_events", "integrations", "schedules", "automation_runs", "portal_scans", "activity_log", "country_prefs", "daily_reports"]) await db.from(t).select("*").eq("key", "caps");
    for (const s of seen) expect(s.calls.some((c) => c[0] === "eq" && c[1][0] === "profile_id" && c[1][1] === A), s.table).toBe(true);
    seen.length = 0;
    for (const t of ["model_configs", "model_usage", "profiles", "shared_settings"]) await db.from(t).select("*");
    for (const s of seen) expect(s.calls.some((c) => c[1][0] === "profile_id"), s.table).toBe(false);
  });

  it("passes storage and other client members straight through", () => {
    const { raw } = fake();
    expect((scopeClient(raw, inProfile(A)) as unknown as { storage: { from: () => string } }).storage.from()).toBe("storage");
  });

  it("returns whatever the database returns, and can be awaited through Promise.all", async () => {
    const { raw } = fake({ data: [{ id: 1 }], error: null });
    const db = scopeClient(raw, inProfile(A));
    const [x, y] = await Promise.all([db.from("jobs").select("id"), db.from("jobs").select("id").limit(1)]);
    expect(x).toEqual({ data: [{ id: 1 }], error: null });
    expect(y).toEqual({ data: [{ id: 1 }], error: null });
  });

  it("fails closed when no profile is selected: nothing reaches the database", async () => {
    const { raw, seen } = fake();
    const noProfile = scopeClient(raw, async () => ({ kind: "profiles", profileId: async () => { throw new Error("No profile is selected"); } }));
    await expect(Promise.resolve(noProfile.from("jobs").select("*"))).rejects.toThrow(/No profile/);
    await expect(Promise.resolve(noProfile.from("jobs").delete().eq("id", "x"))).rejects.toThrow(/No profile/);
    expect(seen.length).toBe(0);
  });

  it("must start with a database operation", async () => {
    const { raw } = fake();
    await expect(Promise.resolve((scopeClient(raw, inProfile(A)).from("jobs") as unknown as { eq: (a: string, b: string) => unknown }).eq("id", "x"))).rejects.toThrow(/must start with/);
  });
});

describe("scopeClient: settings", () => {
  it("sends app-wide keys to shared_settings, without a profile", async () => {
    const { raw, seen } = fake();
    const db = scopeClient(raw, inProfile(A));
    await db.from("settings").select("value").eq("key", "team").maybeSingle();
    await db.from("settings").upsert({ key: "model_keys", value: {} });
    await db.from("settings").delete().eq("key", "owner");
    await db.from("settings").select("key,value").in("key", ["team", "owner"]);
    expect(seen.map((s) => s.table)).toEqual(["shared_settings", "shared_settings", "shared_settings", "shared_settings"]);
    for (const s of seen) expect(JSON.stringify(s.calls)).not.toContain("profile_id");
  });

  it("keeps everything else per profile", async () => {
    const { raw, seen } = fake();
    const db = scopeClient(raw, inProfile(A));
    await db.from("settings").select("value").eq("key", "caps").maybeSingle();
    await db.from("settings").upsert({ key: "autoapply", value: { enabled: true } });
    await db.from("settings").select("key,value").in("key", ["email:1", "email:2"]);
    expect(seen.map((s) => s.table)).toEqual(["settings", "settings", "settings"]);
    expect(seen[0].calls[1]).toEqual(["eq", ["profile_id", A]]);
    expect((seen[1].calls[0][1][0] as { profile_id: string }).profile_id).toBe(A);
  });

  it("refuses one query that mixes app-wide and per-profile keys", async () => {
    const { raw } = fake();
    await expect(Promise.resolve(scopeClient(raw, inProfile(A)).from("settings").select("*").in("key", ["team", "caps"]))).rejects.toThrow(/both app-wide and per-profile/);
  });

  it("reads app-wide keys even when no profile is selected (sign-in checks, the Telegram webhook)", async () => {
    const { raw, seen } = fake();
    const db = scopeClient(raw, async () => ({ kind: "profiles", profileId: async () => { throw new Error("no profile"); } }));
    await db.from("settings").select("value").eq("key", "team").maybeSingle();
    expect(seen[0].table).toBe("shared_settings");
    await expect(Promise.resolve(db.from("settings").select("value").eq("key", "caps"))).rejects.toThrow(/no profile/);
  });

  it("finds the keys a settings query names", () => {
    expect(settingKeys([["select", ["*"]], ["eq", ["key", "caps"]]])).toEqual(["caps"]);
    expect(settingKeys([["upsert", [[{ key: "a" }, { key: "b" }]]]])).toEqual(["a", "b"]);
    expect(settingKeys([["select", ["*"]]])).toEqual([]);
    expect(isSharedSetting("integration_keys")).toBe(true);
    expect(isSharedSetting("mailbox_keys")).toBe(false); // each person's mailbox is theirs
    expect(isSharedSetting("caps")).toBe(false);
  });
});

describe("scopeClient: before the profiles migration", () => {
  it("changes nothing: no filter, no stamp, settings stay in settings", async () => {
    const { raw, seen } = fake();
    const db = scopeClient(raw, legacy);
    await db.from("jobs").select("id").eq("status", "new");
    await db.from("jobs").insert({ title: "a" });
    await db.from("settings").select("value").eq("key", "team");
    await db.from("jobs").upsert({ a: 1 }, { onConflict: "source,external_id" });
    expect(seen[0].calls).toEqual([["select", ["id"]], ["eq", ["status", "new"]]]);
    expect(seen[1].calls).toEqual([["insert", [{ title: "a" }, undefined]]]);
    expect(seen[2].table).toBe("settings");
    expect((seen[3].calls[0][1][1] as { onConflict: string }).onConflict).toBe("source,external_id");
  });
});

describe("profilesEnabled", () => {
  beforeEach(() => resetProfilesEnabledForTests());
  const clientReturning = (error: { code?: string; message: string } | null) => {
    const select = vi.fn(() => ({ limit: async () => ({ error }) }));
    return { raw: { from: vi.fn(() => ({ select })) } as unknown as SupabaseClient, select };
  };

  it("is false while the table is missing, re-checks after a few seconds, and then stays true", async () => {
    const missing = clientReturning({ code: "PGRST205", message: "Could not find the table 'public.profiles' in the schema cache" });
    expect(await profilesEnabled(missing.raw, 1_000)).toBe(false);
    expect(await profilesEnabled(missing.raw, 2_000)).toBe(false);
    expect(missing.select).toHaveBeenCalledTimes(1); // not asked again within 5 seconds
    const ready = clientReturning(null);
    expect(await profilesEnabled(ready.raw, 7_000)).toBe(true);
    expect(await profilesEnabled(missing.raw, 8_000)).toBe(true); // true is remembered
    expect(missing.select).toHaveBeenCalledTimes(1);
  });

  it("does not guess when the database cannot be reached", async () => {
    await expect(profilesEnabled(clientReturning({ message: "fetch failed" }).raw, 1_000)).rejects.toThrow(/could not check/);
  });

  it("sharedOnlyClient reaches app-wide settings but no per-person data", async () => {
    const { raw, seen } = fake();
    resetProfilesEnabledForTests();
    const ok = { ...(raw as object), from: (t: string) => (t === "profiles" ? { select: () => ({ limit: async () => ({ error: null }) }) } : (raw as unknown as { from: (t: string) => unknown }).from(t)) } as unknown as SupabaseClient;
    const db = sharedOnlyClient(ok);
    await db.from("settings").select("value").eq("key", "owner").maybeSingle();
    expect(seen[0].table).toBe("shared_settings");
    await expect(Promise.resolve(db.from("jobs").select("*"))).rejects.toThrow(/no profile/);
  });
});

describe("the migration and the code agree", () => {
  it("lists the same app-wide keys and per-person tables", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/0003_profiles.sql", "utf8");
    for (const k of SHARED_SETTING_KEYS) expect(sql, k).toContain(`'${k}'`);
    const mock = readFileSync("tests/e2e/mock-supabase.mjs", "utf8");
    for (const k of SHARED_SETTING_KEYS) expect(mock, k).toContain(`"${k}"`);
    const { PROFILE_TABLES } = await import("@/lib/scope");
    for (const t of PROFILE_TABLES) { expect(sql, t).toContain(`'${t}'`); expect(mock, t).toContain(`"${t}"`); }
  });
});
