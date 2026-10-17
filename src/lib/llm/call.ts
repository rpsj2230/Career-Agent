import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from "ai";
import { z } from "zod";

/**
 * Free models often wrap JSON in a code fence or add a sentence around it, or leave a trailing comma. Pull the object
 * out and tidy it so one cosmetic slip does not cost a whole model attempt. Returns null when nothing usable is there.
 */
export function repairJson(text: string): string | null {
  const unfenced = text.replace(/```(?:json|JSON)?/g, "");
  const start = unfenced.indexOf("{"), end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const body = unfenced.slice(start, end + 1).replace(/,(\s*[}\]])/g, "$1");
  try { JSON.parse(body); return body; } catch { return null; }
}

export const MODEL_TIMEOUT_MS = 90_000;

/**
 * What every model is told about the answer it must give. Providers differ: some only switch on "JSON mode" when the word JSON appears
 * in the messages (Groq refuses the request otherwise), and none of them is given the field names by the JSON mode itself, so a model
 * that has not seen the structure invents its own. The schema is therefore spelled out in the instructions.
 */
export function jsonInstructions(schema: z.ZodType): string {
  let shape = "";
  try { const j = z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>; delete j.$schema; shape = JSON.stringify(j); } catch { /* describe it generally instead */ }
  const tail = shape && shape.length <= 12_000 ? ` The JSON must match this JSON Schema exactly (use these field names; use an empty string or empty list when something is not present): ${shape}` : "";
  return `\n\nRespond with a single JSON object only: no markdown, no code fence, no text before or after it.${tail}`;
}

/**
 * One structured-output call. A hung provider is cut off after `timeoutMs` so the next model in the chain is tried,
 * and the SDK's own retries are off (fallback to another model is faster than waiting out a rate limit).
 */
export async function callStructured<S extends z.ZodType>(model: LanguageModel, o: { schema: S; system: string; prompt: string; timeoutMs?: number }) {
  const ms = o.timeoutMs ?? MODEL_TIMEOUT_MS;
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // abort the request AND stop waiting, so a provider that ignores the signal still cannot hold the run hostage
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { const err = new Error(`The model did not answer within ${Math.round(ms / 1000)}s`); ctrl.abort(err); reject(err); }, ms); });
  try {
    const res = await Promise.race([generateText({
      model, system: o.system + jsonInstructions(o.schema), prompt: o.prompt, temperature: 0.2, maxRetries: 0, abortSignal: ctrl.signal,
      output: Output.object({ schema: o.schema }),
    }), deadline]);
    return { output: res.output as z.infer<S>, usage: res.usage };
  } catch (e) {
    // the model answered but the text was not clean JSON: try to rescue what it said before giving up on it
    if (NoObjectGeneratedError.isInstance(e) && e.text) {
      const fixed = repairJson(e.text);
      const parsed = fixed ? o.schema.safeParse(JSON.parse(fixed)) : null;
      if (parsed?.success) return { output: parsed.data as z.infer<S>, usage: e.usage };
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
