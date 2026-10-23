"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { call } from "./api";

/** Links the browser extension to this app once, so it gets the latest data and the waiting applications by itself. */
export function ExtensionCard({ linked, since, version }: { linked: boolean; since: string | null; version: string }) {
  const [code, setCode] = useState("");
  const [isLinked, setLinked] = useState(linked);
  return (
    <div className="grid gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild><a href="/downloads/career-agent-extension.zip" download>Download the extension (zip, version {version})</a></Button>
        <Button variant="secondary" onClick={async () => {
          const r = await call<{ code: string }>("/api/extension/link", "POST");
          if (r) { setCode(r.code); setLinked(true); }
        }}>{isLinked ? "Make a new link code (replaces the old one)" : "Make a link code"}</Button>
        {isLinked && <Button variant="outline" onClick={async () => { if (await call("/api/extension/link", "DELETE", undefined, "Extension unlinked")) { setLinked(false); setCode(""); } }}>Unlink</Button>}
      </div>
      <p className="text-muted-foreground">{isLinked ? `The extension is linked${since ? ` (code made ${new Date(since).toLocaleString()})` : ""}. ` : "Not linked yet. "}The code is shown once. Anyone who has it can read your fill data and your waiting applications and mark one as sent, nothing else; making a new code stops the old one.</p>
      {code && (
        <div className="grid gap-2 rounded-md border p-3">
          <b>Your link code (paste it into the extension, once):</b>
          <div className="flex gap-2"><Input readOnly value={code} onFocus={(e) => e.currentTarget.select()} /><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(code); toast.success("Copied"); } catch { toast.error("Select the code and copy it by hand"); } }}>Copy</Button></div>
        </div>
      )}
    </div>
  );
}
