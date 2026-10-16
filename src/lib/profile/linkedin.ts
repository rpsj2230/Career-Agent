import Papa from "papaparse";

type Row = Record<string, string>;

function rows(csv: string | undefined): Row[] {
  if (!csv) return [];
  // LinkedIn exports sometimes start with "Notes:" preamble lines; header is the first line with a comma.
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  const start = Math.max(0, lines.findIndex((l) => l.includes(",")));
  const parsed = Papa.parse<Row>(lines.slice(start).join("\n"), { header: true, skipEmptyLines: true });
  return parsed.data;
}

const pick = (r: Row, ...keys: string[]) => keys.map((k) => r[k]?.trim()).find(Boolean) ?? "";

/**
 * Turn the CSV files from LinkedIn's "Get a copy of your data" export into labelled plain text,
 * which the extractor then structures. `files` maps file name (e.g. "Positions.csv") to its content.
 */
export function linkedinExportToText(files: Record<string, string>): string {
  const get = (name: string) => {
    const key = Object.keys(files).find((k) => k.toLowerCase().endsWith(name.toLowerCase()));
    return key ? files[key] : undefined;
  };
  const out: string[] = ["# LinkedIn export"];

  for (const r of rows(get("Profile.csv"))) {
    out.push(
      `## Profile\nName: ${pick(r, "First Name")} ${pick(r, "Last Name")}\nHeadline: ${pick(r, "Headline")}\nLocation: ${pick(r, "Geo Location")}\nSummary: ${pick(r, "Summary")}`,
    );
  }
  const positions = rows(get("Positions.csv"));
  if (positions.length) out.push("## Positions");
  for (const r of positions) {
    out.push(
      `- ${pick(r, "Title")} at ${pick(r, "Company Name")} (${pick(r, "Started On")} to ${pick(r, "Finished On") || "Present"}) ${pick(r, "Location")}\n  ${pick(r, "Description").replace(/\s*\n\s*/g, "\n  ")}`,
    );
  }
  const edu = rows(get("Education.csv"));
  if (edu.length) out.push("## Education");
  for (const r of edu) {
    out.push(`- ${pick(r, "Degree Name")} at ${pick(r, "School Name")} (${pick(r, "Start Date")} to ${pick(r, "End Date")})`);
  }
  const skills = rows(get("Skills.csv")).map((r) => pick(r, "Name")).filter(Boolean);
  if (skills.length) out.push(`## Skills\n${skills.join(", ")}`);
  const certs = rows(get("Certifications.csv")).map((r) => pick(r, "Name")).filter(Boolean);
  if (certs.length) out.push(`## Certifications\n${certs.join("\n")}`);
  return out.join("\n");
}

/** Accepts "linkedin.com/in/x", "https://in.linkedin.com/in/x/?utm=1" etc.; returns the canonical URL or null. */
export function normalizeLinkedInUrl(raw: string | undefined | null): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/in\/([A-Za-z0-9\-_%.]+)\/?/);
    return m ? `https://www.linkedin.com/in/${m[1]}` : null;
  } catch {
    return null;
  }
}

// Page furniture that follows the profile content when you copy a whole LinkedIn page.
const TAIL_MARKERS = /\n\s*(People also viewed|People you may know|More profiles for you|Explore premium profiles|Browse more profiles|You might like|Profile language|Public profile & URL)\b[\s\S]*$/i;
const NOISE_LINES = /^\s*(Connect|Message|Follow|More|Contact info|Show all( \d+ \w+)?|See more|…see more|Open to|Add profile section|Enhance profile|Resources|Show details|Endorse|\d+ (connections?|followers?)|· ?(1st|2nd|3rd)|Premium)\s*$/i;

/** Strip LinkedIn page chrome from pasted text so the extractor sees mostly profile content. */
export function cleanPastedProfile(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .replace(TAIL_MARKERS, "")
    .split("\n")
    .filter((l) => !NOISE_LINES.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
