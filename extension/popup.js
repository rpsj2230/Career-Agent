const $ = (id) => document.getElementById(id);
const say = (t, cls) => { $("out").textContent = t; $("out").className = cls || ""; };
const MANIFEST = chrome.runtime.getManifest();
const NONE = "";
const DEFAULT = "default";

function describe(report) {
  const lines = [`Filled ${report.filled.length} field(s).`];
  if (report.files && report.files.attached.length) lines.push(`Attached: ${report.files.attached.join(", ")}.`);
  if (report.files && report.files.missing.length) lines.push(`Not attached: ${report.files.missing.join("; ")}`);
  if (report.forYou.length) lines.push(`You answer (outlined in orange): ${report.forYou.join("; ")}`);
  if (report.secret.length) lines.push(`You type yourself (never filled): ${report.secret.join("; ")}`);
  if (report.error) lines.push(`Problem: ${report.error}`);
  return lines.join("\n");
}

const OUTCOME = { submitted: "sent", unconfirmed: "pressed Submit, not confirmed: check the open tab", blocked: "given back to you", skipped: "skipped" };

async function renderAuto(fillData) {
  const { settings = {}, autoLast, autoRunning } = await chrome.storage.local.get(["settings", "autoLast", "autoRunning"]);
  $("autoRun").checked = !!settings.autoRun;
  $("includeAssistant").checked = !!settings.includeAssistant;
  const auto = fillData && fillData.autoSubmit;
  const lines = [];
  if (autoRunning) lines.push("Running now...");
  else if (auto && !auto.allowed) lines.push(`Not allowed now: ${auto.why}`);
  else if (auto) lines.push(`Allowed: ${auto.remainingToday} more application(s) today.`);
  if (autoLast) {
    lines.push(`Last run ${new Date(autoLast.at).toLocaleString()} (${autoLast.trigger === "timer" ? "by itself" : "by you"}): ${autoLast.results.filter((r) => r.outcome === "submitted").length} sent, ${autoLast.results.filter((r) => r.outcome !== "submitted").length} not.`);
    if (autoLast.stopped) lines.push(`Stopped: ${autoLast.stopped}`);
    for (const r of autoLast.results.slice(0, 12)) lines.push(`- ${r.company}: ${OUTCOME[r.outcome] || r.outcome}${r.why ? ` (${r.why})` : ""}`);
  }
  $("autoOut").textContent = lines.join("\n");
  $("autoOut").className = "note " + (auto && !auto.allowed ? "warn" : "");
  $("runAuto").disabled = !!autoRunning;
}

const MODES = ["fallback", "manual", "filter"];
const modeOf = (settings) => (MODES.includes(settings.mode) ? settings.mode : "fallback");

async function renderFilter(fillData, settings) {
  const { filterRun } = await chrome.storage.local.get("filterRun");
  $("filterMax").value = settings.filterMax || 10;
  const lines = [];
  const f = fillData && fillData.filter;
  if (f) for (const [name, label] of [["linkedin", "LinkedIn"], ["naukri", "Naukri"]]) lines.push(f[name].allowed ? `${label}: ${f[name].remaining} more allowed today.` : `${label}: not allowed now: ${f[name].why}`);
  if (filterRun) {
    const done = filterRun.results || [];
    lines.push(`${filterRun.running ? "Running now" : "Last run"} ${new Date(filterRun.at).toLocaleString()}: ${done.filter((r) => r.outcome === "submitted").length} sent, ${done.filter((r) => r.outcome === "blocked" || r.outcome === "unconfirmed").length} given back to you, ${done.filter((r) => r.outcome === "skipped").length} skipped.`);
    if (filterRun.stopped) lines.push(`Stopped: ${filterRun.stopped}`);
    for (const r of done.slice(-12)) lines.push(`- ${r.company}: ${OUTCOME[r.outcome] || r.outcome}${r.why ? ` (${r.why})` : ""}`);
  }
  $("filterOut").textContent = lines.join("\n");
  $("runFilter").disabled = !!(filterRun && filterRun.running);
}

