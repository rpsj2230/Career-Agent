import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { automationHealth } from "@/lib/automation-health";
import { ActionButton } from "./action-button";

const STYLE = { ok: "bg-green-600 text-white", warn: "bg-amber-500 text-white", fail: "bg-red-600 text-white" } as const;
const WORD = { ok: "OK", warn: "Check", fail: "Fix" } as const;

/** The automation checklist: every condition the automatic find-score-prepare-apply flow depends on, with the fix for each. */
export async function AutomationCard() {
  const { checks, status } = await automationHealth();
  return (
    <Card id="automation">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Automation <Badge className={STYLE[status]}>{status === "ok" ? "all good" : status === "warn" ? "needs a look" : "needs fixing"}</Badge></CardTitle>
        <CardDescription>What has to be true for jobs to be found, scored, prepared and (if you allow it) applied for without you. The hourly GitHub check and a daily backup check from Vercel keep watching this and message you on Telegram if something breaks.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid gap-2">
          {checks.map((c) => (
            <li key={c.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-center gap-2"><Badge className={STYLE[c.status]}>{WORD[c.status]}</Badge><b>{c.label}</b></div>
              <p className="mt-1">{c.detail}</p>
              {c.fix && c.status !== "ok" && <p className="mt-1 text-muted-foreground"><b>How to fix:</b> {c.fix}</p>}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <ActionButton endpoint="/api/automation/test" method="POST" variant="outline" success="GitHub connection checked">Test GitHub connection</ActionButton>
          <ActionButton endpoint="/api/run/discover" method="POST" success="Started">Run a full test now (search + score)</ActionButton>
        </div>
      </CardContent>
    </Card>
  );
}
