import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { z } from "zod";
import { db, must } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import type { Task } from "@/lib/types";
import { DEFAULT_MODELS } from "./defaults";
import { callStructured } from "./call";
import { AllModelsFailed, runWithFallback, selectCandidates, timeoutFor, withLocalFallback, type ModelRow } from "./fallback";
import { baseEnv, envLabel, MAX_KEYS, resolveKeyPool, resolveKeys, slotEnv } from "./keys";
import { defaultPrefer, orderForTier, tierOf, type Tier } from "./tiers";
import { expandByKeys, nextTick, parking, spreadOrder } from "./spread";

let ensured = false;
/** Make sure the verified default models exist (never overwrites rows you edited). Runs once per server instance. */
export async function ensureDefaultModels() {
  if (ensured) return;
  must(await db().from("model_configs").upsert(DEFAULT_MODELS, { onConflict: "label", ignoreDuplicates: true }).select("label"), "ensure default models");
  // Earlier versions added a separate row for each extra key (labels ending -k2 to -k5). Keys are now a pool per provider, so those rows are removed.
  const oldSlotEnvs = ["GEMINI_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY"].flatMap((b) => [2, 3, 4, 5].map((n) => `${b}_${n}`));
  await db().from("model_configs").delete().in("api_key_env", oldSlotEnvs).like("label", "%-k_");
  ensured = true;
}

type KeyedModel = ModelRow & { realLabel: string; key: string | undefined };

export function buildModel(m: ModelRow, apiKey: string | undefined) {
  return createOpenAICompatible({
    name: m.provider,
    baseURL: m.base_url,
    apiKey,
    supportsStructuredOutputs: false, // free tiers differ; the schema is enforced by zod
  })(m.model);
}

async function loadCandidates(task: Task): Promise<{ candidates: ModelRow[]; pool: Map<string, string[]> }> {
  await ensureDefaultModels();
  const rows = withLocalFallback(must(await db().from("model_configs").select("*"), "load model_configs") as ModelRow[], process.env);
  const pool = await resolveKeyPool(rows);
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const usage = must(
    await db().from("model_usage").select("model_label").eq("ok", true).gte("created_at", since.toISOString()),
    "load model_usage",
  ) as { model_label: string }[];
  const usedToday: Record<string, number> = {};
  for (const u of usage) usedToday[u.model_label] = (usedToday[u.model_label] ?? 0) + 1;
  // a saved/env key makes a model usable; a model with no env var name at all is treated as local (no key needed)
  const hasKey = (m: ModelRow) => pool.has(m.label) || m.api_key_env === null;
  // with several keys a model's allowance is several times larger (each key has its own), so its daily cap grows with the number of keys
  const perKey: Record<string, number> = {};
  for (const [label, used] of Object.entries(usedToday)) perKey[label] = Math.floor(used / Math.max(1, pool.get(label)?.length ?? 1));
  return { candidates: selectCandidates(rows, task, hasKey, perKey), pool };
}

/**
 * Run a structured-output request on the best available model, falling back down the
 * priority list on any error (rate limit, bad JSON, schema mismatch). Every attempt is logged.
 */
