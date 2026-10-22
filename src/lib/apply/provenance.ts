/**
 * Who applied for a job, and how the app knows. Read only from what was recorded (the application's events and submission record), never guessed:
 * where nothing was recorded the answer says so, rather than naming a likely culprit.
 */
export type EventRow = { kind: string; at: string; detail?: Record<string, unknown> | null };
export type AppFacts = { status: string; method?: string | null; submitted_at?: string | null; submission?: { confirmation?: { text?: string } | null; final_url?: string | null } | null };

export type Who = "you" | "you_assistant" | "assistant_computer" | "assistant_cloud" | "cloud_worker" | "email" | "receipt" | "unknown";
export type Provenance = {
  who: Who;
  /** one plain sentence: who sent it */
  headline: string;
  /** how sure the app is */
  proof: { level: "confirmed" | "claimed" | "unchecked"; text: string };
  /** where the application was filed, when recorded */
  page: string | null;
  at: string | null;
};

const WORKERS: Record<string, { who: Who; text: string }> = {
  computer: { who: "assistant_computer", text: "the assistant on your computer (the Mac), hands-free" },
  github: { who: "assistant_cloud", text: "the cloud assistant running on GitHub, hands-free" },
  oracle: { who: "assistant_cloud", text: "the always-on machine's assistant, hands-free" },
};

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

export function applicationProvenance(app: AppFacts, events: EventRow[]): Provenance | null {
  if (app.status !== "submitted") return null;
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const last = (kind: string) => [...sorted].reverse().find((e) => e.kind === kind);
  const confirmation = app.submission?.confirmation?.text?.trim();
  const page = app.submission?.final_url ?? null;
  const proofFor = (): Provenance["proof"] => confirmation
    ? { level: "confirmed", text: `The employer's page said: "${confirmation.slice(0, 160)}"` }
    : { level: "unchecked", text: "No confirmation message from the employer was recorded for this application." };

  const marked = last("marked_submitted");
  const handsFree = last("submitted_hands_free");
  const assisted = last("submitted_with_assistant");
  const cloud = last("submitted");
  const emailed = last("email_sent");

  // the most recent recorded submission wins
  const candidates = [marked && { e: marked, k: "marked" }, handsFree && { e: handsFree, k: "hands" }, assisted && { e: assisted, k: "assisted" }, cloud && { e: cloud, k: "cloud" }, emailed && { e: emailed, k: "email" }]
    .filter((x): x is { e: EventRow; k: string } => !!x)
    .sort((a, b) => b.e.at.localeCompare(a.e.at));
  const top = candidates[0];

  if (!top) return { who: "unknown", headline: "Nothing recorded says who sent it", proof: { level: "unchecked", text: "This application is marked submitted, but no event recorded who or what submitted it (it predates detailed records, or its history was cleared)." }, page, at: day(app.submitted_at) };

  switch (top.k) {
    case "marked": {
      const why = typeof top.e.detail?.why === "string" ? top.e.detail.why : null;
      if (why) return { who: "receipt", headline: "Applied on the portal itself, not by this app", proof: { level: "claimed", text: `${why}. The app did not send it and did not see the employer's confirmation.` }, page, at: day(app.submitted_at) ?? day(top.e.at) };
      return { who: "you", headline: "You marked it as submitted", proof: { level: "unchecked", text: "You pressed “I have submitted it”. The app did not send it and has no confirmation to check." }, page, at: day(top.e.at) };
    }
    case "assisted":
      return { who: "you_assistant", headline: "You, with the assistant on your computer (you pressed Submit)", proof: proofFor(), page, at: day(top.e.at) };
    case "hands": {
      const started = [...sorted].reverse().find((e) => e.kind === "worker_started" && e.at <= top.e.at);
      const w = WORKERS[String(started?.detail?.worker ?? "computer")] ?? { who: "assistant_computer" as Who, text: `the assistant "${String(started?.detail?.worker)}", hands-free` };
      return { who: w.who, headline: `Sent automatically by ${w.text}`, proof: proofFor(), page, at: day(top.e.at) };
    }
    case "cloud":
      return { who: "cloud_worker", headline: "Sent automatically by the cloud Apply worker (GitHub), no sign-in needed", proof: proofFor(), page: (typeof top.e.detail?.url === "string" ? top.e.detail.url : null) ?? page, at: day(top.e.at) };
    default: {
      const to = typeof top.e.detail?.to === "string" ? top.e.detail.to : null;
      return { who: "email", headline: `Emailed from your mailbox${to ? ` to ${to}` : ""}`, proof: { level: "claimed", text: "The mail server accepted the message. Whether anyone read it is not known." }, page: null, at: day(top.e.at) };
    }
  }
}
