import { z } from "zod";

/** Env var names a model row may reference. Anything that is not an obvious provider key is refused. */
const FORBIDDEN = /^(SUPABASE|APP_|CRON_|GITHUB_DISPATCH|VERCEL|NEXT_|NODE_|PATH$)/;
export const API_KEY_ENV = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*_(API_KEY|KEY|TOKEN)$/, "Use an env var name ending in _API_KEY, _KEY or _TOKEN")
  .refine((n) => !FORBIDDEN.test(n), "That environment variable is reserved");

const baseUrl = z.string().refine((u) => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || (x.protocol === "http:" && ["localhost", "127.0.0.1"].includes(x.hostname));
  } catch { return false; }
}, "Base URL must be https (or http on localhost)");

export const ModelInput = z.object({
  label: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes only"),
  provider: z.string().min(2).max(30),
  base_url: baseUrl,
  model: z.string().min(1).max(120),
  api_key_env: API_KEY_ENV.nullable(),
  tasks: z.array(z.enum(["score", "tailor", "extract"])).min(1),
  priority: z.number().int().min(1).max(1000),
  daily_cap: z.number().int().min(1).nullable(),
  enabled: z.boolean(),
  notes: z.string().max(300).nullish(),
});
export type ModelInput = z.infer<typeof ModelInput>;
