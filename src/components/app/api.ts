import { toast } from "sonner";

/** JSON request that toasts the server's error text. Returns the parsed body, or null on failure. */
export async function call<T = Record<string, unknown>>(url: string, method: string, body?: unknown, success?: string): Promise<T | null> {
  try {
    const res = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? `Request failed (${res.status})`); return null; }
    if (success) toast.success(success);
    return data as T;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Network error");
    return null;
  }
}
