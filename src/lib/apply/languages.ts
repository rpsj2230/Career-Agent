/**
 * "What is your level of proficiency in Chinese?" answered from the languages the owner says they know. The profile holds one line ("English: fluent; Hindi: fluent").
 * When that line is filled in, a language that is not on it is answered as "none": the owner stated they do not know the others. When it is empty nothing is answered.
 * Pure: no browser, no network.
 */
export type Level = "native" | "fluent" | "conversational" | "basic" | "none";

const LANGUAGES: Record<string, string[]> = {
  english: ["english"], hindi: ["hindi"], chinese: ["chinese", "mandarin", "cantonese"], malay: ["malay", "bahasa melayu", "bahasa malaysia"], tamil: ["tamil"],
  indonesian: ["indonesian", "bahasa indonesia"], japanese: ["japanese"], korean: ["korean"], french: ["french"], german: ["german"], spanish: ["spanish"], arabic: ["arabic"],
  thai: ["thai"], vietnamese: ["vietnamese"], russian: ["russian"], portuguese: ["portuguese"], italian: ["italian"], urdu: ["urdu"], bengali: ["bengali", "bangla"],
  telugu: ["telugu"], marathi: ["marathi"], punjabi: ["punjabi"], gujarati: ["gujarati"], kannada: ["kannada"], malayalam: ["malayalam"], tagalog: ["tagalog", "filipino"], dutch: ["dutch"],
};

/** The language a word names, or null. Mandarin, Cantonese and Chinese are one language for this purpose. */
export function canonicalLanguage(text: string): string | null {
  const t = text.toLowerCase();
  for (const [canon, names] of Object.entries(LANGUAGES)) if (names.some((n) => new RegExp(`\\b${n}\\b`).test(t))) return canon;
  return null;
}

function levelOf(words: string): Level {
  const w = words.toLowerCase();
  if (/\bnative|mother\s*tongue|bilingual/.test(w)) return "native";
  if (/\bnone\b|no\s+(knowledge|proficiency)|don'?t\s+(know|speak)/.test(w)) return "none";
  if (/\bbasic|beginner|elementary|limited|a1\b|a2\b/.test(w)) return "basic";
  if (/\bconversational|intermediate|working|b1\b|b2\b/.test(w)) return "conversational";
  return "fluent"; // fluent, proficient, advanced, expert, high, full professional, or just the name of the language
}

/** "English: fluent (read, write, speak); Hindi - fluent; Chinese: none" as a map. A language named without a level counts as fluent. */
export function parseLanguages(text: string | undefined | null): Map<string, Level> {
  const out = new Map<string, Level>();
  for (const chunk of (text ?? "").split(/[;\n]|,(?![^()]*\))/)) {
    const canon = canonicalLanguage(chunk.split(/[:\-–(]/)[0]);
    if (canon) out.set(canon, levelOf(chunk.replace(/^[^:\-–(]*/, "")));
  }
  return out;
}

const CONTEXT = /proficien|fluen|level|speak|spoken|read|writ|language|native|communicat|how well|command|ability|skill|understand/i;

/** The language a form question is about, when it is a question about knowing a language. */
export function languageAsked(label: string): string | null {
  return CONTEXT.test(label) ? canonicalLanguage(label) : null;
}

const RANK: Record<Level, RegExp[]> = {
  native: [/native|bilingual|mother/i, /fluent/i, /full\s+professional/i, /advanced|proficient|expert/i],
  fluent: [/fluent/i, /full\s+professional/i, /native|bilingual/i, /advanced|proficient|expert|professional/i, /\bc[12]\b|excellent|very\s+good|high/i],
  conversational: [/conversational/i, /professional\s+working|working|intermediate/i, /\bb[12]\b|good/i],
  basic: [/basic|beginner|elementary|\ba[12]\b|limited|some/i],
  none: [/^\s*none\b|no\s+(knowledge|proficiency)|not\s+proficient|do\s+not\s+(know|speak)|don'?t\s+(know|speak)|not\s+at\s+all|^\s*no\s*$|^\s*0\s*$|zero/i],
};
const FREE_TEXT: Record<Level, string> = { native: "Native", fluent: "Fluent (read, write and speak)", conversational: "Conversational", basic: "Basic", none: "None (no working knowledge)" };

/**
 * The answer to a language question, or null when it is not one, the owner has not listed their languages, or no offered option states the level honestly
 * (a form with no "none" option and a language the owner does not know goes to the owner, never to "elementary").
 */
export function languageAnswer(label: string, options: string[], languages: string | undefined | null): string | null {
  if (!(languages ?? "").trim()) return null;
  const lang = languageAsked(label);
  if (!lang) return null;
  const level = parseLanguages(languages).get(lang) ?? "none";
  const yes = options.find((o) => /^\s*yes\b/i.test(o)), no = options.find((o) => /^\s*no\b/i.test(o));
  const asksYesNo = /^\s*(do|can|are|have|would)\s+you\b/i.test(label);
  if (asksYesNo && (yes || options.length === 0)) return level === "none" || level === "basic" ? (no ?? "No") : (yes ?? "Yes");
  if (options.length === 0) return FREE_TEXT[level];
  for (const re of RANK[level]) { const hit = options.find((o) => re.test(o)); if (hit) return hit; }
  return null;
}
