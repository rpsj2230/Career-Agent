/** The "Run assistant now" button leaves a request; the watcher on your computer answers it. Pure, so both sides share the rules. */
export type AssistantRequest = { at: string; handled_at?: string | null; done?: number | null; note?: string | null };
export type Heartbeat = { at: string };

/** A request is open until the watcher has handled something at or after it. */
export const requestPending = (r: AssistantRequest | null | undefined): boolean => !!r?.at && (!r.handled_at || new Date(r.handled_at) < new Date(r.at));

/** The watcher beats every half minute; three minutes of silence means it is not running. */
export const watcherOnline = (hb: Heartbeat | null | undefined, now = new Date(), withinMs = 3 * 60_000): boolean => !!hb?.at && now.getTime() - new Date(hb.at).getTime() < withinMs;

export type AssistantPanel = { online: boolean; pending: boolean; text: string };

export function panelText(i: { hb: Heartbeat | null; req: AssistantRequest | null; waiting: number; now?: Date }): AssistantPanel {
  const now = i.now ?? new Date();
  const online = watcherOnline(i.hb, now), pending = requestPending(i.req);
  const q = `${i.waiting} application${i.waiting === 1 ? " is" : "s are"} waiting for it`;
  const last = i.req?.handled_at ? ` Last run: ${i.req.note ?? `${i.req.done ?? 0} submitted`}.` : "";
  if (online && pending) return { online, pending, text: "Run requested. The assistant on your computer will start within about 30 seconds." };
  if (online) return { online, pending, text: `The assistant is running on your computer; ${q}.${last}` };
  if (pending) return { online, pending, text: "Run requested, but the assistant is not running on your computer. It will start as soon as the computer is on and the assistant is started (see Apply assistant setup)." };
  return { online, pending, text: `The assistant is not running (your computer is off or it was not started); ${q}.${last}` };
}
