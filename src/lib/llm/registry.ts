import "server-only";
import { generateText, Output } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { z } from "zod";
import { db, must } from "@/lib/db";
import type { Task } from "@/lib/types";
import { runWithFallback, selectCandidates, type ModelRow } from "./fallback";

async function loadCandidates(task: Task): Promise<ModelRow[]> {
  const rows = must(await db().from("model_configs").select("*"), "load model_configs") as ModelRow[];
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const usage = must(
    await db().from("model_usage").select("model_label").eq("ok", true).gte("created_at", since.toISOString()),
    "load model_usage",
  ) as { model_label: string }[];
  const usedToday: Record<string, number> = {};
  for (const u of usage) usedToday[u.model_label] = (usedToday[u.model_label] ?? 0) + 1;
  return selectCandidates(rows, task, process.env, usedToday);
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
  const candidates = await loadCandidates(opts.task);
  const { value, used } = await runWithFallback(
    opts.task,
    candidates,
    async (m) => {
      const provider = createOpenAICompatible({
        name: m.provider,
        baseURL: m.base_url,
        apiKey: m.api_key_env ? process.env[m.api_key_env] : undefined,
        supportsStructuredOutputs: false, // free tiers differ; schema is enforced by zod below
      });
      const res = await generateText({
        model: provider(m.model),
        system: opts.system,
        prompt: opts.prompt,
        output: Output.object({ schema: opts.schema }),
        temperature: 0.2,
      });
      return { output: res.output as z.infer<S>, usage: res.usage };
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
