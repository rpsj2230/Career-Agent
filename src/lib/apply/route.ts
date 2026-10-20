import { AUTO_APPLY_ATS, ATS_LABEL, parseAtsUrl, type Ats } from "@/lib/jobs/ats";

/**
 * Who sends an application, in plain words:
 *  - cloud: Greenhouse, Lever, Ashby and Workable forms are public, so GitHub's computer fills and sends them; no login and no laptop needed
 *  - assistant: LinkedIn, Naukri, Indeed and similar need YOUR signed-in browser, so the assistant on your computer does it
 *  - assistant also covers every other employer site: the assistant fills and submits the form there
 */
export type ApplyRoute = { kind: "cloud" | "assistant" | "manual" | "email"; label: string; detail: string; /** an employer's own page, not a known portal: the assistant fills whatever form it finds */ generic?: boolean };

const ASSISTED_TYPES = new Set(["linkedin", "portal"]);

/** How an emailed application relates to the normal route: the email IS the application, or goes in addition to it. */
export type EmailMode = "only" | "also";
export function emailModeFor(job: { apply_type?: string | null; url?: string | null }, hasContact: boolean): EmailMode | null {
  if (!hasContact) return null;
  const base = applyRoute(job);
  return job.apply_type === "email" || base.kind === "manual" || base.generic ? "only" : "also";
}

export function applyRoute(job: { apply_type?: string | null; url?: string | null; portal?: string | null; emailMode?: EmailMode | null }): ApplyRoute {
  const base = baseRoute(job);
  if (job.emailMode === "only") return { kind: "email", label: "Email to the employer", detail: "The posting asks for applications by email, so the app emails your resume, cover letter and a message explaining your fit from your own mailbox." };
  if (job.emailMode === "also") return { ...base, label: `${base.label} + email`, detail: `${base.detail} The posting also lists an email address, so the app emails your resume and cover letter there too, which gives a second chance of being seen.` };
  return base;
}

function baseRoute(job: { apply_type?: string | null; url?: string | null; portal?: string | null }): ApplyRoute {
  const ats: Ats | null = (job.url ? parseAtsUrl(job.url)?.ats : null) ?? (job.apply_type === "greenhouse" || job.apply_type === "lever" ? job.apply_type : null);
  if (ats && (AUTO_APPLY_ATS as string[]).includes(ats)) return { kind: "cloud", label: `Automatic · ${ATS_LABEL[ats]}`, detail: `Sent automatically from the cloud (${ATS_LABEL[ats]} needs no login), after you approve it or if your schedule applies by itself.` };
  if (job.apply_type && ASSISTED_TYPES.has(job.apply_type)) return { kind: "assistant", label: "Assistant · your computer", detail: "This site needs you signed in, so the assistant on your computer opens it and fills the form. It waits in the queue while your computer is off." };
  return { kind: "assistant", generic: true, label: "Assistant · employer site", detail: "The employer's own page. The assistant on your computer opens it, fills every question from your profile (answering open questions from your real experience) and submits. If the page needs a CAPTCHA or a sign-in you do not have, it is handed back with that exact reason." };
}

export type NextStep = { text: string; href?: string; action?: "assistant" };

/** What you should do with an application right now, from its status and route. */
export function nextStep(status: string, route: ApplyRoute, id: string): NextStep {
  const href = `/applications/${id}`;
  switch (status) {
    case "prepared": return { text: route.kind === "email" ? "Review the email and approve" : "Review and approve", href };
    case "approved": return route.kind === "cloud" ? { text: "Sending from the cloud soon" } : { text: "Approved, waiting for the assistant" };
    case "submitting": return { text: "Being sent now" };
    case "assisted_pending": return route.kind === "assistant" ? { text: "Apply with assistant", href, action: "assistant" } : { text: "Review and apply yourself", href };
    case "needs_input": return { text: route.kind === "email" ? "Fix and send the email" : "Answer and finish", href };
    case "failed": return { text: "See why and retry", href };
    case "submitted": return { text: "Done", href };
    default: return { text: "Open", href };
  }
}
