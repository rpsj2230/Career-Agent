"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function MasterUpload({ has }: { has: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function upload() {
    const f = ref.current?.files?.[0];
    if (!f) { toast.error("Choose a PDF or DOCX file first"); return; }
    setBusy(true);
    try {
      const form = new FormData(); form.append("file", f);
      const res = await fetch("/api/resumes/master", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(data.error ?? "Upload failed");
      else { toast.success("Master resume saved"); if (ref.current) ref.current.value = ""; router.refresh(); }
    } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input ref={ref} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="max-w-xs" aria-label="Master resume file" />
      <Button onClick={upload} disabled={busy}>{busy ? "Uploading..." : has ? "Replace master resume" : "Upload master resume"}</Button>
    </div>
  );
}
