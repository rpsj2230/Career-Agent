"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads the page's data every few seconds so progress shows without pressing refresh. It skips a beat while the tab is hidden, while you have
 * rows ticked (a refresh must not disturb a selection you are about to act on), and while you are typing in a field.
 */
export function SmartRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (document.querySelector('input[type="checkbox"]:checked, [role="checkbox"][aria-checked="true"]')) return;
      const el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      router.refresh();
    }, Math.max(3, seconds) * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
