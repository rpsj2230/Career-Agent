# Requirements audit and delivery plan

Status legend: **Done** = works end to end and verified; **Partial** = exists but does not meet the requirement; **Missing** = not present.
Evidence is from reading the code and running it (not from the presence of a screen). Updated as phases land.

## 1. Audit of the current system (baseline: PR #2)

| # | Requirement | Status | What exists today / evidence | Gap |
|---|---|---|---|---|
| R1.1 | Dedicated section to connect and configure portals | **Missing** | No portals page. Sources are switched on only by env vars (`ADZUNA_*`, `RAPIDAPI_KEY`) and by Greenhouse/Lever lists in Settings. | Portals page, in-app credentials, enable/disable |
| R1.2 | See what is connected, status, whether it works | **Missing** | No connection state, no health check, no last-scan record. | Integration state + Test button + last scan/error |
| R1.3 | Every job shows its originating portal | **Partial** | `jobs.source` is stored (e.g. `adzuna:in:Role`) but shown nowhere in the UI. It names the *API*, not the portal a posting lives on (JSearch returns the publisher, which is discarded). | `jobs.portal`, badges, filters |
| R1.4 | Setup requirements and capabilities per portal | **Missing** | Only README text. | Portal catalogue shown in UI |
| R1.5 | Visibility into scans, limits, errors, failed connections | **Missing** | Source errors are returned in the HTTP response of `/api/cron/discover` and then lost. | Persisted scan records |
| R2.1 | Daily automatic scan | **Partial** | Fixed times: Vercel cron daily + GitHub Actions at 3 fixed UTC times. Works only if the secrets are configured. | User-configurable schedules |
| R2.2 | Configure frequency, time, time zone | **Missing** | Hard-coded. | Schedules model + UI |
| R2.3 | Match on profile, skills, salary, preferences | **Partial** | Scoring uses profile, skills, expected CTC text and one global country/role list. No per-country criteria, no salary comparison. | Per-country prefs, salary parsing |
| R2.4 | Tailored resume and answers per relevant job | **Partial** | Works on demand per job (Prepare button). Not run automatically for matches. | Automated pipeline step |
| R2.5 | Auto-apply where permitted, optional approval | **Partial** | Greenhouse/Lever worker, approval button, caps. Approval is always required; no per-schedule policy. | Policy engine, approval toggle, auto mode |
| R2.6 | Status tracking: submitted, pending approval, failed, manual action | **Partial** | DB statuses exist (`prepared`, `approved`, `submitted`, `failed`, `needs_input`, `assisted_pending`) but are not shown under those names or summarised. | Status model and views |
| R2.7 | Daily reports | **Partial** | Telegram digest text with 5 counts; not stored, no links, no detail. | Persisted detailed reports |
| R2.8 | Enable, disable, pause, resume, modify schedules | **Missing** | | Schedules UI + API |
| R3.1 | Multiple target countries | **Partial** | List of countries works (Adzuna/JSearch loops). Same roles used for every country. | Per-country configuration |
| R3.2 | Per-country titles, industries, locations, remote, salary and currency, work authorisation | **Missing** | Global preferences only. | Country preferences |
| R3.3 | Country retained per job; filter applications and reports | **Partial** | `jobs.country` kept; applications list shows it; reports has a by-country table. No filter controls anywhere. | Filters on all lists |
| R4.A | Application detail: job details (full JD, requirements, URL, portal, dates, salary, statuses) | **Partial** | Detail page shows title, company, link only. JD, source, discovered date, salary and applied date are not shown there (they exist on the job page). | Rebuilt detail page + snapshot |
| R4.B | Exact resume, preview, download, original resume, cover letter, record of changes | **Partial** | Each resume/cover version is a separate DOCX in storage (never overwritten) and can be downloaded; per-bullet diff stored. The original (master) resume is not snapshotted, so editing the profile later loses the starting point; no in-page preview. | Profile snapshot, preview |
| R4.C | Exact answers, submitted text, submission time/method/confirmation, errors | **Partial** | `applications.answers` holds the *prepared* answers. The worker records only the **labels** of fields it filled, not the values, not which files were attached, not the confirmation text. | Worker submission record |
| R5 | Central activity log with filters | **Missing** | Only per-application `apply_events` and `model_usage`. No scan, rejection, run, config or auth logging. Rejections are a `skip_reason` on the job. | Activity log + runs + Logs page |
| R6.1 | Dashboard with portals, scanned today/period, matches, documents, submissions, awaiting, failures + reasons, by country/portal | **Partial** | 6 count tiles. | Dashboard v2 |
| R6.2 | Daily report with links to job/application pages | **Partial** | See R2.7. | Persisted reports |
| R7.1 | Prevent duplicate applications | **Done** | One application per job (unique constraint); cross-source de-duplication by company+title+country at ingestion. Covered by tests. | Surface in UI/log |
| R7.2 | Complete history; failed runs never lose records | **Partial** | Worker failures are stored on the application. Discovery/scoring failures and source errors are not persisted. | Runs with failure-safe finalisation |
| R7.3 | Workflow works end to end | **Partial** | Steps exist but are triggered by hand or fixed cron. | Pipeline |

Verified working today and not part of this plan: accounts and owner lock-out, encrypted model keys, model fallback chain, resume tailoring with verification, DOCX output, Greenhouse/Lever form filler, LinkedIn/resume import, standard answer bank.

## 2. Constraints that shape the design (honest limits)

- **LinkedIn, Indeed, Glassdoor have no open job-search or apply API for individuals**, and their terms prohibit scraping and automated applying. "Connecting" them is therefore done by compliant routes, each shown with its limits on the Portals page:
  1. *Aggregator feed* (JSearch): postings from these portals appear with their publisher recorded as the origin portal. Read-only discovery.
  2. *Job-alert email mailbox* (IMAP, Phase 6): the alert emails these portals already send you are parsed into jobs.
  3. *Manual add* (exists).
  4. *Apply*: assisted (you press submit). LinkedIn Easy Apply automation stays opt-in, capped, and at your account risk.
