/** Local text similarity for job descriptions. Costs no model tokens. */

const STOP = new Set(`a an and are as at be been but by for from has have in into is it its of on or our that the their this to was we were will with you your
about across also any can more most other over such than then they those through under up use using via what when which who within work working role job company
team teams experience experienced years year strong ability skills skill including include required requirements preferred responsibilities opportunity looking join
candidate candidates position apply must should would great good new etc per well both while each`.split(/\s+/));

const SENIORITY = new Set("senior sr junior jr lead staff principal associate head chief vp director manager i ii iii iv v intern graduate".split(" "));

const stem = (w: string) => (w.endsWith("ies") && w.length > 4 ? `${w.slice(0, -3)}y` : w.endsWith("s") && !w.endsWith("ss") && w.length > 3 ? w.slice(0, -1) : w);

export function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9+#.\-\s]/g, " ").split(/\s+/).map((w) => stem(w.replace(/^[.\-]+|[.\-]+$/g, ""))).filter((w) => w.length > 1 && !STOP.has(w));
}

export type JobLike = { title: string; description: string };

/** The job's own words, with the title counted three times because it says most about the role. */
export function jobTokens(j: JobLike): string[] {
  const t = tokenize(j.title);
  return [...t, ...t, ...t, ...tokenize(j.description)];
}

/** The title with seniority and level words removed ("Senior Product Manager II" => product). Used to tell role families apart. */
export const titleFamily = (title: string): string[] => tokenize(title).filter((w) => !SENIORITY.has(w));

export function jaccard(a: string[], b: string[]): number {
  const x = new Set(a), y = new Set(b);
  if (x.size === 0 && y.size === 0) return 0;
  const inter = [...x].filter((w) => y.has(w)).length;
  return inter / (x.size + y.size - inter);
}

type Vec = Map<string, number>;

/** TF-IDF vectors for a small set of documents (the new job and the past ones). */
export function tfidf(docs: string[][]): Vec[] {
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = docs.length;
  return docs.map((d) => {
    const tf = new Map<string, number>();
    for (const w of d) tf.set(w, (tf.get(w) ?? 0) + 1);
    const v: Vec = new Map();
    for (const [w, c] of tf) v.set(w, (1 + Math.log(c)) * (Math.log((n + 1) / ((df.get(w) ?? 0) + 1)) + 1));
    return v;
  });
}

export function cosine(a: Vec, b: Vec): number {
  let dot = 0, na = 0, nb = 0;
  for (const [w, x] of a) { na += x * x; const y = b.get(w); if (y) dot += x * y; }
  for (const y of b.values()) nb += y * y;
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** The words that matter most in one document relative to the others, strongest first. */
export function topTerms(vec: Vec, n = 20): string[] {
  return [...vec].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}
