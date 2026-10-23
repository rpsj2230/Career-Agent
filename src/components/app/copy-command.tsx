"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** A command to run in Terminal, shown whole with a button that copies it. */
export function CopyCommand({ command }: { command: string }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <code className="overflow-x-auto rounded-md bg-muted px-2 py-1 text-xs">{command}</code>
      <Button size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(command); toast.success("Copied. Paste it in Terminal."); } catch { toast.error("Select the command and copy it by hand"); } }}>Copy</Button>
    </div>
  );
}
