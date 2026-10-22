import { liveNow, type Live, type Recent } from "./assistant-live";
/** The "Run assistant now" button leaves a request; the watcher on your computer answers it. Pure, so both sides share the rules. */
export type AssistantRequest = { at: string; handled_at?: string | null; done?: number | null; note?: string | null };
export type Heartbeat = { at: string; round?: { at: string; submitted: number; handedBack: number; left: Record<string, number> }; live?: Live | null; recent?: Recent[]; signedIn?: string[]; version?: string };

/** A request is open until the watcher has handled something at or after it. */
export const requestPending = (r: AssistantRequest | null | undefined): boolean => !!r?.at && (!r.handled_at || new Date(r.handled_at) < new Date(r.at));

/** The watcher beats every half minute; three minutes of silence means it is not running. */
export const watcherOnline = (hb: Heartbeat | null | undefined, now = new Date(), withinMs = 3 * 60_000): boolean => !!hb?.at && now.getTime() - new Date(hb.at).getTime() < withinMs;

export type AssistantPanel = { online: boolean; pending: boolean; text: string; live: Live | null; recent: Recent[] };

export const SETUP_GUIDE_URL = "https://github.com/rpsj2230/Career-Agent/blob/main/docs/LAPTOP_SETUP.md";

/** What the last round did and why the rest was left, e.g. " Last round: 0 sent, 2 handed back, 31 left for later (Automatic LinkedIn applying is switched off in Settings: 31)." */
export function roundText(hb: Heartbeat | null): string {
  const r = hb?.round;
  if (!r) return "";
  const left = Object.entries(r.left).sort((a, b) => b[1] - a[1]);
  const total = left.reduce((n, [, c]) => n + c, 0);
  return ` Last round: ${r.submitted} sent, ${r.handedBack} handed back${total ? `, ${total} left for later (${left.map(([why, c]) => `${why}: ${c}`).join("; ")})` : ""}.`;
}

export function panelText(i: { hb: Heartbeat | null; req: AssistantRequest | null; waiting: number; now?: Date }): AssistantPanel {
  const now = i.now ?? new Date();
  const online = watcherOnline(i.hb, now), pending = requestPending(i.req);
  const extra = { live: liveNow(i.hb, now), recent: online ? (i.hb?.recent ?? []).slice(0, 8) : [] };
  const q = `${i.waiting} application${i.waiting === 1 ? " is" : "s are"} waiting for it`;
  const last = i.req?.handled_at ? ` Last run: ${i.req.note ?? `${i.req.done ?? 0} submitted`}.` : "";
  const seen = i.hb?.at ? `Last seen ${Math.max(1, Math.round((now.getTime() - new Date(i.hb.at).getTime()) / 60_000))} minutes ago.` : "It has never reported in.";
  if (online && pending) return { online, pending, text: "Run requested. The assistant on your computer will start within about 30 seconds.", ...extra };
  if (online) return { online, pending, text: `The assistant is running on your computer; ${q}.${last}${roundText(i.hb)}`, ...extra };
  const how = " Having the computer switched on is not enough: the assistant is a small program that must be started on it once (about 10 minutes, step by step in the setup guide below). After that this card turns green.";
  if (pending) return { online, pending, text: `Run requested, but the assistant is not running on your computer, so the request is waiting. ${seen}${how}`, ...extra };
  return { online, pending, text: `The assistant is not running on your computer; ${q}. ${seen}${last}${how}`, ...extra };
}
