# Career Agent

A personal job-search agent. It finds jobs, scores them against your profile, tailors your resume and cover
letter **using only facts from your own profile**, prepares the application, and applies when you click
**Approve**. Everything it sends is recorded so you can always see what was applied, with which resume.

- Dashboard (Next.js 16 + shadcn/ui) on Vercel
- Supabase for the database and file storage
- Free LLMs by default, configurable from the Models page (no code changes)
- Playwright apply worker on GitHub Actions (free)

**New here? Read the [User Guide](docs/USER_GUIDE.md)** (also as a shareable Word file: `docs/Career-Agent-User-Guide.docx`, rebuilt with `node scripts/build-guide.mjs`).

## Sign in with Google and team access
See `docs/GOOGLE_LOGIN.md`: Google sign-in (one-time Supabase setup) and limited accounts (Jobs & Apply, View only) under Settings, Team access.

## How it works

```
discover (Adzuna / JSearch / Remotive / Greenhouse / Lever / manual paste)
  -> de-duplicate across sources
  -> cheap filters, then fit score 0-100 with reasons        -> below threshold: skipped, reason kept
  -> you open a matched job and click "Prepare"
  -> tailored resume + cover letter, then a deterministic verifier checks every sentence
     (cited fact ids must exist; every number must appear in the cited facts)
  -> you review the diff against your original wording, then click Approve
        Greenhouse / Lever  -> worker fills and submits, stores a confirmation screenshot
        LinkedIn            -> assisted by default; automated only if you switch it on (capped)
        Naukri / Foundit / Shine / others -> assisted: package ready, you press the final submit
  -> audit trail, outcomes, reports, CSV export
```

### Safety rules built in
- The model can only cite fact ids from your confirmed profile. Company, title and dates are copied from the
  profile, never from model output. Invented numbers or unknown ids fail verification and block one-click approval.
- The worker never solves CAPTCHAs, passes LinkedIn checkpoints, or ticks consent/terms boxes. It hands the
  application back to you ("needs input") whenever a required question has no answer in your answer bank.
- Daily and weekly caps for automated applications, including a separate LinkedIn cap. When a cap is hit the
  package is prepared for manual submission; nothing is dropped.
- A LinkedIn security checkpoint switches LinkedIn automation off immediately.
- Sign-in uses Supabase Auth (email + password, httpOnly session cookie). The first account created becomes the **owner**; nobody else can register or use the app afterwards (extra emails can be allowed with the optional `ALLOWED_EMAILS`). Creating the account needs your `CRON_SECRET` as an invite code, so nobody can register your address before you do. With no owner yet, nobody is let in.
- Provider API keys can be pasted on the Models page; they are stored AES-256-GCM encrypted (key derived from your service-role key) and are never sent back to the browser.

## Setup (about 30 minutes)

1. **Supabase**: create a project. SQL Editor -> paste `supabase/migrations/0001_init.sql` -> Run.
   Copy the project URL and the `service_role` key (Project Settings -> API).
2. **Vercel**: import this GitHub repo. Add the environment variables from `.env.example`
   (at minimum the Required block plus one model key). Deploy.
   No other variables are needed: model keys are pasted in the app later.
3. **GitHub** (repo Settings -> Secrets and variables -> Actions) add:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, `CRON_SECRET`, and optionally
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `LINKEDIN_STORAGE_STATE`, `APP_TIMEZONE`.
   Schedules run in GitHub Actions (`pipeline.yml`): every hour it asks the app whether a schedule is due and only then
   installs and runs the pipeline (search, score, prepare, and approve/submit if the schedule allows it).
   Optional sources: connect a mailbox on the Portals page to read LinkedIn/Indeed/Glassdoor/Naukri job-alert emails (read-only IMAP, app password).
   Create a fine-grained token limited to this repo with "Actions: read and write" and put it in Vercel as
   `GITHUB_DISPATCH_TOKEN`.
4. Open the app. On the sign-in page choose **Create account**, enter your email, a password (10+ characters) and the
   invite code (your `CRON_SECRET` value). You become the owner and your browser or password manager can remember the login.
   Then open **Models**, press **Edit** on a model, paste its key, and press **Test**.
   The dashboard shows a three-step checklist:
   import your profile, add a model key, set roles and countries.

