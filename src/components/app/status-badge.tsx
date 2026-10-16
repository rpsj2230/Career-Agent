import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, type ConnectionStatus } from "@/lib/integrations/catalog";
import { cn } from "@/lib/utils";

const STYLE: Record<ConnectionStatus, string> = {
  ok: "bg-green-600 text-white", error: "bg-destructive text-white", ready: "bg-amber-500 text-white",
  needs_setup: "bg-muted text-muted-foreground", disabled: "bg-muted text-muted-foreground line-through", planned: "bg-muted text-muted-foreground",
};

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  return <Badge className={cn(STYLE[status])}>{STATUS_LABEL[status]}</Badge>;
}
