import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { automationHealth } from "@/lib/automation-health";

/** Shown on the dashboard only when something stops the automatic pipeline from working; links to the checklist with the fixes. */
export async function AutomationBanner() {
  const { checks, status } = await automationHealth().catch(() => ({ checks: [], status: "ok" as const }));
  const bad = checks.filter((c) => c.status === "fail" || c.status === "warn").slice(0, 4);
  if (status === "ok" || bad.length === 0) return null;
  return (
    <Alert variant={status === "fail" ? "destructive" : "default"} className={status === "warn" ? "border-amber-500" : ""}>
      <AlertTitle>{status === "fail" ? "Automation is not fully working" : "Automation needs a look"}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-5">{bad.map((c) => <li key={c.id}><b>{c.label}:</b> {c.detail}</li>)}</ul>
        <Link className="mt-1 inline-block underline" href="/system#automation">Open the checklist with the fixes</Link>
      </AlertDescription>
    </Alert>
  );
}
