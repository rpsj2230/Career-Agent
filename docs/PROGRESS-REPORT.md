# Progress report (written overnight, 22–23 October 2026)

This is the full picture: what works and how sure we are, what changed, what is left, and what only you can do. Everything below was tested with unit tests, browser tests against
mock pages, and 590 end-to-end checks. **None of it could be tried against the live LinkedIn, Naukri, Adzuna, Workday or your Supabase from where it was written**; the sections say exactly where that matters.

## 1. Is the LinkedIn Easy Apply driver working? An honest answer

**Not yet proven.** What the real logs from your Mac show so far:

| Step | Seen live? | Evidence |
|---|---|---|
| Open the job, find the right Apply button | Yes, after fixes | Easy Apply window found (native dialog, 4 pages); earlier a job card's "Easy Apply" was pressed by mistake (fixed in #111) |
| Contact page already filled by LinkedIn | Yes | the probe |
| Resume written for the job uploaded in the window | Yes | "Uploaded the resume written for this job" on four applications |
| Walk the pages, Review, Submit, confirmation | **Once** | Sands China: "Submitted and confirmed by the portal" |
| Questions answered from your data | Partly | one AI answer worked; years, language and self-identification rules are new and untried live |
| Stuck pages | **Not solved** | Deloitte (8 pages), BOC Aviation ("no message; buttons: Dismiss, Back, Review"): cause unknown |

