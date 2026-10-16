import type { ResumeView } from "@/lib/tailor/sections";

/** The resume as it appears in the DOCX (both come from the same ResumeView), so what you read here is what was sent. */
export function ResumePreview({ view }: { view: ResumeView }) {
  const h = (t: string) => <h4 className="mt-4 border-b pb-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t}</h4>;
  return (
    <article className="rounded-md border bg-card p-4 text-sm leading-relaxed" aria-label="Resume preview">
      <div className="text-center">
        <div className="text-lg font-bold">{view.name}</div>
        <div>{view.headline}</div>
        <div className="text-xs text-muted-foreground">{view.contact}</div>
      </div>
      {h("Summary")}<p>{view.summary}</p>
      {view.skills.length > 0 && <>{h("Skills")}<p>{view.skills.join(", ")}</p></>}
      {h("Experience")}
      {view.experience.map((e, i) => (
        <div key={i} className="mt-2">
          <div><b>{e.title}, {e.company}</b> <span className="text-muted-foreground">{e.dates}{e.location ? ` | ${e.location}` : ""}</span></div>
          <ul className="ml-5 list-disc">{e.bullets.map((b, k) => <li key={k}>{b}</li>)}</ul>
        </div>
      ))}
      {view.education.length > 0 && <>{h("Education")}{view.education.map((x, i) => <p key={i}>{x}</p>)}</>}
      {view.certifications.length > 0 && <>{h("Certifications")}<ul className="ml-5 list-disc">{view.certifications.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
    </article>
  );
}
