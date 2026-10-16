"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy automatically. Select the text and copy it by hand.");
    }
  }
  return <Button type="button" variant="outline" size="sm" onClick={copy}>{label}</Button>;
}
