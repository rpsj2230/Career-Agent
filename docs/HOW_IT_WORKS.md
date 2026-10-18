# How it works: find, score, prepare, apply

The same four steps always run in the same order. The only difference is who starts them: you (buttons) or the clock (a schedule).

| Step | What happens | Where you see it |
|---|---|---|
| 1. Find | Each source is searched for each country and title. New postings are de-duplicated and stored as **new**. | Review queue > *Not scored yet*; Logs > Runs (scan counts per source) |
| 2. Score | Free rules reject obvious non-matches (country, pay, visa, blocklist, weak overlap). The rest are scored by a model in batches. Score >= threshold (default 65): **queued**. Below: **skipped** with the reason. | Review queue (queued); Review queue > *Rejected* (every reason); Logs |
| 3. Prepare | A tailored resume, cover letter and answers are made from your verified profile, checked, and stored. Scheduled runs prepare up to the schedule's limit; by hand it is the *Prepare* button on a job. | Applications > *prepared* |
| 4. Apply | You approve (button or Telegram), or a schedule does when **Settings > Auto-Apply** is on. Greenhouse, Lever, Ashby and Workable are submitted by the cloud worker; LinkedIn, Naukri and Indeed by the assistant on your computer; anything else is handed to you. | Applications (approved, submitted, assisted, needs input, failed); Dashboard funnel |

## Where the work runs

- **Buttons on the site** (*Find jobs now*, *Score new jobs*, *Prepare*) hand the work to GitHub Actions (`task.yml`) and answer at once, so a task can take several minutes with no 60-second limit. A banner on the Dashboard and Review queue shows "starting / running / finished" and refreshes itself. This needs `GITHUB_REPO` and `GITHUB_DISPATCH_TOKEN` in Vercel; without them the buttons run a short, time-boxed version inside the site (see below) and say so. *System > Automation > Test GitHub connection* checks both.
- **Schedules** run in GitHub Actions, which has no 60-second limit. An hourly check asks the app whether a schedule is due and only then starts the full run (search, score, prepare, approve within your rules). Hosted scrapers (Apify) run only there.
- **The apply assistant** runs on your computer for portals that need your own browser.

## Staying inside the 60-second limit

- Every web-triggered step has a time budget; discovery gets 30 s, scoring the rest up to 50 s, and a reply is always sent by 55 s.
- No model call or page fetch is started that cannot finish inside what is left; each model call is told how long it may take.
- Waiting for a slow source is capped by the budget, and hosted scrapers (minutes per run) are not run from buttons.
- Every decision is saved as it is made, so a stopped request loses nothing: the next press or the next scheduled run continues with the jobs still marked *new*.
- If you leave the page while a button is working, the page stops listening but results already saved stay saved; the request normally runs on and finishes. You will not see the confirmation, so look at Review queue or Logs.

## When you are needed

- Approve prepared applications (unless Auto-Apply is on).
- Questions the agent cannot answer are handed back to you on the Profile page; answer once and every waiting application resumes.
- Portals that need your own browser (LinkedIn, Naukri, Indeed): run the assistant and press Submit (or turn on hands-free mode).
- Security checks, CAPTCHAs and consent boxes are never handled for you.

## Keeping it working by itself

- **Hourly check** (GitHub): asks the app whether a schedule is due and starts the full run. Every check is recorded, so the app knows if the clock stops. GitHub sometimes runs scheduled checks hours late.
- **Daily backup check** (Vercel cron, `/api/cron/health`): independent of GitHub. It messages you on Telegram if anything on the checklist has failed and, if the hourly check has been silent for more than 3 hours, starts the pipeline itself.
- **System > Automation** lists every condition (clock, schedule, models, GitHub connection, last run, what to search) with the fix for anything wrong, and the Dashboard shows a banner when something needs attention.
- **Model keys** saved in the app are stored under both `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET`, so the GitHub runner can read them even if its Supabase key differs from the one in Vercel. The scheduled run prints which models it can use and messages you if none.

## The menu, the buttons and who does each step

**Menu groups.** *1 · Set up (one time)*: Profile, Resumes, Countries, Job sources, AI models, Settings. *2 · Find & score jobs*: Schedules (automatic), Jobs found & scored. *3 · Apply*: Applications. *Monitor*: Reports, Logs & history, System health.

**Buttons on "Jobs found & scored".**
- *Search job sites now*: fetches new postings from every connected source and stores them (they appear under "Found, not scored").
- *Score unscored jobs*: judges the stored postings against your profile; good matches move to "Matched".
- *Run full cycle now*: search, score and prepare resumes in one background run on GitHub (the same thing a schedule does).
The strip at the top of Dashboard, Jobs and Applications shows the five steps with counts and who performs each one. "What the last search did, source by source" explains why a source added nothing (switched off, not connected, failed, or nothing new).

