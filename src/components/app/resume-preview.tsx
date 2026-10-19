import type { ResumeView } from "@/lib/tailor/sections";
import { STYLES, type ResumeStyle } from "@/lib/tailor/template";
import { ResumeSheet } from "./resume-sheet";

/** The resume as it appears in the DOCX (same view, same section order and labels), so what you read here is what was sent. */
export function ResumePreview({ view, style = STYLES[0] }: { view: ResumeView; style?: ResumeStyle }) {
  return <ResumeSheet view={view} style={style} />;
}
