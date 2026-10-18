export const LOCAL_MODELS = [
  { id: "qwen2.5:3b-instruct", label: "Qwen 2.5 3B (recommended: small and fast enough on the free runner)" },
  { id: "llama3.2:3b-instruct-q4_K_M", label: "Llama 3.2 3B" },
  { id: "qwen2.5:7b-instruct", label: "Qwen 2.5 7B (better answers, much slower on the free runner)" },
] as const;

export type LocalModelSetting = { mode: "off" | "when_needed" | "always"; model: string };

/**
 * Whether the scheduled runner should start the local model (Ollama) for this run. It costs a few minutes to download, so by default it is
 * started only when the hosted models are not working: no usable key, or most recent calls failing. "always" keeps it ready every time.
 */
export function localModelNeeded(s: LocalModelSetting, hostedUsable: number, recent: { failed: number; ok: number }): boolean {
  if (s.mode === "off") return false;
  if (s.mode === "always") return true;
  return hostedUsable === 0 || (recent.failed >= 5 && recent.failed > recent.ok);
}
