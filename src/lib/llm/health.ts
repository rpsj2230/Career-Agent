/** A plain answer to "is this model working?", from its recent calls (pure, so it is testable). */
export type Call = { ok: boolean; error?: string | null; at: string };
export type ModelHealth = { status: "working" | "unstable" | "failing" | "limit" | "unused" | "no_key" | "off"; label: string; hint: string; lastError: string | null; lastOkAt: string | null };

/** What an error message from a provider usually means, in words you can act on. */
export function explainError(e: string | null | undefined): string {
  const m = (e ?? "").toLowerCase();
  if (!m) return "";
  if (/429|rate.?limit|quota|resource.?exhausted|too many requests|tokens per|requests per/.test(m)) return "Rate limit or free quota used up. Temporary: it recovers by itself (minutes for per-minute limits, tomorrow for daily limits).";
  if (/401|403|unauthori[sz]ed|invalid.*(key|api)|api key|permission|forbidden|authentication/.test(m)) return "The provider rejected the key. Paste the key again on Edit (check for spaces) and press Test.";
  if (/404|not found|decommission|does not exist|model.*(unavailable|not supported)|deprecated/.test(m)) return "The model name is not available at the provider (renamed or retired). Edit it and use a current model id from the provider's website.";
  if (/timeout|timed out|did not answer|econn|enotfound|network|fetch failed|socket/.test(m)) return "The provider did not answer in time. Usually temporary.";
  if (/schema|json|no object generated|did not match|parse/.test(m)) return "The model answered, but not in the format needed. A small or weak model; keep it as a fallback rather than a first choice.";
  return "See the error text below.";
}

export function modelHealth(i: { enabled: boolean; keyed: boolean; todayOk: number; todayBad: number; dailyCap: number | null; calls: Call[] /* newest first */ }): ModelHealth {
  const lastErr = i.calls.find((c) => !c.ok)?.error ?? null;
  const lastOkAt = i.calls.find((c) => c.ok)?.at ?? null;
  const base = { lastError: lastErr, lastOkAt };
  if (!i.enabled) return { ...base, status: "off", label: "Switched off", hint: "Not used. Switch it on in Edit." };
  if (!i.keyed) return { ...base, status: "no_key", label: "No key", hint: "Add its API key in Edit to use it." };
  if (i.dailyCap && i.todayOk >= i.dailyCap) return { ...base, status: "limit", label: "Daily limit reached", hint: `Used its ${i.dailyCap} calls for today; the next model takes over until tomorrow.` };
  if (i.calls.length === 0) return { ...base, status: "unused", label: "Not used yet", hint: "No calls recorded. Press Test to check it." };
  const recent = i.calls.slice(0, 10);
  const okCount = recent.filter((c) => c.ok).length;
  if (i.calls[0].ok) return { ...base, status: "working", label: "Working", hint: `${okCount} of the last ${recent.length} calls succeeded.` };
  if (okCount === 0) return { ...base, status: "failing", label: "Not working", hint: explainError(lastErr) };
  return { ...base, status: "unstable", label: "Unstable", hint: `${okCount} of the last ${recent.length} calls succeeded; the latest failed. ${explainError(lastErr)}`.trim() };
}
