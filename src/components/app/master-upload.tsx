"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Replace the master resume file directly (PDF or DOCX, up to 10 MB), without redoing the profile import. */
export function MasterUpload({ hasFile }: { hasFile: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function upload() {
    const f = ref.current?.files?.[0];
    if (!f) return toast.error("Choose a PDF or DOCX file first");
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", f);
      const res = await fetch("/api/resumes/master", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) toast.error(data.error ?? `Upload failed (${res.status})`);
      else { toast.success(`Master resume replaced: ${f.name}`); if (ref.current) ref.current.value = ""; router.refresh(); }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Network error"); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input ref={ref} type="file" accept=".pdf,.docx" className="w-72" aria-label="Master resume file" />
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={upload}>{busy ? "Uploading..." : hasFile ? "Replace master resume" : "Upload master resume"}</Button>
    </div>
  );
}
