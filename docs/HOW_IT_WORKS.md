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
