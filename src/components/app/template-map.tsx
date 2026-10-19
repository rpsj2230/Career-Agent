import { Badge } from "@/components/ui/badge";
import type { ResumeView } from "@/lib/tailor/sections";
import { STYLES, type ResumeStyle } from "@/lib/tailor/template";
import type { TailoringScope } from "@/lib/tailor/scope";
import { ResumeSheet } from "./resume-sheet";

/**
 * The master resume with every part labelled: FIXED (identical in every resume) or CHANGES PER JOB (rewritten for the job's description,
 * using only your own facts). It is the same sheet as the DOCX that is sent, with the labels added.
 */
export function TemplateMap({ view, style = STYLES[0], scope, sample = false }: { view: ResumeView; style?: ResumeStyle; scope: TailoringScope; sample?: boolean }) {
  const fixed = <Badge variant="secondary" className="shrink-0">Fixed</Badge>;
  const varies = (on: boolean) => on ? <Badge className="shrink-0 bg-amber-500 text-white">Changes per job</Badge> : <Badge variant="secondary" className="shrink-0">Fixed (locked)</Badge>;
  return (
    <div className="grid gap-2">
      {sample && <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">This is a sample. Your own details appear here once you import and confirm your profile.</p>}
      <ResumeSheet
        view={view}
        style={style}
        label="Master resume template"
        tags={{ summary: varies(scope.summary), headline: varies(scope.headline), highlights: varies(scope.highlights), skills: varies(scope.skills), bullets: varies(scope.bullets), contact: fixed, fixed }}
      />
    </div>
  );
}
