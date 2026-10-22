const $ = (id) => document.getElementById(id);
const say = (t, warn) => { $("out").textContent = t; $("out").className = warn ? "warn" : ""; };
chrome.storage.local.get("fillData").then((r) => { if (r.fillData) $("data").value = JSON.stringify(r.fillData).slice(0, 80) + "... (saved)"; else say("Paste your fill data under \"Your data\" first.", true); });
$("save").onclick = async () => {
  try { const d = JSON.parse($("data").value); if (d.version !== 1 || !d.applicant) throw new Error("not a Career Agent fill-data file"); await chrome.storage.local.set({ fillData: d }); say(`Saved for ${d.applicant.name}.`); }
  catch (e) { say(`That is not valid fill data: ${e.message}`, true); }
};
$("fill").onclick = async () => {
  const { fillData } = await chrome.storage.local.get("fillData");
  if (!fillData) return say("Save your fill data first (open \"Your data\").", true);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (d) => window.__careerAgentFill(d), args: [fillData] });
    const lines = [`Filled ${result.filled.length} field(s).`];
    if (result.forYou.length) lines.push(`You answer (outlined in orange): ${result.forYou.join("; ")}`);
    if (result.secret.length) lines.push(`You type yourself (never filled): ${result.secret.join("; ")}`);
    say(lines.join("\n"), result.forYou.length > 0 || result.secret.length > 0);
  } catch (e) { say(`Could not fill this page: ${e.message}`, true); }
};
