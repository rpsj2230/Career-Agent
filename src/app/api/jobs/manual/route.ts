import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ingestJobs } from "@/lib/jobs/ingest";

const Body = z.object({
  url: z.url(),
  title: z.string().min(2),
  company: z.string().min(1),
  description: z.string().min(20, "Paste the full job description"),
  country: z.string().length(2).optional(),
  location: z.string().optional(),
});

/** For postings that arrive by email alert or from login-gated portals (Naukri, Foundit, Shine...). */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid job", issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;
  const r = await ingestJobs(
    [{
      source: "manual", externalId: createHash("sha1").update(b.url).digest("hex").slice(0, 16), title: b.title, company: b.company,
      country: b.country?.toLowerCase(), location: b.location, url: b.url, description: b.description,
    }],
    36500,
  );
  if (r.inserted === 0) return NextResponse.json({ error: "Already in your list (same company, title and country)" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
