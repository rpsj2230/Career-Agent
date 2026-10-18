import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { z } from "zod";
import { db, must } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import type { Task } from "@/lib/types";
import { DEFAULT_MODELS } from "./defaults";
import { callStructured } from "./call";
import { runWithFallback, selectCandidates, timeoutFor, withLocalFallback, type ModelRow } from "./fallback";
import { resolveKeys } from "./keys";
import { defaultPrefer, orderForTier, tierOf, type Tier } from "./tiers";

let ensured = false;
/** Make sure the verified default models exist (never overwrites rows you edited). Runs once per server instance. */
export async function ensureDefaultModels() {
  if (ensured) return;
  must(await db().from("model_configs").upsert(DEFAULT_MODELS, { onConflict: "label", ignoreDuplicates: true }).select("label"), "ensure default models");
  ensured = true;
}

export function buildModel(m: ModelRow, apiKey: string | undefined) {
  return createOpenAICompatible({
    name: m.provider,
    baseURL: m.base_url,
    apiKey,
    supportsStructuredOutputs: false, // free tiers differ; the schema is enforced by zod
  })(m.model);
}

async function loadCandidates(task: Task): Promise<{ candidates: ModelRow[]; keys: Map<string, string> }> {
  await ensureDefaultModels();
  const rows = withLocalFallback(must(await db().from("model_configs").select("*"), "load model_configs") as ModelRow[], process.env);
  const keys = await resolveKeys(rows);
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const usage = must(
    await db().from("model_usage").select("model_label").eq("ok", true).gte("created_at", since.toISOString()),
    "load model_usage",
  ) as { model_label: string }[];
  const usedToday: Record<string, number> = {};
  for (const u of usage) usedToday[u.model_label] = (usedToday[u.model_label] ?? 0) + 1;
  // a saved/env key makes a model usable; a model with no env var name at all is treated as local (no key needed)
  const hasKey = (m: ModelRow) => keys.has(m.label) || m.api_key_env === null;
  return { candidates: selectCandidates(rows, task, hasKey, usedToday), keys };
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
}): Promise<{ output: z.infer<S>; model: string; tier: Tier }> {
  const loaded = await loadCandidates(opts.task);
  const keys = loaded.keys;
  const routing = (await getSetting("scoring").catch(() => null))?.routing !== false;
  const candidates = routing ? orderForTier(loaded.candidates, opts.prefer ?? defaultPrefer(opts.task)) : loaded.candidates;
  const { value, used } = await runWithFallback(
    opts.task,
    candidates,
    async (m, remaining) => {
      const own = timeoutFor(m);
      return callStructured(buildModel(m, keys.get(m.label)), { schema: opts.schema, system: opts.system, prompt: opts.prompt, timeoutMs: remaining === undefined ? own : Math.min(own ?? Infinity, remaining) });
    },
    async (m, ok, ms, error) => {
      await db().from("model_usage").insert({
        model_config_id: m.id,
        model_label: m.label,
        task: opts.task,
        job_id: opts.jobId ?? null,
        latency_ms: ms,
        ok,
        error: error ?? null,
      });
    },
    opts.budgetMs === undefined ? undefined : Date.now() + opts.budgetMs,
  );
  return { output: value.output, model: used.label, tier: tierOf(used) };
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
  const stored = usable.filter((l) => k.readable.includes(l));
  const envOnly = usable.filter((l) => !k.readable.includes(l) && rows.find((m) => m.label === l)?.api_key_env !== null);
  let message: string | null = null;
  if (usable.length === 0) {
    message = k.unreadable.length
      ? `No model can be used here: ${k.unreadable.length} key(s) saved in the app (${k.unreadable.join(", ")}) cannot be read in this environment, because SUPABASE_SERVICE_ROLE_KEY${k.hasShared ? " and CRON_SECRET differ" : " differs (and CRON_SECRET is not set)"} from the ones used when they were saved. Open the app once (the hourly check re-saves the keys under CRON_SECRET), or set GEMINI_API_KEY / GROQ_API_KEY as GitHub secrets.`
      : "No model has an API key. Add a key on the Models page (or set GEMINI_API_KEY / GROQ_API_KEY as secrets).";
  }
  return { usable, unreadable: k.unreadable, message, envOnly, stored };
}
