/**
 * What the assistant must never do on a page, whatever the page asks: choose a password, type payment or identity numbers, trust a page that is
 * not the employer's, or take a file or program the page offers. Pure: no browser, no network, so every rule is tested.
 */

export type Sensitive = "password" | "payment" | "identity" | "code";

const PASSWORD = /\b(confirm(ation)?\s+|re-?enter\s+|retype\s+|new\s+|create\s+|choose\s+|set\s+)?(password|passcode|passphrase)\b/i;
const PAYMENT = /\b(card\s*(number|no)|credit\s*card|debit\s*card|cvv|cvc|security\s*code|expir(y|ation)\s*date|bank\s*account|iban|routing\s*number|sort\s*code|upi\s*id)\b/i;
const IDENTITY = /\b(ssn|social\s*security|aadhaar|aadhar|pan\s*(card|number)|passport\s*(number|no)|national\s*(id|identity)|nric|driver'?s\s*licen[cs]e|tax\s*id)\b/i;
const CODE = /\b(one[- ]time\s*(code|password|pin)|otp|verification\s*code|authenticator|2fa|two[- ]factor)\b/i;

/** The kind of secret a field asks for, or null for an ordinary question. Passwords are recognised by the field's own type as well as its words. */
export function sensitiveKind(label: string, type = "text"): Sensitive | null {
  if (type.toLowerCase() === "password") return "password";
  if (/^\s*(how many|years?\b|number of)/i.test(label)) return null; // a count about a tool or a field ("years with payment processing"), never a secret
  if (PASSWORD.test(label)) return "password";
  if (CODE.test(label)) return "code";
  if (PAYMENT.test(label)) return "payment";
  if (IDENTITY.test(label)) return "identity";
  return null;
}

/** The hand-back reason for a form that asks for a secret. Never begins with "Needs you:" so it is not offered as a question to type an answer to. */
export function sensitiveReason(kind: Sensitive, host: string): string {
  const where = host ? ` on ${host}` : "";
  switch (kind) {
    case "password": return `This employer's page${where} asks you to create an account (it wants a password). The assistant never creates accounts and never types a password: open the link and apply there yourself`;
    case "payment": return `This page${where} asks for payment or bank details. The assistant never enters those, and a real employer does not charge to apply: check the page before going further`;
    case "identity": return `This page${where} asks for an identity or tax number. The assistant never enters those: fill them in yourself`;
    case "code": return `This page${where} wants a verification code sent to you. The assistant cannot and should not enter one: apply there yourself`;
  }
}

/** Applicant-tracking systems and recruiting platforms that employers use for their own application forms. */
const KNOWN_ATS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|recruitee\.com|smartrecruiters\.com|bamboohr\.com|breezy\.hr|jobvite\.com|icims\.com|taleo\.net|myworkdayjobs\.com|myworkdaysite\.com|workday\.com|successfactors\.(com|eu)|teamtailor\.com|personio\.(de|com)|pinpointhq\.com|jazzhr\.com|applytojob\.com|rippling\.com|dayforcehcm\.com|paycomonline\.net|oraclecloud\.com|ultipro\.com|ukg\.com|eightfold\.ai|avature\.net|zohorecruit\.com|freshteam\.com|hirehive\.com|join\.com|comeet\.co|talentlyft\.com|manatal\.com|cezanneondemand\.com|hrmdirect\.com|csod\.com|phenompeople\.com|brassring\.com|kenexa\.com|ripplehire\.com|darwinbox\.in|keka\.com|zohorecruit\.in|naukri\.com|linkedin\.com)$/i;

/**
 * Job portals and aggregators. An employer often publishes an opening on one of these and sends applicants there, so a link that lands on one is not a scam.
 * Whatever such a portal asks for is still limited by the other rules: it never gets a password, a payment or an identity number, and nothing is downloaded.
 */
