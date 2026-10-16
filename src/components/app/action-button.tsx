"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type Props = React.ComponentProps<typeof Button> & {
  endpoint: string;
  method?: "POST" | "GET";
  body?: unknown;
  success?: string;
  confirm?: string;
};

/** Calls an API route, toasts the outcome and refreshes server data. Shows the server's error message verbatim. */
export function ActionButton({ endpoint, method = "POST", body, success, confirm: confirmText, children, ...props }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const res = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(data.error ?? `Request failed (${res.status})`);
      else {
        toast.success(data.warning ? `${success ?? "Done"} - ${data.warning}` : (data.note ?? success ?? "Done"));
        start(() => router.refresh());
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button {...props} disabled={props.disabled || busy || pending} onClick={run}>
      {(busy || pending) && <Loader2 className="size-4 animate-spin" />}
      {children}
    </Button>
  );
}
