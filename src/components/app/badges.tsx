import { Badge } from "@/components/ui/badge";
import { APP_STATUS_LABEL } from "@/lib/filters";
import { portalLabel } from "@/lib/jobs/portal";

export function ScoreBadge({ score }: { score?: number }) {
  if (score === undefined) return <Badge variant="outline">unscored</Badge>;
  const cls = score >= 80 ? "bg-green-600 text-white" : score >= 65 ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground";
  return <Badge className={cls}>{score}</Badge>;
}

const LABELS: Record<string, string> = {
  greenhouse: "Greenhouse · auto", lever: "Lever · auto", linkedin: "LinkedIn · capped", portal: "Portal · assisted", email: "Email", unknown: "Assisted",
};
export const ApplyTypeBadge = ({ type }: { type: string }) => <Badge variant="secondary">{LABELS[type] ?? type}</Badge>;

export const StatusBadge = ({ status }: { status: string }) => (
  <Badge variant={status === "failed" ? "destructive" : status === "submitted" ? "default" : "outline"}>{APP_STATUS_LABEL[status] ?? status.replace("_", " ")}</Badge>
);

/** Where the posting lives. The tooltip names the integration that fetched it. */
export function SourceBadge({ portal, source }: { portal?: string | null; source?: string | null }) {
  const via = source?.split(":")[0];
  const fromEmail = via === "mailbox";
  return <Badge variant="outline" title={via ? `Found via ${via}` : undefined}>{portalLabel(portal ?? via)}{fromEmail ? " · email" : ""}</Badge>;
}
