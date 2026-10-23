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
    // the default resume (not one of your applications) comes from the Resumes page; everything else is the file prepared for that application
    const res = await CA.api(item.isDefault ? "/api/extension/file?kind=master" : "/api/extension/file?application=" + encodeURIComponent(item.id) + "&kind=" + kind);
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

  /** Tell Career Agent what happened to an application: { action: "claim" | "release" | "submitted", ... }. Throws with .global set when the app says no for every application (switch off, daily limit). */
  async report(applicationId, body) {
    const link = await CA.link();
    if (!link) throw new Error("Not linked to Career Agent yet");
    const res = await fetch(link.origin + "/api/extension/mark", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", Authorization: "Bearer " + link.token }, body: JSON.stringify({ applicationId, ...body }) });
    if (res.ok) return;
    const j = await res.json().catch(() => ({}));
    const err = new Error(res.status === 401 ? "The link code is no longer valid. Make a new one in Career Agent: Profile." : j.error || "Career Agent answered " + res.status);
    err.global = !!j.global;
    throw err;
  },
  async mark(applicationId) { await CA.report(applicationId, { action: "submitted" }); },

  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  loaded(tabId, timeoutMs = 30000) {
    return new Promise((resolve) => {
      const done = () => { chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); };
      const onUpdated = (id, info) => { if (id === tabId && info.status === "complete") done(); };
      chrome.tabs.onUpdated.addListener(onUpdated);
      setTimeout(done, timeoutMs);
    });
  },
  /** Run a function in the page (the page's script is injected again first: the page may have navigated). */
  async inPage(tabId, func, args = []) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return result;
  },

  /**
   * One application, start to finish, in a new tab: fill, attach the resume, then Next / Submit page after page (at most 8) until the employer's confirmation appears.
   * Stops, and says why, at anything only a person should do. Result: { outcome: "submitted" | "unconfirmed" | "blocked", ... }.
   */
  async process(item, allowSubmit) {
    const tab = await chrome.tabs.create({ url: item.formUrl, active: true });
    const tabId = tab.id;
    await CA.loaded(tabId);
    let baseline = null;
    for (let step = 0; step < 8; step++) {
      await CA.sleep(step === 0 ? 1500 : 1000);
      try { await CA.fillTab(tabId, item); } catch (e) { return { outcome: "blocked", why: "could not use this page: " + e.message, tabId }; }
      const before = await CA.inPage(tabId, () => window.__careerAgentState());
      if (baseline === null) baseline = before.confirmationAlready;
      const adv = await CA.inPage(tabId, (o) => window.__careerAgentAdvance(o), [{ company: item.company, allowSubmit, baselineConfirmed: baseline }]);
      if (adv.kind === "confirmed") return { outcome: "submitted", confirmation: adv.text, finalUrl: before.url, tabId };
      if (adv.kind === "blocked") return { outcome: "blocked", why: adv.why, tabId };
      if (adv.final) {
        for (let i = 0; i < 16; i++) { // up to ~16 s for the employer's confirmation
          await CA.sleep(1000);
          let text = null, url = before.url;
          try { text = await CA.inPage(tabId, (b) => window.__careerAgentConfirmed(b), [baseline]); url = (await CA.inPage(tabId, () => window.__careerAgentState())).url; } catch { /* the page is navigating */ }
          if (text) return { outcome: "submitted", confirmation: text, finalUrl: url, tabId };
        }
        return { outcome: "unconfirmed", why: "Pressed " + adv.button + ", but no confirmation message appeared. Check this tab or your email before sending it again.", tabId };
      }
      // Next / Continue: wait for the page to change before filling the next one
      let moved = false;
      for (let i = 0; i < 10 && !moved; i++) {
        await CA.sleep(1000);
        try { const now = await CA.inPage(tabId, () => window.__careerAgentState()); moved = now.sig !== before.sig || now.url !== before.url; } catch { moved = true; }
      }
      if (!moved) return { outcome: "blocked", why: "the page did not move on after " + adv.button + " (it may be showing an error)", tabId };
    }
    return { outcome: "blocked", why: "the form has more than 8 pages", tabId };
  },

  /** The waiting applications the extension may take over, one after another. Applications it cannot finish go back to you with the reason. */
  async runQueue() {
    const results = [];
    const { settings = {}, tried = {} } = await chrome.storage.local.get(["settings", "tried"]);
    const fresh = await CA.refresh();
    const { fillData } = await chrome.storage.local.get("fillData");
    if (!fillData || fresh.source === "manual") return { results, stopped: "Link Career Agent first (the automatic mode needs the link code)." };
    const auto = fillData.autoSubmit || { allowed: false, remainingToday: 0, why: "Career Agent did not say." };
    if (!auto.allowed) return { results, stopped: auto.why };
    const statuses = new Set(["needs_input", "failed", ...(settings.includeAssistant ? ["assisted_pending"] : [])]);
    const DAY = 24 * 3600 * 1000;
    let remaining = auto.remainingToday;
    for (const item of (fillData.queue || []).filter((q) => statuses.has(q.status))) {
      if (tried[item.id] && Date.now() - tried[item.id] < DAY) continue; // it stopped on something for you; not retried for a day unless you open it yourself
      if (remaining <= 0) return { results, stopped: "Today's limit of applications is used up." };
      try { await CA.report(item.id, { action: "claim" }); }
      catch (e) { if (e.global) return { results, stopped: e.message }; results.push({ id: item.id, company: item.company, title: item.title, outcome: "skipped", why: e.message, at: Date.now() }); continue; }
      let r;
      try { r = await CA.process(item, true); } catch (e) { r = { outcome: "blocked", why: "something went wrong: " + e.message }; }
      try {
        if (r.outcome === "submitted") { await CA.report(item.id, { action: "submitted", confirmation: r.confirmation, finalUrl: r.finalUrl }); remaining--; }
        else await CA.report(item.id, { action: "release", note: r.why });
      } catch (e) { r.why = (r.why ? r.why + "; " : "") + "could not tell Career Agent: " + e.message; }
      if (r.outcome === "submitted") { try { await chrome.tabs.remove(r.tabId); } catch { /* already closed */ } }
      else if (r.outcome === "blocked") { tried[item.id] = Date.now(); try { await chrome.tabs.remove(r.tabId); } catch { /* already closed */ } }
      else { tried[item.id] = Date.now(); } // "unconfirmed": the tab stays open so you can check it
      results.push({ id: item.id, company: item.company, title: item.title, outcome: r.outcome, why: r.why || null, at: Date.now() });
      await chrome.storage.local.set({ tried });
    }
    return { results, stopped: null };
  },
};