**A schedule run does everything**: search, score, prepare tailored resumes, apply (or queue for approval, or queue for the laptop assistant). Each run is listed under *Run history* on the Schedules page. A failed run, or one cut short by a temporary model problem, is retried after one hour, up to three times.

**Models that fail.** Every model is tried in order, then the optional local model (Ollama on the GitHub runner, no laptop needed; Models page → Local model: Off / Only when needed / Always). If no model at all can be used, promising jobs are queued on the free rules alone, marked "rules only", and a model re-scores them as soon as one is available. Jobs are never dropped because a model failed.

**Daily report.** Settings → Daily report: once a day after the chosen hour, the report, the previous day's runs and a health summary (what is healthy, what is not, how to fix it) are sent by Telegram and email. Email uses the connected Gmail mailbox (app password). "Send now" tests it.

**Laptop assistant.** Applications on LinkedIn, Naukri and Indeed need your own browser. They wait in the queue as *assisted* until the assistant runs on your laptop, then are processed; a web page cannot start a program on your computer, so use the autostart or watcher described in ASSISTANT_AUTOSTART.md.

## Who applies, and what needs a login

| Posting is on | Who sends it | Login needed? |
|---|---|---|
| Greenhouse, Lever, Ashby, Workable | GitHub's computer, automatically | No. These forms are public. Your laptop can be off. |
| LinkedIn, Naukri, Indeed and similar | The **assistant on your computer** | Yes, once: you sign in inside the assistant's own browser window. The session is kept on your computer. |
| Any other site | You (the resume and answers are ready) | n/a |

The Applications list shows, for every row, **how it is applied** and the **next step** (Review and approve / Apply with assistant / Answer and finish / See why and retry / Done).

**Assistant.** Approving an application that needs the assistant leaves a "run now" request, so a running assistant starts within about 30 seconds. "Apply with assistant" on a row does the same. If the assistant is not running, the request waits (the application stays queued) until your computer is on and the assistant is started. `npm run assist:check` on your computer tells you exactly what is missing (settings, browser, portal sign-ins, hands-free switch, watcher).

## Resume quality

Each resume is written for one job. The model is told to name the job's role in the headline, write a summary around what that job asks for, reword each chosen bullet (strong verb, the job's own terms where the facts support them, the result with its exact figure), and pick the most relevant highlights, case studies and skills. The checker still rejects anything not in your profile. After writing, the resume is **measured locally**: share of the job's key terms you can honestly claim that are used, how many bullets were reworded, whether the headline and summary were written for the job. If it scores below 75, the model gets one or two more attempts with the specific problems; the best verified version is kept. The score and the job's terms your profile does not support (never added) are shown on the application page. If no model can write the resume, your master resume is used and the page says so in a warning box.

## Testing the local model

Models page → *Test the local model now*. It runs on GitHub (3 to 6 minutes): installs Ollama and the chosen model, asks a real job-scoring question, and records whether it answered and how long it took. The result stays on the page and is sent to Telegram.

## Applying by email

If a posting asks for applications by email, or lists an address, the application also gets an email: a subject, a message explaining why you fit the job (checked against your profile), and the tailored resume and cover letter attached. It is sent from your own mailbox (the one connected on Job sources; a Gmail app password) when you approve the application, only to an address that appears in the posting or one you type, never twice, and within a daily limit (Settings → Applying by email). When the posting accepts only email, the email *is* the application and sending it marks the application applied; if sending fails the application goes to "Needs your input" with the reason. The email is stored per application (settings key `email:<application id>`), so no database change is needed. Edit, re-write or send it from the "Email to the employer" card on the application page.

## Backlog, bulk actions, backups

- **Backlog:** the hourly check also works through jobs waiting to be scored and matches waiting for a resume (when no schedule is due), within a time and batch limit, and pauses for hours after rounds that make no progress.
- **Bulk actions:** Jobs and Applications have checkboxes; `/api/bulk` prepares, approves or skips up to 50 rows. Automatic applications approved together are sent by one batch run.
- **A service that refuses the key** (for example Apify rejecting its token) is tried once per run; its other searches are skipped instead of failing one by one.
- **Backups:** `docs/BACKUP.md`; **laptop setup:** `docs/LAPTOP_SETUP.md`.

## GitHub Actions minutes (what this app uses)

GitHub bills Actions by the minute, per job, rounded up to the whole minute. Public repositories are free and unlimited; a private repository on the free plan includes 2,000 Linux minutes a month. Measured from this app's own runs: the hourly check job is billed 1 minute each time (about 8 to 24 times a day, because GitHub often delays scheduled runs); a full scheduled run takes 15 to 32 minutes; a button-started task 5 to 15; the nightly backup about 2; the weekly apply check about 6; an apply batch about 5 to 10. Typical month: about 1,200 to 2,300 minutes, which is at or over the free private limit, so the repository is kept public (nothing secret is stored in it or printed in its logs).
