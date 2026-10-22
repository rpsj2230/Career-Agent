import { estimateYears } from "./answers";
import type { MasterProfile } from "@/lib/types";

/**
 * What the browser extension needs to fill a form on a page the assistant cannot automate: who you are, your saved answers, the languages you know and your roles (so years of
 * experience can be worked out). It never contains a password, a CTC you did not enter, or anything the app would not send to an employer itself. Pure.
 */
export type FillData = {
  version: 1;
  generatedAt: string;
  applicant: { name: string; email: string; phone: string; location: string; links: string[]; currentCompany?: string };
  answers: { question: string; answer: string }[];
  languages: string;
  totalYears: number | null;
  experience: { title: string; start?: string; end?: string; bullets: string[] }[];
};

export function buildFillData(profile: MasterProfile, bank: { question: string; answer: string }[], now = new Date()): FillData {
  return {
    version: 1,
    generatedAt: now.toISOString(),
    applicant: { name: profile.basics.name, email: profile.basics.email, phone: profile.basics.phone, location: profile.basics.location, links: profile.basics.links, currentCompany: profile.experience[0]?.company },
    answers: bank.filter((b) => b.answer.trim()).map((b) => ({ question: b.question, answer: b.answer })),
    languages: profile.preferences.languages ?? "",
    totalYears: estimateYears(profile.experience),
    experience: profile.experience.map((e) => ({ title: e.title, start: e.start, end: e.end, bullets: e.bullets.map((b) => b.text) })),
  };
}