export async function runStructured<S extends z.ZodType>(opts: {
  task: Task;
  schema: S;
  system: string;
  prompt: string;
  jobId?: string;
  /** which tier to try first (default: fast for scoring, strong for writing) */
  prefer?: Tier;
  /** total time allowed across all attempts (for a web request that the host cuts off); each attempt gets what is left */
  budgetMs?: number;
  /** try only models that are not cooling down after a failure (an unattended caller that must not wait on dead models) */
  skipParked?: boolean;
}): Promise<{ output: z.infer<S>; model: string; tier: Tier }> {
  const loaded = await loadCandidates(opts.task);
  const routing = (await getSetting("scoring").catch(() => null))?.routing !== false;
  const ordered = routing ? orderForTier(loaded.candidates, opts.prefer ?? defaultPrefer(opts.task)) : loaded.candidates;
  // calls running at the same time start on different models, and a model that just failed goes to the back for a while
  // one entry per model and key: five keys on a provider means five entries for each of its models
  const expanded: KeyedModel[] = expandByKeys(ordered, (l) => loaded.pool.get(l));
  const ordered2 = spreadOrder(expanded, { tierOf: (m) => tierOf({ label: m.realLabel, model: m.model }), tick: nextTick(), parked: parking.isParked });
  const candidates = opts.skipParked ? ordered2.filter((m) => !parking.isParked(m.label)) : ordered2;
  if (opts.skipParked && candidates.length === 0 && ordered2.length > 0) {
    throw new AllModelsFailed(opts.task, [{ label: "all models", error: "every model is cooling down after recent failures (rate limit, no access or an error); tried again in a few minutes" }]);
  }
  const { value, used } = await runWithFallback(
    opts.task,
    candidates,
    async (m, remaining) => {
      const own = timeoutFor(m);
      return callStructured(buildModel(m, m.key), { schema: opts.schema, system: opts.system, prompt: opts.prompt, timeoutMs: remaining === undefined ? own : Math.min(own ?? Infinity, remaining) });
    },
    async (m, ok, ms, error) => {
      if (ok) parking.clear(m.label); else parking.park(m.label, error ?? "");
      await db().from("model_usage").insert({
        model_config_id: m.id,
        model_label: m.realLabel,
        task: opts.task,
        job_id: opts.jobId ?? null,
        latency_ms: ms,
        ok,
        error: error ?? null,
      });
    },
    opts.budgetMs === undefined ? undefined : Date.now() + opts.budgetMs,
  );
  return { output: value.output, model: used.realLabel, tier: tierOf({ label: used.realLabel, model: used.model }) };
}

/**
 * Whether a model call can work in THIS environment: how many enabled models have a usable key, and which saved keys cannot be read here.
 * The scheduled run prints and reports this first, so "no model available" always comes with its reason.
 */
export async function modelReadiness(): Promise<{ usable: string[]; unreadable: string[]; message: string | null; envOnly: string[]; stored: string[] }> {
  await ensureDefaultModels();
  const rows = withLocalFallback(must(await db().from("model_configs").select("*"), "load model_configs") as ModelRow[], process.env);
  const keys = await resolveKeys(rows);
  const { keyReadiness } = await import("./keys");
  const k = await keyReadiness();
  const usable = rows.filter((m) => (m as ModelRow & { enabled?: boolean }).enabled !== false && (keys.has(m.label) || m.api_key_env === null)).map((m) => m.label);
  // keys that only an environment variable provides (for example in Vercel) are not seen by the GitHub runner
  const inStore = (l: string) => {
    const m = rows.find((r) => r.label === l);
    const slots = m?.api_key_env ? Array.from({ length: MAX_KEYS }, (_, i) => envLabel(slotEnv(baseEnv(m.api_key_env as string), i + 1)) as string) : [];
    return k.readable.includes(l) || slots.some((x) => k.readable.includes(x));
  };
  const stored = usable.filter(inStore);
  const envOnly = usable.filter((l) => !inStore(l) && rows.find((m) => m.label === l)?.api_key_env !== null);
  let message: string | null = null;
  if (usable.length === 0) {
    message = k.unreadable.length
      ? `No model can be used here: ${k.unreadable.length} key(s) saved in the app (${k.unreadable.join(", ")}) cannot be read in this environment, because SUPABASE_SERVICE_ROLE_KEY${k.hasShared ? " and CRON_SECRET differ" : " differs (and CRON_SECRET is not set)"} from the ones used when they were saved. Open the app once (the hourly check re-saves the keys under CRON_SECRET), or set GEMINI_API_KEY / GROQ_API_KEY as GitHub secrets.`
      : "No model has an API key. Add a key on the Models page (or set GEMINI_API_KEY / GROQ_API_KEY as secrets).";
  }
  return { usable, unreadable: k.unreadable, message, envOnly, stored };
}
