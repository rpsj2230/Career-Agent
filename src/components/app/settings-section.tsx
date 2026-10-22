import type { ReactNode } from "react";

/** One step of the pipeline on the Settings page: a heading, a plain sentence saying what the step does and which limit applies, then its settings. */
export function SettingsSection({ id, title, summary, children }: { id: string; title: string; summary: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="grid scroll-mt-4 gap-3">
      <div className="border-b pb-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{summary}</p>
      </div>
      {children}
    </section>
  );
}
