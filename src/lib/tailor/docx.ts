import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { CoverLetter, MasterProfile, TailoredResume } from "@/lib/types";

const heading = (text: string) =>
  new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 }, children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 22 })] });
const body = (text: string) => new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text, size: 21 })] });
const bullet = (text: string) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text, size: 21 })] });

/** Company, title and dates always come from the master profile, never from model output. */
export function resumeParagraphs(p: MasterProfile, t: TailoredResume): Paragraph[] {
  const b = p.basics;
  const contact = [b.email, b.phone, b.location, ...b.links].filter(Boolean).join("  |  ");
  const out: Paragraph[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: b.name, bold: true, size: 36 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t.headline || b.headline, size: 24 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: contact, size: 19 })] }),
    heading("Summary"), body(t.summary.text),
  ];
  const skills = t.skillIds.map((id) => p.skills.find((s) => s.id === id)?.name).filter((x): x is string => !!x);
  if (skills.length) out.push(heading("Skills"), body(skills.join(", ")));

  out.push(heading("Experience"));
  for (const te of t.experience) {
    const e = p.experience.find((x) => x.id === te.experienceId);
    if (!e) continue;
    out.push(
      new Paragraph({ spacing: { before: 120 }, children: [
        new TextRun({ text: `${e.title}, ${e.company}`, bold: true, size: 22 }),
        new TextRun({ text: `   ${[e.start, e.end].filter(Boolean).join(" - ")}${e.location ? `  |  ${e.location}` : ""}`, size: 20 }),
      ] }),
      ...te.bullets.map((x) => bullet(x.text)),
    );
  }
  if (p.education.length) {
    out.push(heading("Education"));
    for (const ed of p.education) out.push(body(`${ed.degree}, ${ed.school}${ed.start || ed.end ? ` (${[ed.start, ed.end].filter(Boolean).join(" - ")})` : ""}`));
  }
  const certs = t.certificationIds.map((id) => p.certifications.find((c) => c.id === id)?.name).filter((x): x is string => !!x);
  if (certs.length) out.push(heading("Certifications"), ...certs.map(bullet));
  return out;
}

export async function renderResumeDocx(p: MasterProfile, t: TailoredResume): Promise<Buffer> {
  return Packer.toBuffer(new Document({ sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } }, children: resumeParagraphs(p, t) }] }));
}

export async function renderCoverLetterDocx(p: MasterProfile, c: CoverLetter, company: string): Promise<Buffer> {
  const paras = c.text.split(/\n{2,}/).map((x) => new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: x.trim(), size: 22 })] }));
  return Packer.toBuffer(new Document({ sections: [{ children: [
    new Paragraph({ children: [new TextRun({ text: p.basics.name, bold: true, size: 26 })] }),
    new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: [p.basics.email, p.basics.phone].filter(Boolean).join("  |  "), size: 20 })] }),
    new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: `Application to ${company}`, size: 22 })] }),
    ...paras,
    new Paragraph({ children: [new TextRun({ text: p.basics.name, size: 22 })] }),
  ] }] }));
}