### Free model keys
Gemini (Google AI Studio), Groq, Cerebras, OpenRouter (`:free` models), Mistral and GitHub Models all offer free
tiers. Free-tier model ids, limits and data-use terms change often: confirm them on each provider's site, and edit
a model's id or add a new one on the **Models** page when something is renamed or retired. A row whose key variable
is not set is skipped automatically. Free providers may use your inputs for training, so remove ID numbers and
dates of birth from anything you upload.

A **Claude subscription does not provide API access**; the optional `claude-sonnet` row needs API credits.

### Your profile
Profile page -> upload your **master resume** (PDF/DOCX) once. It sets the profile's sections and wording, becomes the
master resume template on the Resumes page and is kept as the fallback resume. Optionally add **supporting documents**:
your LinkedIn **Save to PDF**, a second resume or the LinkedIn **data export** (.zip). These only add skills the master
resume lacks (used for job search and scoring, not printed in the template) and list anything else for you to review.
LinkedIn has no public profile API and forbids scraping, so only data you provide is used. The result is a **draft**:
review and edit it, then Confirm. Afterwards "Edit your profile" lets you add, change or remove skills, or edit the whole
profile as JSON.
The answer bank comes pre-listed with the standard application questions; facts already on your profile are filled in automatically.

### India portals
Naukri, Foundit, Shine and similar sites have no open APIs and restrict scraping. Discovery reaches India through
Adzuna and JSearch (which indexes many portals). For a posting you find on a portal or in an alert email, use
**Add job manually** (link + description); it then follows the normal score -> prepare -> approve flow and is
applied in assisted mode.

### Free coverage by country
No single free source has every job, so the agent combines several and merges duplicates (the same role at the same company in the same
country is stored once, with the other portals it was also seen on). Everything below is free; Apify is optional.

| Country | Free sources |
|---|---|
| India | Adzuna, JSearch (free plan), alert emails from Naukri, Foundit, Shine, LinkedIn, Indeed, company boards |
| Singapore | Adzuna, **MyCareersFuture** (government portal, no key), JobStreet/LinkedIn alert emails, JSearch |
| Australia | Adzuna, SEEK/LinkedIn alert emails, JSearch |
| Canada, US | Adzuna, LinkedIn/Indeed alert emails, JSearch, company boards, remote feeds |
| UAE and the Gulf | JSearch (Google for Jobs), alert emails from Bayt, Naukrigulf, GulfTalent, LinkedIn, company boards (Adzuna does not cover these) |

The **Countries** page shows, for each country you search, which sources are connected, what they cost, and what to add to fill gaps.
Apify (hosted scrapers) has a free monthly credit of about $5 (a few thousand jobs); the agent stops using it at the monthly job
budget you set, so scheduled runs cannot overspend. Alert emails are the most complete free route for the portals without an API:
set job alerts on each portal for your titles and countries, connect the mailbox once, and every alert is turned into a job.

### Apply assistant (LinkedIn, Naukri, Indeed, Foundit, Shine, Glassdoor and any employer site)
These portals cannot be driven from a server, and automating them from a cloud IP gets accounts challenged or banned. The
assistant runs on **your own computer**, in a real browser window using your own signed-in sessions:

0. On a Mac the one-line installer `scripts/mac-setup.sh` does steps 1 to 3 (see `docs/LAPTOP_SETUP.md`).
1. One-time: `npm ci`, `npx playwright install chromium`, and create `.env.local` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
2. In the dashboard, **Approve** the prepared applications (they appear as *assisted*).
3. Run `npm run assist:login` once. A browser window opens. Sign in to each portal in it the first time (the session is kept in
   `~/.career-agent/browser`; this app never sees or stores your portal passwords).
4. For each application it opens the posting, clicks Easy Apply / Apply, fills every field it can from your tailored resume,
   cover letter and saved answers, and **stops**. Review it, press the portal's own **Submit**, and the application is recorded
   (with what was filled and the exact files). Type `n` to leave it for later, `k` to skip the job, `q` to quit.

