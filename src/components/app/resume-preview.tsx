import { experienceTitle, type ResumeView } from "@/lib/tailor/sections";
import { STYLES, type ResumeStyle, type SectionId } from "@/lib/tailor/template";

/** The resume as it appears in the DOCX (same view, same section order and labels), so what you read here is what was sent. */
export function ResumePreview({ view, style = STYLES[0] }: { view: ResumeView; style?: ResumeStyle }) {
  const h = (t: string) => <h4 className="mt-4 border-b pb-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t}</h4>;
  const blocks: Record<SectionId, () => React.ReactNode> = {
    summary: () => view.summary ? <>{h(style.summaryLabel)}<p>{view.summary}</p></> : null,
    skills: () => view.skills.length > 0 ? <>{h("Skills")}<p>{view.skills.join(", ")}</p></> : null,
    experience: () => (
      <>
        {h("Work Experience")}
        {view.experience.map((e, i) => (
          <div key={i} className="mt-2">
            <div className="flex justify-between gap-2"><b>{experienceTitle(e)}</b> <span className="text-muted-foreground">{e.dates}</span></div>
            <ul className="ml-5 list-disc">{e.bullets.map((b, k) => <li key={k}>{b}</li>)}</ul>
          </div>
        ))}
      </>
    ),
    education: () => view.education.length > 0 ? <>{h("Education")}{view.education.map((x, i) => <p key={i}>{x}</p>)}</> : null,
    certifications: () => view.certifications.length > 0 ? <>{h("Certifications")}<ul className="ml-5 list-disc">{view.certifications.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null,
  };
  return (
    <article className="rounded-md border bg-card p-4 text-sm leading-relaxed" aria-label="Resume preview">
      <div className="text-center">
        <div className="text-lg font-bold">{view.name}</div>
        <div>{view.headline}</div>
        <div className="text-xs text-muted-foreground">{view.contact}</div>
      </div>
      {style.sections.map((s) => <div key={s}>{blocks[s]()}</div>)}
    </article>
  );
}