In the logs you sent, about one Easy Apply in six was sent. The failures found since were all real bugs and are fixed, but a fix proven only on a mock page is not proof:
the wrong-job click (#111), no way to answer "years with a tool" and language questions (#108, #117), self-identification questions needing the AI (#124), Submit chosen with a page-wide search that could have
pressed LinkedIn's search or messaging "Send" (#119), an older resume sent if the upload failed (#119), a dropdown left on "Select an option" (#113), AI models failing and being retried (#112).

**What I could not find:** why BOC Aviation's form did not move on with no message. The assistant now saves a picture of where it stopped and prints the page's own messages and the browser's validity verdict for each field, so the next failure explains itself.

**How you can check it yourself, in order of effort:**
1. Run the assistant on 5 to 10 LinkedIn jobs. In Applications, a sent one shows "Submitted" with the employer's confirmation text; the Who-applied card says who sent it and how it is known.
2. LinkedIn itself: Jobs, My jobs, Applied. Every one the app marked sent should be there.
3. Turn on "read replies" in Settings: LinkedIn's own "Your application was sent to ..." email now confirms an application on its card (#120).
4. `npm run assist:probe -- "<a LinkedIn job link>"` walks every page of a real Easy Apply form without filling or sending anything, and prints its structure. Send me the output of any that fail.

## 2. The plan, item by item

| Item | State | Notes |
|---|---|---|
| 109 Confirm LinkedIn applications from LinkedIn's receipt email | Done (#120) | needs the mailbox connected and "read replies" on; not tried on a real mailbox |
| 110 LinkedIn Easy Apply driver | Built, hardened, not proven (section 1) | |
| 111 Naukri driver | Built (#121), **not tried on Naukri** | reads Naukri's own words, presses only this job's Apply, handles instant apply, questions, company site, sign-in; every surprise is handed back with what the page showed |
| 112 Attached-browser mode | **Deliberately not built** | attaching to a browser you already run cannot enforce "never download", and needs a debugging port open that any program on the Mac could use to drive your browser. Say so if you want it anyway |
| 113 Applicability gate | Done (#118) | no resume for MyCareersFuture or an Adzuna-style link without a Google for Jobs key; saves model tokens |
| 114 Form check / re-read verifier | Done (#122) | the page is read back after filling; a cleared answer is retyped once, and if lost again nothing is sent. A separate "dry run before approval" was not built (it would visit employer pages without sending) |
| 115 Answer questions in the app | Done (#109) | card on Applications and on each application |
| 116 Direct-board discovery / "cloud" label | Done (#120) | every job row says Cloud, Your computer, or By hand |
| 117 Browser extension (last resort) | Done (#123), **not loaded in your browser** | `extension/README.md` |
| 118 Your steps | Section 4 | |

## 3. What changed this session (merged pull requests)

#108 Easy Apply questions and the resume step · #109 answer card, signed-in check, stalled-form message · #110 safety (no passwords, scam pages, downloads) and Yes/No boxes ·
#111 press only this job's Apply · #112 AI resilience · #113 stuck Easy Apply pages · #114 interview answers into the Answer bank · #115 View and Approve a resume ·
#116 free storage (pictures deleted after sending or closing) · #117 languages and years from your roles · #118 job portals, no resume for jobs that cannot be applied for, local model ·
#119 Easy Apply hardening · #120 receipt emails and job labels · #121 Naukri · #122 re-read verifier · #123 browser extension · #124 self-identification answers.

## 4. Your actions (in this order)

This list is also in the app as a checklist you can tick: **Your to-do** in the left menu (under Dashboard).

1. On the Mac: `git pull && npm install && bash scripts/autostart/install.sh`. For the extension also `npm run build:extension`.
2. **Models page**: switch off the four Groq models your account cannot use (llama-3.3, qwen3, kimi-k2, llama4-scout). Use **Test** on the Mistral and Gemini rows (they returned blank errors); fix or replace the keys.
   Groq's daily tokens were used up: resume writing was spending them on jobs that could never be applied for (that is now stopped), so tomorrow's allowance should last.
3. **Profile**: type your languages in the **Languages** card at the top (`English: fluent (read, write, speak); Hindi: fluent (read, write, speak)`) and press *Save languages*. Then press *Write the interview answers from my profile*: it runs on GitHub (with the local model when the free models are out), so wait 5 to 15 minutes, reload, and read and edit each answer in the Answer bank.
4. Optional, recommended: a **JSearch (Google for Jobs) key** on the Portals page, so Adzuna links can be traced to the employer's own page. Without it those jobs are left for you by hand.
5. Optional: a local AI model so applications do not stop when the free models fail: `docs/LAPTOP_SETUP.md`, section "A local AI model on your Mac".
6. Optional: Settings, turn on reading replies, so receipts and employer replies are matched to applications.
7. Press **Apply with assistant**. Then send me `tail -n 60 ~/.career-agent/assistant.log`, a screenshot of **Latest results**, and, for any "Needs you" that says it could not reach the final step, the picture on that application ("What the page looked like when it stopped").
8. Open **Resumes**: the ones tagged *needs review* have **View** (opens in a new tab) and **Approve**.

## 4b. Decisions I need from you

- Attached-browser mode (#112): leave it out (my recommendation) or build it with its limits?
- The years rule (12 years for a tool your profile does not show, 3 for AI tools) is applied automatically. It may be asked about in interviews. Keep, lower, or ask each time?
- Brave: the assistant shares the Brave app with your own browsing. It works for you now; if it ever blocks you again, the fix is switching the assistant to its own Chromium (one re-login to LinkedIn).

## 5. Rules the agent follows whatever the site asks

Never types a password, payment or identity number, or a one-time code; never creates an account; never downloads or installs anything (the browser refuses downloads); never touches a page that is not the employer's, a known
application system or job portal, a page whose own posting data names the employer, or a site you added to `~/.career-agent/trusted-sites.txt`; never presses Submit outside the application window; never sends an older resume
in place of the one written for the job; never states a number about you that is not in your profile (except the years default you chose).

## 6. Known limits

- Adzuna refuses the assistant's browser; MyCareersFuture needs Singpass; Workday, Taleo, iCIMS and SuccessFactors need an account per employer (the browser extension is for these).
- Free AI models run out daily; the app now skips models that are failing and asks each question once, but with every model down the question goes to you.
- Naukri, the extension in a real browser, the receipt mailbox and picture cleanup on your Supabase have only been exercised against mocks.
