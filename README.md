# Career Agent

A personal job-search agent. It finds jobs, scores them against your profile, tailors your resume and cover
letter **using only facts from your own profile**, prepares the application, and applies when you click
**Approve**. Everything it sends is recorded so you can always see what was applied, with which resume.

- Dashboard (Next.js 16 + shadcn/ui) on Vercel
- Supabase for the database and file storage
- Free LLMs by default, configurable from the Models page (no code changes)
- Playwright apply worker on GitHub Actions (free)

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
- Sign-in uses Supabase Auth (email + password). Only emails in `ALLOWED_EMAILS` can reach any page or API; the app fails closed, so with no allowlist nothing is reachable. Creating an account needs both an allowed email and your secret `INVITE_CODE`, so nobody can register your address before you do.

## Setup (about 30 minutes)

1. **Supabase**: create a project. SQL Editor -> paste `supabase/migrations/0001_init.sql` -> Run.
   Copy the project URL and the `service_role` key (Project Settings -> API).
2. **Vercel**: import this GitHub repo. Add the environment variables from `.env.example`
   (at minimum the Required block plus one model key). Deploy.
   `SUPABASE_ANON_KEY` is the `anon` key from Project Settings -> API. `ALLOWED_EMAILS` is your email.
   `INVITE_CODE` is any random string of 16+ characters (for example `openssl rand -base64 24`).
3. **GitHub** (repo Settings -> Secrets and variables -> Actions) add:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, `CRON_SECRET`, and optionally
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `LINKEDIN_STORAGE_STATE`.
   Create a fine-grained token limited to this repo with "Actions: read and write" and put it in Vercel as
   `GITHUB_DISPATCH_TOKEN`.
4. Open the app. On the sign-in page choose **Create account**, enter your allowed email, a password (10+ characters)
   and the invite code. You are signed in and your browser or password manager can remember the login from then on.
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
Profile page -> upload your resume (PDF/DOCX) and/or your LinkedIn data export (.zip from LinkedIn Settings ->
Data privacy -> Get a copy of your data). LinkedIn has no public profile API and scraping it breaks its terms,
so the export file is the supported route. The result is a **draft**: review and edit it, then Confirm.

### India portals
Naukri, Foundit, Shine and similar sites have no open APIs and restrict scraping. Discovery reaches India through
Adzuna and JSearch (which indexes many portals). For a posting you find on a portal or in an alert email, use
**Add job manually** (link + description); it then follows the normal score -> prepare -> approve flow and is
applied in assisted mode.

## Development

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev
npm run typecheck && npx eslint . && npm test
npm run worker:apply         # needs APPLICATION_ID + Supabase env; normally run by GitHub Actions
```

`npm test` runs 76 tests: the verifier, model fallback, importers, job mappers and dedupe, caps, access rules and signup guards, the
SQL migration on an embedded Postgres (PGlite), and the form filler in a real Chromium against a local
fixture. The browser tests need Chromium (`npx playwright install chromium`, or set `CHROMIUM_PATH`) and are
skipped when no browser path is configured.

## What is and is not verified

Verified by automated tests: the logic above, the database schema and constraints, the login gate, and the
production build. **Not exercised against live services** (they need your keys and accounts): Adzuna, JSearch and
Remotive responses, Greenhouse/Lever submission on real employer pages, the LinkedIn Easy Apply path, Telegram
delivery, and the Vercel/Supabase deployment itself. Expect to adjust small things on first real runs, especially
form matching on employers with unusual forms. LinkedIn automation is the least certain and carries account risk;
leave it off unless you accept that.

Other known limits: Vercel Hobby cron runs once a day (GitHub Actions in `.github/workflows/schedule.yml`
provides more frequent runs for free); the prepare step makes two model calls and may need a function time limit
above your plan's default (`maxDuration` is set to 120s; check your plan); `npm audit` reports a moderate
`sprintf-js` issue reached through mammoth's CLI parser, which is not fed by your documents, and its suggested
fix is a downgrade to a very old mammoth, so it is accepted for now.