async function render() {
  const { fillData, syncedAt, settings = {} } = await chrome.storage.local.get(["fillData", "syncedAt", "settings"]);
  const mode = modeOf(settings);
  for (const r of document.querySelectorAll('input[name="mode"]')) r.checked = r.value === mode;
  $("panel-fallback").hidden = mode !== "fallback";
  $("panel-filter").hidden = mode !== "filter";
  await renderAuto(fillData);
  await renderFilter(fillData, settings);
  const link = await CA.link();
  $("status").textContent = link ? `Linked to ${new URL(link.origin).host}${syncedAt ? ` · data from ${new Date(syncedAt).toLocaleTimeString()}` : ""}` : fillData ? "Not linked: using the pasted data file." : "Not linked yet. Open \"Link to Career Agent\" below.";
  $("status").className = link ? "ok" : "warn";
  $("linkbox").open = !link && !fillData;
  $("update").textContent = fillData && CareerAgentLib.isNewer(fillData.latestExtensionVersion, MANIFEST.version) ? `A newer extension (${fillData.latestExtensionVersion}) is available: download it again from Career Agent: Profile.` : "";
  const queue = (fillData && fillData.queue) || [];
  const sel = $("forapp");
  sel.innerHTML = "";
  sel.add(new Option("Do not upload a resume", NONE));
  const def = fillData && fillData.defaultResume;
  if (def) sel.add(new Option(`Upload my default resume (${def.name})`, DEFAULT));
  for (const q of queue.filter((x) => x.resume)) sel.add(new Option(`Upload the resume for: ${q.company}, ${q.title}`, q.id));
  sel.hidden = !def && queue.length === 0;
  // a page that belongs to one of your applications gets that application's resume; any other page gets your default resume
  let note = def ? "This page is not one of your applications: your default resume is used." : "";
  sel.value = def ? DEFAULT : NONE;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const match = tab && tab.url ? CareerAgentLib.itemForPage(queue, tab.url) : null;
    if (match && match.resume) { sel.value = match.id; note = `This page is your application for ${match.company}: its own resume is used.`; }
  } catch { /* no tab info */ }
  $("forappNote").textContent = def || queue.length ? note : "No default resume yet: upload one on the Resumes page in Career Agent to have it attached on any page.";
  const box = $("queue");
  box.innerHTML = "";
  $("next").disabled = queue.length === 0;
  if (!queue.length) box.innerHTML = "<p><small>Nothing waiting. Applications the assistant could not finish appear here.</small></p>";
  const reports = await chrome.storage.local.get(queue.map((q) => "report:" + q.id));
  for (const q of queue) {
    const div = document.createElement("div"); div.className = "item";
    const rep = reports["report:" + q.id];
    div.innerHTML = `<b></b><small></small><div class="note"></div><div class="row"></div>`;
    div.querySelector("b").textContent = `${q.company}: ${q.title}`;
    div.querySelector("small").textContent = q.note + (q.resume ? " · resume ready" : " · no resume file");
    if (rep) { div.querySelector(".note").textContent = describe(rep); div.querySelector(".note").className = "note " + (rep.forYou.length || rep.error ? "warn" : "ok"); }
    const row = div.querySelector(".row");
    const open = document.createElement("button"); open.textContent = rep ? "Open again and fill" : "Open and fill";
    open.onclick = () => openOne(q.id);
    row.append(open);
    if (rep) {
      const sent = document.createElement("button"); sent.className = "secondary"; sent.textContent = "I submitted it";
      sent.onclick = async () => { sent.disabled = true; try { await CA.mark(q.id); await chrome.storage.local.remove("report:" + q.id); await CA.refresh(); } catch (e) { say(e.message, "warn"); } render(); };
      row.append(sent);
    }
    box.append(div);
  }
}

async function ensureAllSites() {
  const all = { origins: ["https://*/*"] };
  if (await chrome.permissions.contains(all)) return true;
  return chrome.permissions.request(all); // asked once, when you first open an application from here
}

async function openOne(id) {
  if (!(await ensureAllSites())) return say("Allowed sites are needed to open and fill an application. Nothing was opened.", "warn");
  say("Opening the application...");
  chrome.runtime.sendMessage({ type: "open-and-fill", id });
  window.close();
}

