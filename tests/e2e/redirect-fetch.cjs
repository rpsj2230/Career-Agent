// Test-only: sends calls to the real job-board APIs to the local fake provider instead (no production code changes).
const mock = process.env.E2E_MOCK_URL;
const HOSTS = new Set(["api.adzuna.com", "remotive.com", "jsearch.p.rapidapi.com", "boards-api.greenhouse.io", "api.lever.co", "api.telegram.org"]);
if (mock) {
  const real = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    try {
      const u = new URL(typeof input === "string" ? input : input.url ?? String(input));
      if (HOSTS.has(u.hostname)) return real(`${mock}/ext/${u.hostname}${u.pathname}${u.search}`, init);
    } catch { /* fall through */ }
    return real(input, init);
  };
}
