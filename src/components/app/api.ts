import { toast } from "sonner";

/** How long a request may take before the page stops waiting and says so, instead of staying silent. */
export const REQUEST_TIMEOUT_MS = 30_000;

export type CallResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** JSON request that never hangs silently: a server error, a network error or no answer within 30 s all come back as a readable message. */
export async function callDetailed<T = Record<string, unknown>>(url: string, method: string, body?: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<CallResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? `Request failed (${res.status})` };
    return { ok: true, data: data as T };
  } catch (e) {
    if (controller.signal.aborted) return { ok: false, error: `The server did not answer within ${timeoutMs / 1000} seconds. Nothing was confirmed saved; try again.` };
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  } finally {
    clearTimeout(timer);
  }
}

/** JSON request that toasts the server's error text. Returns the parsed body, or null on failure. */
export async function call<T = Record<string, unknown>>(url: string, method: string, body?: unknown, success?: string): Promise<T | null> {
  const r = await callDetailed<T>(url, method, body);
  if (!r.ok) { toast.error(r.error); return null; }
  if (success) toast.success(success);
  return r.data;
}
