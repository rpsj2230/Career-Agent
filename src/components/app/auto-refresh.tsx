"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-reads the page's data every few seconds while something is running, and stops when it is not. */
export function AutoRefresh({ active, everyMs = 8000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}
