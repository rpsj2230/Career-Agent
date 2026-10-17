import { Badge } from "@/components/ui/badge";
import { experienceTitle, type ResumeView } from "@/lib/tailor/sections";
import { STYLES, type ResumeStyle, type SectionId } from "@/lib/tailor/template";
import type { TailoringScope } from "@/lib/tailor/scope";

/**
 * The master resume with every part labelled: FIXED (identical in every resume) or CHANGES PER JOB (rewritten for the job's description,
 * using only your own facts). It follows the same section order and labels as the DOCX that is sent.
 */
export function TemplateMap({ view, style = STYLES[0], scope, sample = false }: { view: ResumeView; style?: ResumeStyle; scope: TailoringScope; sample?: boolean }) {
  const fixed = <Badge variant="secondary" className="shrink-0">Fixed</Badge>;
  const varies = (on: boolean) => on ? <Badge className="shrink-0 bg-amber-500 text-white">Changes per job</Badge> : <Badge variant="secondary" className="shrink-0">Fixed (locked)</Badge>;
  const head = (t: string, tag: React.ReactNode) => <div className="mt-4 flex items-center justify-between gap-2 border-b pb-0.5"><h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t}</h4>{tag}</div>;
  const blocks: Record<SectionId, () => React.ReactNode> = {
    summary: () => <>{head(style.summaryLabel, varies(scope.summary))}<p className="mt-1">{view.summary}</p></>,
    skills: () => <>{head("Skills", varies(scope.skills))}<p className="mt-1">{view.skills.join(", ")}</p></>,
    experience: () => (
      <>
        {head("Work Experience", <span className="flex gap-1">{fixed}<span className="text-xs text-muted-foreground self-center">employers, titles, dates</span></span>)}
        {view.experience.map((e, i) => (
          <div key={i} className="mt-2">
            <div className="flex justify-between gap-2"><b>{experienceTitle(e)}</b> <span className="text-muted-foreground">{e.dates}</span></div>
            <ul className="ml-5 list-disc">{e.bullets.map((b, k) => <li key={k}>{b}</li>)}</ul>
            <div className="ml-5 mt-1">{varies(scope.bullets)} <span className="text-xs text-muted-foreground">the bullets for this role</span></div>
          </div>
        ))}
      </>
    ),
    education: () => <>{head("Education", fixed)}{view.education.map((x, i) => <p key={i} className="mt-1">{x}</p>)}</>,
    certifications: () => view.certifications.length > 0 ? <>{head("Certifications", fixed)}<ul className="ml-5 list-disc">{view.certifications.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null,
  };
  return (
    <article className="rounded-md border bg-card p-4 text-sm leading-relaxed" aria-label="Master resume template">
      {sample && <p className="mb-3 rounded-md bg-muted p-2 text-xs text-muted-foreground">This is a sample. Your own details appear here once you import and confirm your profile.</p>}
      <div className="text-center">
        <div className="text-lg font-bold">{view.name}</div>
        <div className="mt-1 flex items-center justify-center gap-2">{view.headline} {varies(scope.headline)}</div>
        <div className="mt-1 flex items-center justify-center gap-2 text-xs text-muted-foreground">{view.contact} {fixed}</div>
      </div>
      {style.sections.map((s) => <div key={s}>{blocks[s]()}</div>)}
    </article>
  );
}
