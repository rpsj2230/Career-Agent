import { Badge } from "@/components/ui/badge";

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
  <Badge variant={status === "failed" ? "destructive" : status === "submitted" ? "default" : "outline"}>{status.replace("_", " ")}</Badge>
);
