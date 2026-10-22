"use client";

import { useState } from "react";

/** The assistant's live picture. When it does not load it says why, instead of showing a broken image. */
export function LiveShot({ id, at }: { id: string; at: string }) {
  const [why, setWhy] = useState<string | null>(null);
  const path = `screenshots/${id}/live.jpg`;
  const src = `/api/files?path=${encodeURIComponent(path)}&v=${encodeURIComponent(at)}`;
  async function explain() {
    try {
      const r = await fetch(`/api/files?path=${encodeURIComponent(path)}&check=1`, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as { error?: string; where?: string } | null;
      setWhy(r.ok ? "The file exists but the browser could not show it (the picture may still be uploading: it tries again in a few seconds)." : `${j?.error ?? `HTTP ${r.status}`}${j?.where ? ` (${j.where})` : ""}`);
    } catch (e) { setWhy(`Could not ask the app: ${e instanceof Error ? e.message : "no answer"}`); }
  }
  if (why) return <p className="mt-1 text-xs text-destructive">The picture could not be loaded: {why}</p>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="What the assistant's browser shows now" onError={explain} className="mt-1 max-h-80 rounded-md border" />;
}
