/* Shared by the popup and the background worker (plain script; the pure helpers come from lib.js as CareerAgentLib). */
const CA = {
  async link() { return (await chrome.storage.local.get("link")).link || null; },

  /** A request to the linked Career Agent. Throws a readable message. */
  async api(path, init = {}) {
    const link = await CA.link();
    if (!link) throw new Error("Not linked to Career Agent yet");
    const res = await fetch(link.origin + path, { ...init, cache: "no-store", headers: { ...(init.headers || {}), Authorization: "Bearer " + link.token } });
    if (res.status === 401) throw new Error("The link code is no longer valid. Make a new one in Career Agent: Profile.");
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || "Career Agent answered " + res.status); }
    return res;
  },

  /** Fresh data from the app before every fill; the last copy is used when the app cannot be reached. */
  async refresh() {
    if (!(await CA.link())) return { source: "manual" };
    try {
      const data = await (await CA.api("/api/extension/data")).json();
      await chrome.storage.local.set({ fillData: data, syncedAt: Date.now() });
      return { source: "app" };
    } catch (e) { return { source: "cache", error: e.message }; }
  },

  async file(item, kind) {
    if (!item || !item[kind]) return null;
    const res = await CA.api("/api/extension/file?application=" + encodeURIComponent(item.id) + "&kind=" + kind);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { name: item[kind].name, type: res.headers.get("content-type") || "application/octet-stream", b64: btoa(bin) };
  },

  /** Fill the form in a tab and attach the application's resume. Never presses a button. */
  async fillTab(tabId, item) {
    const { fillData } = await chrome.storage.local.get("fillData");
    if (!fillData) throw new Error("No data yet: link Career Agent first");
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: (d) => window.__careerAgentFill(d), args: [fillData] });
    let files = { attached: [], missing: [] };
    if (item && (item.resume || item.cover)) {
      let resume = null, cover = null, problem = null;
      try { resume = await CA.file(item, "resume"); cover = await CA.file(item, "cover"); } catch (e) { problem = e.message; }
      if (resume || cover) [{ result: files }] = await chrome.scripting.executeScript({ target: { tabId }, func: (r, c) => window.__careerAgentAttach(r, c), args: [resume, cover] });
      if (problem) files.missing.push("could not get the resume: " + problem);
    }
    return { ...result, files };
  },

  async mark(applicationId) {
    await CA.api("/api/extension/mark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId }) });
  },
};
