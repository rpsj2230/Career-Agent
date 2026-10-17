/**
 * Replies from employers. A few plain phrases are enough to tell the three that matter apart, and the message is matched to an
 * application by the company's name. Only a classification and the subject line are kept; the message body is read in memory and dropped.
 */
export type Reply = "interview" | "rejected" | "offer";
export type ReplyMail = { from: string; subject: string; text: string; date?: Date; messageId?: string };

const OFFER = /(pleased|delighted|happy|excited) to (extend|offer)|(extend|make) (you )?an? (job )?offer|offer of employment|offer letter/i;
const REJECT = /(unfortunately|regret to inform|sorry to (tell|inform)|we have decided (not )?to (move|proceed|pursue)|will not be (moving|proceeding)|not (be )?(moving|move) forward|other candidates|not selected|position has been filled|decided to (go|move) (with|forward with) (another|other)|no longer (being )?considered|not been successful)/i;
const INTERVIEW = /(invite you to (an )?interview|like to (schedule|arrange|invite)|schedule (a|an|your) (call|interview|conversation|chat)|interview (invitation|invite|request|availability)|phone screen|screening call|book (a|your) (time|slot)|calendly\.com|are you available (for|on)|your availability)/i;

/** What the message is, or null when it is anything else (a receipt, a newsletter, a note from a friend). */
export function classifyReply(m: Pick<ReplyMail, "subject" | "text">): Reply | null {
  const text = `${m.subject}\n${m.text.slice(0, 2500)}`;
  const reject = REJECT.test(text), interview = INTERVIEW.test(text), offer = OFFER.test(text);
  if (offer && !reject) return "offer";
  // "we'd like to schedule" and "unfortunately" in one message: the rejection wins only if nothing is being scheduled
  if (reject && !interview) return "rejected";
  if (interview && !reject) return "interview";
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(pvt|private|ltd|limited|inc|llc|llp|corp|corporation|co|pte|plc|gmbh|the)\b/g, "").replace(/\s+/g, " ").trim();

export type AppRef = { id: string; company: string; submittedAt: string | null; lifecycle: string };

/** The application a message is about: its company's name appears in the sender, subject or opening text. The most recent matching application wins. */
export function matchApplication(m: ReplyMail, apps: AppRef[]): AppRef | null {
  const hay = ` ${norm(`${m.from} ${m.subject} ${m.text.slice(0, 800)}`)} `;
  const hits = apps.filter((a) => { const c = norm(a.company); return c.length >= 3 && hay.includes(` ${c} `); });
  if (!hits.length) return null;
  const before = m.date ? hits.filter((a) => !a.submittedAt || new Date(a.submittedAt) <= m.date!) : hits;
  const pool = before.length ? before : hits;
  return [...pool].sort((x, y) => (y.submittedAt ?? "").localeCompare(x.submittedAt ?? ""))[0];
}

/** The new status, or null when the message must not change it: an offer is never downgraded, and you decide withdrawals. */
export function nextLifecycle(current: string, reply: Reply): string | null {
  if (current === "withdrawn" || current === "offer") return null;
  if (reply === "offer") return "offer";
  if (reply === "interview") return current === "interview" || current === "rejected" ? null : "interview";
  return current === "rejected" ? null : "rejected";
}