It never presses Submit, never solves or bypasses a CAPTCHA or security check (it waits for you), and paces itself between jobs.
Use your installed Chrome with `ASSIST_CHANNEL=chrome npm run assist`. Portals' terms restrict automation in general; because
you review and press Submit, and it runs from your own device, the risk is much lower than a server bot, but it is not zero.

### Fully automatic (no commands, no clicking)
The whole loop can run without you:

1. **Fetching** runs on the GitHub schedule. Portals with an API are read directly. For LinkedIn, Naukri, Indeed, SEEK/JobStreet/JobsDB and
   others, connect **Hosted scrapers (Apify)** on the Portals page: paste your Apify token, then add one row per scraper from the Apify
   Store (its id, the portal it reads, and its input with `{{title}}`, `{{location}}`, `{{country}}`, `{{days}}`, `{{max_items}}` where it
   expects them). They run on every schedule on Apify's servers, so none of your accounts is involved.
2. **Scoring, tailoring and approval** run in the same schedule (create it with *Approve automatically* if you want no review step;
   unverified documents are never approved automatically).
3. **Applying**: Greenhouse and Lever pages are submitted by the cloud worker. Everything else (LinkedIn, Naukri, Indeed, ...) is submitted
   by the assistant on your computer in **hands-free mode**: switch on **Settings > Auto-Apply** (the master switch, off by default; with it off, schedules and the assistant never submit by themselves) and *Settings > Application limits*, then run once
   `npm run assist` to sign in to each portal, and start `npm run assist:watch`. It checks every 20 minutes (`ASSIST_POLL_MINUTES`),
   only inside the hours you choose (`ASSIST_HOURS=9-21`), submits only within your daily limits, pauses 45-120 seconds between
   applications, hands back anything it cannot answer, and stops at the first CAPTCHA or security check.
   To start it when you log in: macOS, add a Login Item or a launchd agent that runs `npm run assist:watch` in this folder;
   Windows, a Task Scheduler task "At log on" running the same command; Linux, a `systemd --user` service. Your computer must be on and
   awake. Setting `ASSIST_HEADLESS=1` hides the window but some portals detect headless browsers; the default is a visible window.

Hands-free applying is against most portals' terms and can get an account warned or restricted. Keep the limits low, and prefer the
default mode (you press Submit) on LinkedIn.

## Development

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev
npm run typecheck && npx eslint . && npm test
npm run worker:apply         # needs APPLICATION_ID + Supabase env; normally run by GitHub Actions
```

`npm test` runs 87 tests: the verifier, model fallback, importers, job mappers and dedupe, caps, access rules and signup guards, the
SQL migration on an embedded Postgres (PGlite), and the form filler in a real Chromium against a local
fixture. `npm run build && npm run test:e2e` additionally runs the real built app against a local stand-in for Supabase
(sign-up, owner lock-out, login, logout, encrypted key storage and use). The browser tests need Chromium (`npx playwright install chromium`, or set `CHROMIUM_PATH`) and are
skipped when no browser path is configured.

## What is and is not verified

Verified by automated tests: the logic above, the database schema and constraints, the login gate, and the
production build. **Not exercised against live services** (they need your keys and accounts): Adzuna, JSearch and
Remotive responses, Greenhouse/Lever submission on real employer pages, the LinkedIn Easy Apply path, Telegram
delivery, and the Vercel/Supabase deployment itself. Expect to adjust small things on first real runs, especially
form matching on employers with unusual forms. LinkedIn automation is the least certain and carries account risk;
leave it off unless you accept that.

Other known limits: Vercel Hobby cron runs once a day; your **Schedules** page (hourly check in
`.github/workflows/pipeline.yml`) replaced the old fixed-time discovery workflow (removed); the prepare step makes two model calls and may need a function time limit
above your plan's default (`maxDuration` is set to 120s; check your plan); `npm audit` reports a moderate
`sprintf-js` issue reached through mammoth's CLI parser, which is not fed by your documents, and its suggested
fix is a downgrade to a very old mammoth, so it is accepted for now.
