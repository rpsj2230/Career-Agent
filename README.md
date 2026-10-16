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
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `LINKEDIN_STORAGE_STATE`.
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
Profile page -> any combination of: your LinkedIn link, your LinkedIn profile **pasted** (open your own profile, show all
sections, select all, copy, paste), a LinkedIn **Save to PDF** or the LinkedIn **data export** (.zip), and your resume
(PDF/DOCX). LinkedIn has no public profile API, blocks anonymous fetches and forbids scraping, so these routes
(which use only data you provide) are what is supported. The result is a **draft**: review and edit it, then Confirm.
The answer bank comes pre-listed with the standard application questions; facts already on your profile are filled in automatically.

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

Other known limits: Vercel Hobby cron runs once a day (GitHub Actions in `.github/workflows/schedule.yml`
provides more frequent runs for free); the prepare step makes two model calls and may need a function time limit
above your plan's default (`maxDuration` is set to 120s; check your plan); `npm audit` reports a moderate
`sprintf-js` issue reached through mammoth's CLI parser, which is not fed by your documents, and its suggested
fix is a downgrade to a very old mammoth, so it is accepted for now.
