/** Hosts whose links are tracking redirects or listing pages of a job board, not the employer's own posting. */
const REDIRECTORS = [/(^|\.)adzuna\.[a-z.]+$/i, /(^|\.)jooble\.org$/i, /(^|\.)careerjet\.[a-z.]+$/i, /(^|\.)jobrapido\.com$/i];

export const isRedirector = (url: string): boolean => {
  try { const h = new URL(url).hostname; return REDIRECTORS.some((r) => r.test(h)); } catch { return false; }
};
