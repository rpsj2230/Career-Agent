import { beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

vi.mock("server-only", () => ({}));
const store: Record<string, Record<string, string>> = {};
const modelRows = [{ label: "gemini", api_key_env: "GEMINI_API_KEY" }, { label: "groq", api_key_env: "GROQ_API_KEY" }, { label: "local", api_key_env: null }];
vi.mock("@/lib/db", () => ({
  must: (r: { data: unknown; error?: unknown }) => r.data,
  db: () => ({
    from: (table: string) => {
      let key = "";
      const q = {
        then: (res: (v: unknown) => void) => res({ data: table === "model_configs" ? modelRows : null }),
        select: () => q, eq: (_c: string, v: string) => { key = v; return q; },
        maybeSingle: async () => ({ data: store[key] ? { value: store[key] } : null }),
        upsert: (row: { key: string; value: Record<string, string> }) => { store[row.key] = row.value; return { select: async () => ({ data: [row] }) }; },
      };
      return q;
    },
  }),
}));

import { healKeys, importEnvKeys, keyReadiness, resolveKeys, saveKey } from "@/lib/llm/keys";

const rows = [{ label: "gemini", api_key_env: null }, { label: "groq", api_key_env: "GROQ_API_KEY" }] as never;
const set = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }; // assigning undefined would store the text "undefined"
const env = (service: string | undefined, cron: string | undefined) => { set("SUPABASE_SERVICE_ROLE_KEY", service); set("CRON_SECRET", cron); delete process.env.GROQ_API_KEY; };

describe("saved model keys are readable by both the site and the GitHub runner", () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

  it("a key saved on the site is stored under both secrets", async () => {
    env("service-A", "cron-secret-shared-1");
    await saveKey("gemini", "AIza-key");
    expect(decryptSecret(store.model_keys.gemini, "service-A")).toBe("AIza-key");
    expect(decryptSecret(store.model_keys_shared.gemini, "cron-secret-shared-1")).toBe("AIza-key");
  });

  it("the runner has a DIFFERENT Supabase key but the same CRON_SECRET and still reads the key", async () => {
    env("service-A", "cron-secret-shared-1");
    await saveKey("gemini", "AIza-key");
    env("service-B-other-valid-key", "cron-secret-shared-1"); // the GitHub runner
    expect((await resolveKeys(rows)).get("gemini")).toBe("AIza-key");
    expect((await keyReadiness()).unreadable).toEqual([]);
  });

  it("without the second copy the runner cannot read it, and says so; the hourly check then adds the copy", async () => {
    env("service-A", undefined);
    await saveKey("gemini", "AIza-key"); // saved before the second copy existed
    expect(store.model_keys_shared).toBeUndefined();
    env("service-B", "cron-secret-shared-1");
    expect((await keyReadiness()).unreadable).toEqual(["gemini"]);
    expect((await resolveKeys(rows)).has("gemini")).toBe(false);

    env("service-A", "cron-secret-shared-1"); // the site, which can read it, runs the hourly check
    expect(await healKeys()).toBe(1);
    expect(await healKeys()).toBe(0); // nothing more to add
    env("service-B", "cron-secret-shared-1");
    expect((await resolveKeys(rows)).get("gemini")).toBe("AIza-key");
  });

  it("an env var still works when no saved key exists", async () => {
    env("service-A", "cron-secret-shared-1");
    process.env.GROQ_API_KEY = "gsk-env";
    expect((await resolveKeys(rows)).get("groq")).toBe("gsk-env");
  });

  it("a different CRON_SECRET and Supabase key cannot read it (the keys stay encrypted)", async () => {
    env("service-A", "cron-secret-shared-1");
    await saveKey("gemini", "AIza-key");
    env("other", "another-secret-entirely-2");
    expect((await resolveKeys(rows)).has("gemini")).toBe(false);
    expect(encryptSecret("AIza-key", "k")).not.toContain("AIza-key");
  });

  it("keys that only exist as environment variables on the site are copied into the app so the runner can use them", async () => {
    env("service-A", "cron-secret-shared-1");
    process.env.GEMINI_API_KEY = "AIza-from-vercel"; process.env.GROQ_API_KEY = "gsk-from-vercel";
    expect(await importEnvKeys()).toBe(2);
    expect(await importEnvKeys()).toBe(0); // already saved
    delete process.env.GEMINI_API_KEY; delete process.env.GROQ_API_KEY;
    env("service-B-runner", "cron-secret-shared-1"); // the runner has neither the env vars nor the same Supabase key
    const keys = await resolveKeys(rows);
    expect(keys.get("gemini")).toBe("AIza-from-vercel");
    expect(keys.get("groq")).toBe("gsk-from-vercel");
  });

  it("the hourly heal also imports env keys, and never saves an empty or missing one", async () => {
    env("service-A", "cron-secret-shared-1");
    process.env.GEMINI_API_KEY = "   ";
    expect(await healKeys()).toBe(0);
    process.env.GEMINI_API_KEY = "AIza-real";
    expect(await healKeys()).toBeGreaterThanOrEqual(1);
    delete process.env.GEMINI_API_KEY;
  });
});
