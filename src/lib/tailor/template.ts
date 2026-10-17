/**
 * The resume template. The layout is fixed code, never produced by the model: the same fonts, spacing, order and
 * alignment every time, in plain single-column text that applicant tracking systems read correctly. What differs by
 * country is only a small, named style (page size, spelling, the summary's heading, how long each role may run).
 */
export type SectionId = "summary" | "skills" | "experience" | "education" | "certifications";

export type ResumeStyle = {
  id: string;
  label: string;
  page: "A4" | "Letter";
  /** spelling the model is asked to write in */
  spelling: "us" | "uk";
  summaryLabel: string;
  sections: SectionId[];
  /** at most this many bullets are shown per role (the model puts the most relevant first) */
  maxBullets: number;
};

const ORDER: SectionId[] = ["summary", "skills", "experience", "education", "certifications"];

export const STYLES: ResumeStyle[] = [
  { id: "standard", label: "Standard (A4, British spelling)", page: "A4", spelling: "uk", summaryLabel: "Summary", sections: ORDER, maxBullets: 5 },
  { id: "us", label: "United States / Canada (Letter, American spelling)", page: "Letter", spelling: "us", summaryLabel: "Professional Summary", sections: ORDER, maxBullets: 4 },
  { id: "europe", label: "Europe (A4, British spelling, 'Profile')", page: "A4", spelling: "uk", summaryLabel: "Profile", sections: ["summary", "experience", "education", "skills", "certifications"], maxBullets: 5 },
  { id: "gulf", label: "Middle East (A4, British spelling, 'Profile')", page: "A4", spelling: "uk", summaryLabel: "Profile", sections: ORDER, maxBullets: 6 },
  { id: "india", label: "India (A4, British spelling, fuller detail)", page: "A4", spelling: "uk", summaryLabel: "Professional Summary", sections: ORDER, maxBullets: 6 },
];

export const styleById = (id: string | null | undefined): ResumeStyle => STYLES.find((s) => s.id === id) ?? STYLES[0];

const BY_COUNTRY: Record<string, string> = {
  us: "us", ca: "us", mx: "us", br: "us",
  de: "europe", nl: "europe", fr: "europe", es: "europe", it: "europe", ch: "europe", at: "europe", be: "europe", pl: "europe", ie: "europe", se: "europe", dk: "europe", no: "europe", fi: "europe", pt: "europe", cz: "europe",
  ae: "gulf", qa: "gulf", sa: "gulf", kw: "gulf", bh: "gulf", om: "gulf",
  in: "india",
};

/** A country's style: your override from Settings if you set one, otherwise the sensible default for that region. */
export function styleFor(country: string | null | undefined, overrides: Record<string, string> = {}): ResumeStyle {
  const c = (country ?? "").toLowerCase();
  return styleById(overrides[c] ?? BY_COUNTRY[c]);
}

/** One line added to the model's instructions so the wording matches the country (the facts are never affected). */
export const styleInstruction = (s: ResumeStyle) =>
  `Write in ${s.spelling === "us" ? "American" : "British"} English spelling. Show at most ${s.maxBullets} bullets per role, most relevant first.`;