async function saveSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  const next = { ...settings, autoRun: $("autoRun").checked, includeAssistant: $("includeAssistant").checked, mode: modeOf(settings) };
  if (next.autoRun && !(await ensureAllSites())) { $("autoRun").checked = false; next.autoRun = false; say("Allowed sites are needed for the automatic mode.", "warn"); }
  if (next.autoRun && !(await CA.link())) { $("autoRun").checked = false; next.autoRun = false; say("Link Career Agent first (the automatic mode needs the link code).", "warn"); }
  await chrome.storage.local.set({ settings: next });
  chrome.runtime.sendMessage({ type: "settings-changed" });
}
for (const r of document.querySelectorAll('input[name="mode"]')) {
  r.onchange = async () => {
    const { settings = {} } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, mode: r.value } });
    chrome.runtime.sendMessage({ type: "settings-changed" });
    render();
  };
}
$("runFilter").onclick = async () => {
  if (!(await CA.link())) return say("Link Career Agent first (this mode needs the link code).", "warn");
  if (!(await ensureAllSites())) return say("Allowed sites are needed for this mode. Nothing was opened.", "warn");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/linkedin\.com\/jobs|naukri\.com/i.test(tab.url || "")) return say("Open LinkedIn Jobs (with the Easy Apply filter on) or a Naukri job list in this tab first, then press the button again.", "warn");
  const max = Math.max(1, Math.min(25, parseInt($("filterMax").value, 10) || 10));
  const { settings = {} } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: { ...settings, filterMax: max } });
  chrome.runtime.sendMessage({ type: "run-filter", tabId: tab.id, max });
  window.close();
};
$("stopFilter").onclick = async () => { await chrome.runtime.sendMessage({ type: "stop-filter" }); say("Stopping after the job it is working on.", "ok"); };
$("autoRun").onchange = saveSettings;
$("includeAssistant").onchange = saveSettings;

$("runAuto").onclick = async () => {
  if (!(await CA.link())) return say("Link Career Agent first (the automatic mode needs the link code).", "warn");
  if (!(await ensureAllSites())) return say("Allowed sites are needed for the automatic mode. Nothing was opened.", "warn");
  chrome.runtime.sendMessage({ type: "run-automatic" });
  window.close();
};

$("next").onclick = async () => {
  const { fillData } = await chrome.storage.local.get("fillData");
  const q = ((fillData && fillData.queue) || []);
  const reports = await chrome.storage.local.get(q.map((x) => "report:" + x.id));
  const next = q.find((x) => !reports["report:" + x.id]) || q[0];
  if (next) openOne(next.id); else say("Nothing is waiting.");
};

$("fill").onclick = async () => {
  const synced = await CA.refresh();
  const { fillData } = await chrome.storage.local.get("fillData");
  if (!fillData) return say("Link Career Agent first (open \"Link to Career Agent\").", "warn");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const chosen = $("forapp").value;
  const item = chosen === DEFAULT && fillData.defaultResume ? { id: DEFAULT, isDefault: true, resume: fillData.defaultResume, cover: null } : ((fillData.queue) || []).find((q) => q.id === chosen) || null;
  try {
    const report = await CA.fillTab(tab.id, item);
    say((synced.source === "cache" ? `(Could not reach Career Agent: ${synced.error}. Used the last copy of your data.)\n` : "") + describe(report), report.forYou.length || report.secret.length || report.files.missing.length ? "warn" : "ok");
  } catch (e) { say(`Could not fill this page: ${e.message}`, "warn"); }
};

$("link").onclick = async () => {
  const parsed = CareerAgentLib.parseLinkCode($("code").value);
  if (!parsed) return say("That is not a Career Agent link code. It looks like https://your-app|code.", "warn");
  const granted = await chrome.permissions.request({ origins: [parsed.origin + "/*"] });
  if (!granted) return say("Allowing the extension to talk to your Career Agent is needed to link it.", "warn");
  await chrome.storage.local.set({ link: parsed });
  const r = await CA.refresh();
  if (r.source !== "app") { await chrome.storage.local.remove("link"); return say(`Could not link: ${r.error}`, "warn"); }
  $("code").value = "";
  say("Linked. Your data now updates by itself.", "ok");
  render();
};
$("unlink").onclick = async () => { await chrome.storage.local.remove(["link", "syncedAt"]); say("Unlinked.", "ok"); render(); };

$("save").onclick = async () => {
  try { const d = JSON.parse($("data").value); if (d.version !== 1 || !d.applicant) throw new Error("not a Career Agent fill-data file"); await chrome.storage.local.set({ fillData: d }); say(`Saved for ${d.applicant.name}.`, "ok"); render(); }
  catch (e) { say(`That is not valid fill data: ${e.message}`, "warn"); }
};

chrome.action.setBadgeText({ text: "" });
CA.refresh().then(render);
