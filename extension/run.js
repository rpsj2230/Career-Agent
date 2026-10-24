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

  /**
   * Ask Career Agent how to answer the questions the page asked and your data could not answer (it looks through your saved answers for another wording of the same
   * question, and may ask its AI models, from your profile only; what it learns is saved to your answer bank). Returns [{ question, answer }].
   */
  async learn(questions) {
    if (!questions.length) return [];
    try {
      const res = await CA.api("/api/extension/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questions: questions.slice(0, 8).map((q) => ({ question: q.label, options: (q.options || []).slice(0, 40), kind: q.kind })) }) });
      const j = await res.json();
      return (j.answers || []).filter((a) => a && a.answer).map((a) => ({ question: a.question, answer: a.answer }));
    } catch { return []; }
  },

  /** One pass over the form: plain fields, radio buttons, boxes and <select>s, then the dropdowns that open a list. */
  async fillOnce(tabId, data) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    const [{ result: plain }] = await chrome.scripting.executeScript({ target: { tabId }, func: (d) => window.__careerAgentFill(d), args: [data] });
    let dd = { filled: [], forYou: [], questions: [] };
    try { const [{ result: more }] = await chrome.scripting.executeScript({ target: { tabId }, func: (d) => window.__careerAgentDropdowns(d), args: [data] }); if (more) dd = more; } catch { /* this page has none, or is changing */ }
    return { ...plain, filled: [...plain.filled, ...dd.filled], forYou: [...plain.forYou, ...dd.forYou], questions: [...(plain.questions || []), ...dd.questions] };
  },

  /**
   * Fill the form in a tab and attach the application's resume. Never presses a button. A question with no answer in your data is looked up with Career Agent once
   * and the form is filled again with what it says; `learned` carries answers found earlier for this application. Returns the report plus `learned` (answers found now).
   */
  async fillTab(tabId, item, learned) {
    const { fillData: base } = await chrome.storage.local.get("fillData");
    if (!base) throw new Error("No data yet: link Career Agent first");
    const withLearned = (extra) => ({ ...base, answers: [...extra, ...(base.answers || [])] });
    let report = await CA.fillOnce(tabId, withLearned(learned || []));
    const found = [];
    const wanted = report.questions.filter((q) => q.required);
    if (wanted.length) {
      const got = await CA.learn(wanted);
      if (got.length) {
        found.push(...got);
        const again = await CA.fillOnce(tabId, withLearned([...(learned || []), ...got]));
        report = { ...again, filled: [...report.filled, ...again.filled] }; // what is still unanswered is what the second pass says
      }
    }
    let files = { attached: [], missing: [] };
    if (item && (item.resume || item.cover)) {
      let resume = null, cover = null, problem = null;
      try { resume = await CA.file(item, "resume"); cover = await CA.file(item, "cover"); } catch (e) { problem = e.message; }
      if (resume || cover) [{ result: files }] = await chrome.scripting.executeScript({ target: { tabId }, func: (r, c) => window.__careerAgentAttach(r, c), args: [resume, cover] });
      if (problem) files.missing.push("could not get the resume: " + problem);
    }
    return { ...report, files, learned: found };
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
    let baseline = null, asked = [];
    const learned = [];
    for (let step = 0; step < 8; step++) {
      await CA.sleep(step === 0 ? 1500 : 1000);
      try { const rep = await CA.fillTab(tabId, item, learned); learned.push(...rep.learned); asked = rep.questions.length ? rep.questions : asked; } catch (e) { return { outcome: "blocked", why: "could not use this page: " + e.message, tabId }; }
      const before = await CA.inPage(tabId, () => window.__careerAgentState());
      if (baseline === null) baseline = before.confirmationAlready;
      const adv = await CA.inPage(tabId, (o) => window.__careerAgentAdvance(o), [{ company: item.company, allowSubmit, baselineConfirmed: baseline }]);
      if (adv.kind === "confirmed") return { outcome: "submitted", confirmation: adv.text, finalUrl: before.url, tabId };
      if (adv.kind === "blocked") return { outcome: "blocked", why: adv.why, tabId, questions: asked.map((q) => q.label) };
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

  // ------------------------------------------------------------------------------------------------------------------------
  // Filter Auto Apply: the jobs you filtered on LinkedIn or Naukri, one after another. Career Agent decides whether each may be sent (switch, pause, limits, duplicates) and
  // keeps the record; the page-side reading is in content.js (window.__careerAgentSite).
  // ------------------------------------------------------------------------------------------------------------------------
  PACE_MS: 4000, // a pause between jobs so each page has settled and the portal is never hit faster than a person could work

  /** Tell Career Agent about a filtered-list job: { action: "check" | "submitted" | "needs_input", portal, company, title, url, jobKey, ... }. Throws with .global set when no job may be sent. */
  async external(body) {
    const link = await CA.link();
    if (!link) throw new Error("Not linked to Career Agent yet");
    const res = await fetch(link.origin + "/api/extension/external", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", Authorization: "Bearer " + link.token }, body: JSON.stringify(body) });
    if (res.ok) return res.json().catch(() => ({}));
    const j = await res.json().catch(() => ({}));
    const err = new Error(res.status === 401 ? "The link code is no longer valid. Make a new one in Career Agent: Profile." : j.error || "Career Agent answered " + res.status);
    err.global = !!j.global;
    throw err;
  },

  async stopped() { return (await chrome.storage.local.get("filterStop")).filterStop === true; },

  /** Poll until fn() gives something truthy, or the time is up (then null). */
  async until(fn, timeoutMs, stepMs = 400) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      try { const v = await fn(); if (v) return v; } catch { /* the page is changing */ }
      if (Date.now() > end) return null;
      await CA.sleep(stepMs);
    }
  },

  /** Run a function in the page without re-injecting the whole script each time (it is injected when the function is not there yet). */
  async call(tabId, func, args = []) {
    let present = false;
    try { const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => !!window.__careerAgentSite }); present = !!(r && r.result); } catch { /* the page is changing */ }
    if (!present) await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }); // not there yet, or the page navigated
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return result;
  },

  /** Put your default resume (the file on the Resumes page) into the page's file box. Used only when the form itself asks for a resume. */
  async attachDefault(tabId) {
    const { fillData } = await chrome.storage.local.get("fillData");
    if (!fillData || !fillData.defaultResume) return { attached: [], missing: ["no default resume"] };
    const f = await CA.file({ isDefault: true, resume: fillData.defaultResume }, "resume");
    return CA.call(tabId, (r) => window.__careerAgentAttach(r, null), [f]);
  },

  /**
   * The form that is open (an Easy Apply window, or Naukri's question panel): fill, then Next or Submit step after step until the portal confirms, or something only a person
   * should do stops it. `site` names the page-side helpers: { confirmed(): text | null }. Result: { kind: "sent", text } | { kind: "unconfirmed", why } | { kind: "stuck", why }.
   */
  async steps(tabId, company, site) {
    let baseline = null, attached = false, retries = 0, last = [];
    const learned = [];
    for (let i = 0; i < 16; i++) {
      await CA.sleep(1200);
      let rep;
      try { rep = await CA.fillTab(tabId, null, learned); } catch (e) { return { kind: "stuck", why: "could not use the window: " + e.message }; }
      learned.push(...rep.learned);
      last = rep.questions.length ? rep.questions : last;
      const before = await CA.call(tabId, () => window.__careerAgentState());
      if (baseline === null) baseline = before.confirmationAlready;
      const adv = await CA.call(tabId, (o) => window.__careerAgentAdvance(o), [{ company, allowSubmit: true, baselineConfirmed: baseline }]);
      if (adv.kind === "confirmed") return { kind: "sent", text: adv.text };
      if (adv.kind === "blocked") {
        if (!attached && /resume|\bcv\b|upload|file/i.test(adv.why)) { attached = true; await CA.attachDefault(tabId); continue; }
        // not complete: the questions the page names may be ones Career Agent can answer (another wording of one it knows, or one the AI can write from your profile)
        if (/^not complete/i.test(adv.why) && retries < 2) {
          retries++;
          const inv = await CA.call(tabId, () => window.__careerAgentInvalid());
          const got = await CA.learn(inv);
          if (got.length) { learned.push(...got); continue; }
          return { kind: "stuck", why: adv.why, questions: inv.map((q) => q.label) };
        }
        return { kind: "stuck", why: adv.why, questions: last.map((q) => q.label) };
      }
      if (adv.final) {
        for (let k = 0; k < 16; k++) {
          await CA.sleep(1000);
          let text = null;
          try { text = (await CA.call(tabId, site.confirmed)) || (await CA.call(tabId, (b) => window.__careerAgentConfirmed(b), [baseline])); } catch { /* the page is changing */ }
          if (text) return { kind: "sent", text };
        }
        return { kind: "unconfirmed", why: "Pressed " + adv.button + ", but no confirmation appeared. Check the portal's list of applied jobs before sending it again." };
      }
      const moved = await CA.until(async () => { const n = await CA.call(tabId, () => window.__careerAgentState()); return n.sig !== before.sig || n.url !== before.url; }, 10000, 800);
      if (!moved) {
        // the page stayed where it was: it usually says which question it is not satisfied with
        const inv = retries < 2 ? await CA.call(tabId, () => window.__careerAgentInvalid()) : [];
        retries++;
        const got = await CA.learn(inv);
        if (got.length) { learned.push(...got); continue; }
        return { kind: "stuck", why: "the form did not move on after " + adv.button + (inv.length ? " (it asks: " + inv.map((q) => q.label).join("; ") + ")" : " (it may be showing an error)"), questions: (inv.length ? inv : last).map((q) => q.label) };
      }
    }
    return { kind: "stuck", why: "the application has more than 16 steps" };
  },

  /** Tell Career Agent the outcome of one job; a failure to tell is reported in the result, never hidden. */
  async tell(body) {
    try { await CA.external(body); return null; }
    catch (e) { try { await CA.sleep(1500); await CA.external(body); return null; } catch (e2) { return "could not tell Career Agent: " + e2.message; } }
  },

  /** Say what is happening in a box on the page itself (and nothing breaks if the page cannot show it). */
  async say(tabId, message) { try { await CA.call(tabId, (m) => window.__careerAgentOverlay(m), [message]); } catch { /* the page is changing */ } },

  /** The list page, if the tab has moved away from it (some pages open a job on a page of its own). */
  async ensureList(tabId, listUrl, force) {
    const tab = await chrome.tabs.get(tabId);
    const same = (() => { try { return new URL(tab.url).pathname === new URL(listUrl).pathname; } catch { return false; } })();
    if (same && !force) return;
    await chrome.tabs.update(tabId, { url: listUrl });
    await CA.loaded(tabId);
    await CA.sleep(2500);
  },

  /** One LinkedIn job from the list: click it, read the job on the right, check it with Career Agent, press Easy Apply, work through the window, record what happened. */
  async linkedinOne(tabId, card, listUrl) {
    const S = (f, a) => CA.call(tabId, f, a || []);
    const out = (outcome, why, x) => ({ id: card.id, company: card.company, title: card.title, outcome, why: why || null, ...(x || {}) });
    const facts = async () => { try { return " Page: " + JSON.stringify(await S(() => window.__careerAgentSite.linkedin.facts())).slice(0, 700); } catch { return ""; } };
    await S((sel) => window.__careerAgentSetScope(sel), [null]);
    if (!(await S((id) => window.__careerAgentSite.linkedin.select(id), [card.id]))) return out("skipped", "its card is no longer on the page");
    const d = await CA.until(async () => { const x = await S(() => window.__careerAgentSite.linkedin.detail()); return x && x.id === card.id ? x : null; }, 9000);
    if (!d) return out("skipped", "the job did not open on the right of the page after clicking it." + (await facts()));
    await CA.sleep(1200); // the job's own details (and its Apply button) draw a moment after its address changes
    const block = await S(() => window.__careerAgentSite.linkedin.blocker());
    if (block) return out("blocked", block, { stop: true });
    const d2 = await S(() => window.__careerAgentSite.linkedin.detail());
    const company = d2.company || card.company, title = (card.title || d2.title), here = (outcome, why, x) => ({ ...out(outcome, why, x), company, title });
    if (!d2.easy && d2.applied) return here("skipped", 'LinkedIn shows "' + d2.applied + '"');
    if (!d2.easy && d2.closed) return here("skipped", "LinkedIn says it no longer takes applications");
    if (!d2.easy) return here("skipped", d2.external ? "it applies on the company's own site, not with Easy Apply" : "no Easy Apply button was found for it." + (await facts()));
    const job = { portal: "linkedin", company, title, url: d2.url, jobKey: card.id, location: d2.location || undefined };
    try { await CA.external({ action: "check", ...job }); } catch (e) { return here("skipped", e.message, { stop: !!e.global }); }
    if (!(await S(() => window.__careerAgentSite.linkedin.pressEasyApply()))) return here("skipped", "the Easy Apply button was not found");
    const kind = await CA.until(() => S(() => window.__careerAgentSite.linkedin.windowOpen()), 10000);
    if (!kind) {
      const b = await S(() => window.__careerAgentSite.linkedin.blocker());
      return here(b ? "blocked" : "skipped", b || "the Easy Apply window did not open." + (await facts()), { stop: !!b });
    }
    if (kind === "page") await S((sel) => window.__careerAgentSetScope(sel), ["main"]); // the steps are on a page of their own, not in a window
    const r = await CA.steps(tabId, company, { confirmed: () => window.__careerAgentSite.linkedin.sent() });
    const leave = async (done) => {
      if (kind === "page") { await CA.ensureList(tabId, listUrl, true); return; }
      await S((x) => window.__careerAgentSite.linkedin.close(x), [!done]);
      if (!done) { await CA.sleep(1000); await S(() => window.__careerAgentSite.linkedin.discard()); }
      await CA.until(async () => !(await S(() => window.__careerAgentSite.linkedin.windowOpen())), 4000);
    };
    if (r.kind === "sent") {
      await leave(true);
      const problem = await CA.tell({ action: "submitted", ...job, confirmation: r.text, finalUrl: d2.url });
      return here("submitted", problem);
    }
    if (r.kind === "unconfirmed") { // the window is left open for you to look at; nothing more is sent in this run
      const problem = await CA.tell({ action: "needs_input", ...job, note: r.why });
      return here("unconfirmed", [r.why, problem].filter(Boolean).join("; "), { stop: true });
    }
    await leave(false);
    const problem = await CA.tell({ action: "needs_input", ...job, note: r.why, questions: r.questions || [] });
    return here("blocked", [r.why, problem].filter(Boolean).join("; "));
  },

  /** One Naukri job from the list, in its own tab: check it, press Apply, answer the follow-up questions if there are any, record what happened. */
  async naukriOne(card) {
    const out = (outcome, why, x) => ({ id: card.id, company: card.company, title: card.title, outcome, why: why || null, ...(x || {}) });
    const tab = await chrome.tabs.create({ url: card.url, active: true });
    const tabId = tab.id;
    let keep = false; // a send that could not be confirmed leaves its tab open for you to look at
    try {
      await CA.loaded(tabId);
      await CA.sleep(2000);
      const st = await CA.call(tabId, () => window.__careerAgentSite.naukri.state());
      if (st.applied) return out("skipped", 'Naukri shows "' + st.applied + '"');
      if (st.closed) return out("skipped", "Naukri says it no longer takes applications");
      if (st.loginWall) return out("blocked", "Naukri is asking you to sign in", { stop: true });
      if (!st.apply) return out("skipped", st.external ? "it applies on the company's own site" : "no Apply button was found (page " + st.url + ", buttons: " + (st.seen.join(" | ") || "none") + ")");
      const job = { portal: "naukri", company: card.company || "Unknown company", title: card.title, url: card.url, jobKey: card.id };
      try { await CA.external({ action: "check", ...job }); } catch (e) { return out("skipped", e.message, { stop: !!e.global }); }
      if (!(await CA.call(tabId, () => window.__careerAgentSite.naukri.pressApply()))) return out("skipped", "the Apply button was not found");
      const after = await CA.until(async () => { const s = await CA.call(tabId, () => window.__careerAgentSite.naukri.state()); return s.success ? { kind: "success" } : s.questions ? { kind: "questions" } : null; }, 12000, 600);
      let result;
      if (after && after.kind === "success") result = { kind: "sent", text: "Naukri: you have successfully applied" };
      else if (after && after.kind === "questions") {
        await CA.call(tabId, (sel) => window.__careerAgentSetScope(sel), ['[class*="chatbot" i], [class*="drawer" i], [role="dialog"], [aria-modal="true"]']);
        result = await CA.steps(tabId, job.company, { confirmed: () => { const s = window.__careerAgentSite.naukri.state(); return s.success ? "Naukri: you have successfully applied" : null; } });
      } else result = { kind: "stuck", why: "pressed Apply but Naukri showed neither a confirmation nor questions" };
      if (result.kind === "sent") { const problem = await CA.tell({ action: "submitted", ...job, confirmation: result.text, finalUrl: card.url }); return out("submitted", problem); }
      const problem = await CA.tell({ action: "needs_input", ...job, note: result.why, questions: result.questions || [] });
      if (result.kind === "unconfirmed") { keep = true; return out("unconfirmed", [result.why, problem].filter(Boolean).join("; "), { stop: true }); }
      return out("blocked", [result.why, problem].filter(Boolean).join("; "));
    } finally {
      if (!keep) { try { await chrome.tabs.remove(tabId); } catch { /* already closed */ } }
    }
  },

  /**
   * Filter Auto Apply on the tab you are looking at: LinkedIn Jobs (filtered to Easy Apply) or a Naukri job list. Works through its cards one at a time, up to `max`, within what
   * Career Agent allows, and stops for good at a security check, a portal limit, a sign-in wall, or a send it could not confirm. A box on the page says what it is doing.
   * Result: { results, stopped }.
   */
  async runFilter(tabId, max) {
    const results = [];
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || "";
    const portal = /linkedin\.com\/jobs/i.test(url) ? "linkedin" : /naukri\.com/i.test(url) ? "naukri" : null;
    if (!portal) return { results, stopped: "Open LinkedIn Jobs (with the Easy Apply filter on) or a Naukri job list in this tab first." };
    const fresh = await CA.refresh();
    const { fillData } = await chrome.storage.local.get("fillData");
    if (!fillData || fresh.source === "manual") return { results, stopped: "Link Career Agent first (this mode needs the link code)." };
    const rules = fillData.filter && fillData.filter[portal];
    if (!rules) return { results, stopped: "Career Agent did not say what is allowed. Update the app, then try again." };
    if (!rules.allowed) { await CA.say(tabId, rules.why); return { results, stopped: rules.why }; }
    const limit = Math.max(1, Math.min(Number(max) || 10, 25, rules.remaining));
    await chrome.storage.local.set({ filterStop: false });
    let sent = 0, stopped = null;
    const seen = new Set();
    const save = () => chrome.storage.local.set({ filterRun: { portal, at: Date.now(), results, running: true, limit } });
    let listUrl = url;
    await CA.say(tabId, "Starting. Looking for the jobs on this page...");
    for (let page = 0; page < 8 && sent < limit && !stopped; page++) {
      let cards;
      if (portal === "linkedin") {
        listUrl = (await chrome.tabs.get(tabId)).url || listUrl;
        for (let k = 0; k < 3; k++) { await CA.call(tabId, () => window.__careerAgentSite.linkedin.scrollList()); await CA.sleep(1200); }
        cards = await CA.call(tabId, () => window.__careerAgentSite.linkedin.cards());
      } else cards = await CA.call(tabId, () => window.__careerAgentSite.naukri.cards());
      if (!cards || !cards.length) {
        const facts = await CA.call(tabId, portal === "linkedin" ? () => window.__careerAgentSite.linkedin.facts() : () => window.__careerAgentSite.naukri.facts()).catch(() => null);
        if (!results.length) stopped = "No jobs were found on this page. What the page shows: " + JSON.stringify(facts).slice(0, 700);
        break;
      }
      for (const card of cards) {
        if (sent >= limit) break;
        if (await CA.stopped()) { stopped = "Stopped by you."; break; }
        if (seen.has(card.id)) continue;
        seen.add(card.id);
        await CA.say(tabId, `${sent} sent so far (up to ${limit}).\nNow: ${card.title || card.id}${card.company ? " at " + card.company : ""}`);
        let r;
        if (portal === "linkedin") {
          if (card.applied) r = { id: card.id, company: card.company, title: card.title, outcome: "skipped", why: "LinkedIn shows it as Applied" };
          else if (!card.easy) r = { id: card.id, company: card.company, title: card.title, outcome: "skipped", why: "not an Easy Apply job" };
          else {
            try { await CA.ensureList(tabId, listUrl, false); r = await CA.linkedinOne(tabId, card, listUrl); }
            catch (e) { r = { id: card.id, company: card.company, title: card.title, outcome: "blocked", why: "something went wrong: " + e.message }; }
          }
        } else { try { r = await CA.naukriOne(card); } catch (e) { r = { id: card.id, company: card.company, title: card.title, outcome: "blocked", why: "something went wrong: " + e.message }; } }
        results.push({ id: r.id, company: r.company, title: r.title, outcome: r.outcome, why: r.why, at: Date.now() });
        if (r.outcome === "submitted") sent++;
        await save();
        if (r.stop) { stopped = r.why; break; }
        if (r.outcome !== "skipped") await CA.sleep(CA.PACE_MS);
      }
      if (stopped || sent >= limit) break;
      const moved = await CA.call(tabId, portal === "linkedin" ? () => window.__careerAgentSite.linkedin.nextPage() : () => window.__careerAgentSite.naukri.nextPage());
      if (!moved) break;
      await CA.sleep(4000);
      if (portal === "naukri") await CA.loaded(tabId);
    }
    const done = results.filter((r) => r.outcome === "submitted").length;
    await CA.say(tabId, (stopped ? "Stopped: " + stopped + "\n" : "Finished.\n") + `${done} sent, ${results.filter((r) => r.outcome === "blocked" || r.outcome === "unconfirmed").length} given back to you, ${results.filter((r) => r.outcome === "skipped").length} skipped.`);
    return { results, stopped };
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
        else await CA.report(item.id, { action: "release", note: r.why, questions: r.questions || [] });
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
