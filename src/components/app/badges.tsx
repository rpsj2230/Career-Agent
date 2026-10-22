import { Badge } from "@/components/ui/badge";
import { APP_STATUS_LABEL } from "@/lib/filters";
import { portalLabel } from "@/lib/jobs/portal";
import type { StageKey } from "@/lib/list-query";

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

/** One short, coloured word for where a job or application is in its journey. */
const STAGE_BADGE: Record<StageKey, { label: string; cls: string }> = {
  unscored: { label: "Not scored", cls: "bg-muted text-muted-foreground" },
  rejected: { label: "Skipped", cls: "bg-muted text-muted-foreground" },
  matched: { label: "Good fit", cls: "bg-sky-600 text-white" },
  awaiting_approval: { label: "Resume ready", cls: "bg-amber-500 text-white" },
  sending: { label: "Sending", cls: "bg-blue-600 text-white" },
  waiting_assistant: { label: "Queued for assistant", cls: "bg-amber-500 text-white" },
  needs_input: { label: "Needs you", cls: "bg-orange-600 text-white" },
  failed: { label: "Failed", cls: "bg-destructive text-white" },
  applied: { label: "Applied", cls: "bg-green-600 text-white" },
  saved: { label: "Saved", cls: "bg-violet-600 text-white" },
};
export const StageBadge = ({ stage }: { stage: StageKey }) => <Badge className={STAGE_BADGE[stage].cls}>{STAGE_BADGE[stage].label}</Badge>;

const CHIP_CLASS = { cloud: "bg-green-600 text-white", computer: "", hand: "bg-amber-500 text-white" } as const;
/** Who applies for a job: the cloud, the assistant on your computer, or you by hand (see lib/apply/reachable.ts). */
export const RouteChipBadge = ({ chip }: { chip: { text: string; tone: "cloud" | "computer" | "hand"; title: string } }) => (
  <Badge variant={chip.tone === "computer" ? "outline" : "default"} className={CHIP_CLASS[chip.tone]} title={chip.title}>{chip.text}</Badge>
);
