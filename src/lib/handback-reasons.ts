/**
 * Why applications were handed back to you instead of being sent, grouped into a few plain reasons with what to do about each.
 * Pure (no database): src/lib/handback-store.ts reads the applications.
 */
export type ReasonId = "job_board" | "no_form" | "captcha" | "sign_in" | "question" | "submit" | "unsafe" | "other";

export type ReasonInfo = { id: ReasonId; title: string; why: string; action: string };

export const REASONS: Record<ReasonId, ReasonInfo> = {
  job_board: {
    id: "job_board", title: "The link goes to a job board, not the employer",
    why: "Adzuna and similar sites show a listing; their Apply link does not lead to a form the agent can fill (often a redirect or a bot check).",
    action: "Open the job and apply on the employer's own site. To have the agent apply by itself, add the employer's careers board (Greenhouse, Lever, Ashby, Workable) under Settings, Find.",
  },
  no_form: {
    id: "no_form", title: "No application form on the page",
    why: "The page needs a sign-in (for example MyCareersFuture needs Singpass), or the role is closed, or the form opens only after you log in.",
    action: "Apply yourself. These cannot be automated without your login.",
  },
  captcha: {
    id: "captcha", title: "A CAPTCHA or security check",
    why: "The site asked a person to prove they are not a robot. The agent never tries to get past one.",
    action: "Do these yourself.",
  },
  sign_in: {
    id: "sign_in", title: "The site asked for a sign-in",
    why: "The worker met a login page that it has no session for.",
    action: "Sign in once with the assistant on your computer (npm run assist:login); the cloud workers pass these to your computer.",
  },
  question: {
    id: "question", title: "A required question the agent could not answer",
    why: "The form asks something that is not in your profile or answer bank, and the AI model could not answer it safely.",
    action: "Open the application, answer it once; the answer is remembered for next time.",
  },
  submit: {
    id: "submit", title: "The form was filled but could not be sent",
    why: "The Submit button was missing, covered, or the site did not confirm the application.",
    action: "Open it and press Submit yourself, then check your email for a confirmation.",
  },
  unsafe: {
    id: "unsafe", title: "A page the assistant refused to use",
    why: "The page asked for a password (an account to create), payment or identity numbers, offered a file or a program to download, or did not look like the employer's own page.",
    action: "Check the page yourself. The assistant never creates accounts, types a password, pays anything or installs anything; apply there by hand only if it is the real employer.",
  },
  other: {
    id: "other", title: "Something else",
    why: "The worker stopped for a reason that is shown on the application itself.",
    action: "Open the application to read it.",
  },
};

export function classifyHandback(error: string | null | undefined): ReasonId {
  const e = error ?? "";
  if (/create an account|types? a password|never downloads|did not touch this page|payment or bank details|identity or tax number|wants a verification code/i.test(e)) return "unsafe";
  if (/job board|listing or search page/i.test(e)) return "job_board";
  if (/captcha|security check|verify you are human/i.test(e)) return "captcha";
  if (/asked for a sign-?in|sign-?in page|log ?in to|singpass/i.test(e)) return "sign_in";
  if (/no application form was found|role may be closed/i.test(e)) return "no_form";
  if (/^needs you:|required (box|question)|could not be answered/i.test(e)) return "question";
  if (/submit button|pressed submit|confirmation|final step/i.test(e)) return "submit";
  return "other";
}

export type ReasonLine = ReasonInfo & { count: number; portals: { portal: string; count: number }[] };

/** Count the handed-back applications per reason, biggest first, with the sites behind each. */
export function groupHandbacks(rows: { error: string | null; portal: string | null }[], portalLabel: (id: string) => string = (x) => x): ReasonLine[] {
  const m = new Map<ReasonId, { count: number; portals: Map<string, number> }>();
  for (const r of rows) {
    const id = classifyHandback(r.error);
    const g = m.get(id) ?? { count: 0, portals: new Map<string, number>() };
    g.count++;
    const p = r.portal ? portalLabel(r.portal) : "Unknown site";
    g.portals.set(p, (g.portals.get(p) ?? 0) + 1);
    m.set(id, g);
  }
  return [...m].map(([id, g]) => ({ ...REASONS[id], count: g.count, portals: [...g.portals].map(([portal, count]) => ({ portal, count })).sort((a, b) => b.count - a.count) })).sort((a, b) => b.count - a.count);
}
