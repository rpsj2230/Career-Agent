/**
 * Voluntary self-identification questions (gender, race or ethnicity, veteran status, disability, sexual orientation, religion, marital status, age, date of birth).
 * They are optional by law in most places and never help an application, so unless the owner saved an answer the form gets the option that declines to say.
 * No option that declines: nothing is chosen (the question stays for the owner). Pure.
 */
const DEMOGRAPHIC = /\b(gender|sex\b|race|racial|ethnic|ethnicity|hispanic|latino|veteran|military|disabilit|disabled|sexual\s+orientation|lgbt|pronoun|religio|marital|date\s+of\s+birth|birth\s*date|\bage\b|caste|nationality\s+group)/i;
const DECLINE = /(decline|prefer\s+not|rather\s+not|do\s+not\s+wish|don'?t\s+wish|not\s+to\s+(say|disclose|answer|identify)|choose\s+not|i\s+do\s+not\s+want|no\s+answer|not\s+disclosed?)/i;

export const isDemographic = (label: string): boolean => DEMOGRAPHIC.test(label);

/** The option that declines to answer, when the question is a self-identification one and the form offers such an option. */
export function declineOption(label: string, options: string[]): string | null {
  if (!isDemographic(label)) return null;
  return options.find((o) => DECLINE.test(o)) ?? null;
}
