import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { z } from "zod";
import { db, must } from "@/lib/db";
import type { Task } from "@/lib/types";
import { DEFAULT_MODELS } from "./defaults";
import { callStructured } from "./call";
import { runWithFallback, selectCandidates, type ModelRow } from "./fallback";
import { resolveKeys } from "./keys";

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
  const rows = must(await db().from("model_configs").select("*"), "load model_configs") as ModelRow[];
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
}): Promise<{ output: z.infer<S>; model: string }> {
  const { candidates, keys } = await loadCandidates(opts.task);
  const { value, used } = await runWithFallback(
    opts.task,
    candidates,
    async (m) => {
      return callStructured(buildModel(m, keys.get(m.label)), { schema: opts.schema, system: opts.system, prompt: opts.prompt });
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
  );
  return { output: value.output, model: used.label };
}