- **Automatic submission is only offered where it is both technically reliable and normal practice**: employer ATS forms (Greenhouse, Lever). Everything else is prepared and handed to you.
- Third-party API availability and free limits change; each adapter has a Test button so you see the real state.

## 3. Architecture decisions

- **Long work runs in GitHub Actions, not Vercel functions** (no 60s limit, free): an hourly tick asks the app which schedules are due and starts the pipeline workflow; "Run now" starts the same workflow. Vercel hosts the UI and short APIs only.
- **One consolidated, idempotent migration (0002)** for Phases 1 to 5, so the SQL is pasted once. The app checks the schema and shows exactly what is missing instead of failing silently.
- **Credentials for portals are stored in the app, encrypted** (same mechanism as model keys), so no Vercel visits.
- **Every run is recorded before it starts and finalised in a `finally` path**; a watchdog marks runs that died mid-way as failed.
- **Immutable application records**: job, profile/original resume, documents, answers and submission details are copied into the application at prepare/submit time.

## 4. Phases and acceptance criteria

**Phase 1: Foundation and visibility** (R1, R5, source tracking, failure-safe runs)
- Migration 0002 applies cleanly twice on a real Postgres engine; the app reports missing tables/columns and shows the SQL.
- Portals page lists every portal and integration with status, requirements, capabilities, limits, last scan, jobs found, last error; keys can be entered in-app; Test and Scan now work and are logged.
- Every job shows the originating portal and the integration that fetched it; Jobs and Applications can be filtered by portal and country.
- Logs page shows scans, per-portal job counts, rejections with reasons, documents generated, applications prepared/submitted/skipped/failed, integration and auth errors, runs, and configuration changes; filterable by date, portal, country, company, status, run.
- A scan whose source fails leaves a persisted error record; nothing is lost when a request times out.

**Phase 2: Multi-country** (R3)
- Select any number of countries; per country: titles, industries, locations, remote preference, salary range and currency, work authorisation/sponsorship, notes.
- Discovery, matching and the scoring prompt use the country's own settings; salary expectations are compared in the right currency.
- Country filter on jobs, applications, reports, logs and dashboard.

**Phase 3: Scheduling and automation** (R2, R7.3)
- Create, edit, enable/disable, pause/resume and run-now for schedules with frequency, preferred time and IANA time zone; next run shown.
- Pipeline: scan, match, prepare documents and answers, then auto-apply where policy allows or queue for approval (per-schedule toggle); each run recorded with start, end, outcome and counters.
- Statuses exposed as: submitted, pending approval, failed, requires manual action.

**Phase 4: Application records** (R4, R7.1, R7.2)
- Detail page with sections A (job), B (resume and documents, original resume, change log, preview and download), C (exact answers and submission record).
- Editing the master profile never changes an existing application record (tested).
- The worker stores every value it entered, files attached, confirmation text, time, method and any error.

**Phase 5: Dashboard and daily reports** (R6)
- Dashboard shows connected portals and status, scanned today/period, matched, documents generated, submitted, awaiting approval, manual action, failed with reasons, by country and portal.
- Daily report is generated on schedule, stored, listed, and every item deep-links to its job/application page; also sent to Telegram.

**Phase 6: More portal reach**
- Mailbox (IMAP) connector for LinkedIn/Indeed/Glassdoor/Naukri alert emails; additional free job APIs; credential-expiry and health alerts.

## 5. Dependencies

| Dependency | Needed by | Provided by |
|---|---|---|
| Migration 0002 run once in Supabase | everything new | you paste one file (the app shows it and checks it) |
| Portal credentials (Adzuna key, RapidAPI key, mailbox app password) | portals | entered in the app, stored encrypted |
| GitHub token to start workflows (`GITHUB_DISPATCH_TOKEN`, already used for apply) | pipeline, run now | exists |
| GitHub Actions minutes | hourly tick + pipeline + apply | free tier; hourly tick is about 720 min/month |
| File storage for documents | resumes, snapshots | Supabase Storage `documents` bucket (exists) |

## 6. Delivery log

| Phase | State | Verified by |
|---|---|---|
| 1 Foundation and visibility | Done | migration tests on real Postgres (PGlite), unit tests, end-to-end run against the emulator |
| 2 Multi-country | Done | per-country queries, remote/sponsorship/salary rules, country filters on jobs, applications, logs, reports, dashboard |
| 3 Scheduling and automation | Done | schedule logic incl. time-zone/DST tests; the real `worker/pipeline.ts` run end to end against the emulator (claim, run record, prepare, auto-approve vs ask-first, pause, idempotent second run); policy and orchestration unit tests; mutation check on the approval rule |
| 4 Application records | Done | job/profile snapshots (write-once in the database), exact submission record from the real `worker/apply.ts` run in a real browser (values, SHA-256 of files, confirmation text, screenshot), rebuilt A/B/C detail page, resume preview = DOCX (same source, tested), cross-portal duplicate merging, concurrent prepare/approve safety, jobs with history cannot be deleted |
| 5 Dashboard and daily reports | Done | dashboard (portal status, period and country filters, funnel, by country/portal, failures with reasons, deep links) checked in a real browser; daily reports stored per day (idempotent), every item deep-linked, sent to Telegram, generated by the morning job and on demand |
| 6 More portal reach | Planned | |

Not exercised against live services: Adzuna/JSearch/Remotive responses, GitHub Actions itself (workflow files are syntax-checked only), Telegram delivery, real employer forms.