const KNOWN_PORTALS = /(^|\.)(bebee\.com|jooble\.org|careerjet\.[a-z.]+|talent\.com|jobrapido\.com|adzuna\.[a-z.]+|ziprecruiter\.com|jobstreet\.com|jobsdb\.com|hiredly\.com|foundit\.[a-z.]+|monsterindia\.com|monster\.com|glassdoor\.[a-z.]+|indeed\.com|simplyhired\.com|learn4good\.com|jora\.com|seek\.com(\.au)?|workable\.com|wellfound\.com|angel\.co|hirist\.(com|tech)|instahyre\.com|cutshort\.io|apna\.co|internshala\.com|recruit\.net|lensa\.com|joblift\.[a-z.]+|jobisjob\.[a-z.]+|whatjobs\.com|dice\.com|builtin\.com|otta\.com|welcometothejungle\.com|himalayas\.app|remoteok\.com|weworkremotely\.com|jobted\.[a-z.]+|jobsoid\.com|jobsora\.com|trovit\.[a-z.]+|mycareersfuture\.gov\.sg|jobscentral\.com\.sg|efinancialcareers\.[a-z.]+|bayt\.com|naukrigulf\.com|gulftalent\.com|shine\.com|timesjobs\.com|freshersworld\.com|jobhai\.com|quikr\.com|hellowork\.com|stepstone\.[a-z.]+|reed\.co\.uk|totaljobs\.com|cwjobs\.co\.uk)$/i;

/** Words that mark a page as a scam, an advert or a trap, whoever it says it is. */
const SPAM = /(you('ve| have)\s+won|claim\s+your\s+(prize|reward|gift)|congratulations[^.]{0,40}(winner|selected\s+for\s+a\s+prize)|download\s+(and\s+install|the|our)\s+(app|extension|plugin|software|installer)|install\s+(the|our)\s+(app|extension|plugin|software)|enable\s+(push\s+)?notifications\s+to|update\s+your\s+(browser|flash|chrome)|(registration|processing|application|training|security)\s+(fee|deposit)|pay\s+(a\s+)?(fee|deposit)\s+to\s+(apply|start)|casino|betting|crypto\s+(giveaway|wallet\s+connect)|verify\s+you\s+are\s+human\s+by\s+(installing|downloading|running))/i;

/** Does this text name the company (its first distinctive word)? */
export const mentionsCompany = (text: string, company: string) => {
  const w = company.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").split(/\s+/)
    .filter((x) => x.length > 2 && !["pty", "ltd", "inc", "llc", "llp", "plc", "the", "and", "pte", "pvt", "limited", "private", "corp", "group", "company"].includes(x));
  return w.length > 0 && text.toLowerCase().includes(w[0]);
};

/**
 * Is this page where an application for `company` can safely be filled? Yes for a known applicant-tracking system, or a page that names the
 * company; never for a page that reads like a scam or asks for a program or a fee, however well it names the company.
 */
export function destinationTrust(o: { host: string; title: string; body: string; company: string; /** hiring organisations named in the page's own JobPosting data */ postingOrgs?: string[]; /** sites the owner has said to trust (~/.career-agent/trusted-sites.txt) */ trusted?: string[] }): { ok: boolean; why: string } {
  const h = o.host.toLowerCase().replace(/^www\./, "");
  const text = `${o.title} ${o.body.slice(0, 4000)}`;
  const spam = text.match(SPAM);
  if (spam) return { ok: false, why: `the page on ${h || "this site"} reads like a scam or an advert ("${spam[0].slice(0, 40)}")` };
  if (KNOWN_ATS.test(h)) return { ok: true, why: "a known applicant-tracking system" };
  if (KNOWN_PORTALS.test(h)) return { ok: true, why: "a well-known job portal" };
  if ((o.trusted ?? []).some((t) => h === t || h.endsWith(`.${t}`))) return { ok: true, why: "a site you chose to trust" };
  if ((o.postingOrgs ?? []).some((org) => mentionsCompany(org, o.company))) return { ok: true, why: `the page's own job-posting data names ${o.company}` };
  if (mentionsCompany(`${h} ${text}`, o.company)) return { ok: true, why: `the page names ${o.company}` };
  return { ok: false, why: `the page on ${h || "this site"} does not mention ${o.company} and is not a known application system or job portal` };
}

/** File types that are programs or installers: a page offering one is never followed. */
export const PROGRAM_FILE = /\.(dmg|pkg|mpkg|app|exe|msi|bat|cmd|com|scr|sh|command|jar|apk|ipa|deb|rpm|iso|vbs|ps1|crx|xpi)(\?|$)/i;
