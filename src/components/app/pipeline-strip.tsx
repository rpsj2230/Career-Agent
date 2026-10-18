import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { counts } from "@/lib/queries";

/** The whole journey of a job on one line, with how many are at each step and where to see them. */
export async function PipelineStrip({ scheduleLine }: { scheduleLine?: string }) {
  const c = await counts().catch(() => null);
  if (!c) return null;
  const step = (n: number, title: string, who: string, href: string, hint: string) => (
    <Link href={href} className="group rounded-md border p-3 hover:bg-accent">
      <div className="text-2xl font-semibold leading-none">{n}</div>
      <div className="mt-1 text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{who}</div>
    </Link>
  );
  return (
    <Card>
      <CardContent className="grid gap-3 pt-4">
        <div className="grid gap-2 md:grid-cols-5">
          {step(c.fresh, "Found, not scored", "Step 1 · search", "/jobs?view=new", "Waiting to be scored")}
          {step(c.queued, "Matched your profile", "Step 2 · score", "/jobs", "Resume not made yet")}
          {step(c.prepared, "Resume & answers ready", "Step 3 · prepare", "/applications", "Waiting for your approval")}
          {step(c.sent7, "Applied (7 days)", "Step 4 · apply", "/applications?status=submitted", "Sent")}
          {step(c.failed, "Needs you", "Hand-back", "/applications?status=needs_input", "Question or error")}
        </div>
        <p className="text-xs text-muted-foreground">
          {scheduleLine ?? "Your schedule does steps 1 to 3 on its own (Schedules), and step 4 once you approve, or automatically if you switch Auto-Apply on in Settings."}
          {" "}You can also run a step by hand with the buttons above.
        </p>
      </CardContent>
    </Card>
  );
}
