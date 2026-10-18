# Career Agent: User Guide

*Everything you need to start using Career Agent, from the first sign-in to the daily routine. Written for someone who has never seen the app.*

## 1. What Career Agent is

Career Agent is a personal job-search assistant. It does the repetitive work of a job search and leaves the decisions to you.

1. **Finds** new jobs from many job sites, in the countries you choose.
2. **Scores** each job against your profile (0 to 100) and explains the score. Poor matches are set aside with a reason.
3. **Prepares** a resume and cover letter written for each good match, using only facts from your own profile. Nothing can be invented: every sentence is checked against your profile before you see it.
4. **Applies** when you approve, or by itself if you allow it. Everything that is sent is recorded: which resume, which answers, when, and the result.

Think of it as an assistant who works through the night, puts a prepared application on your desk each morning, and sends it when you say "yes".

### What it will never do
- Invent skills, employers, titles, dates, or numbers. Anything not in your profile fails the check and blocks one-click approval.
- Solve a CAPTCHA, pass a security check, or tick a consent box for you.
- Send applications beyond the daily limits you set.
- Apply automatically unless you switch on **Auto-Apply** (it is off by default).

## 2. The big picture

| 1. Set up (once) | 2. Find and score (automatic) | 3. Prepare | 4. Apply | 5. Track |
|---|---|---|---|---|
| Profile, Resumes, Countries, Job sources, AI models, Settings | A schedule runs on GitHub: searches the sites, removes duplicates, scores every job | A resume, cover letter and answers written for each match, then checked | You approve, or Auto-Apply does it: cloud worker, assistant on your computer, or by hand | Applications, Dashboard, Reports, Logs |

### Where each part runs (this matters when something does not work)

| Part | Runs on | Needs your computer on? |
|---|---|---|
| The website (all pages) | Vercel (a web host) | No |
| Database and stored files | Supabase | No |
| Schedules, searching, scoring, preparing, applying to Greenhouse / Lever / Ashby / Workable | GitHub Actions (free cloud computers) | No |
| AI writing and scoring | Free AI providers (Gemini, Groq, ...) and, as a last resort, a small model on GitHub | No |
| Applying on LinkedIn, Naukri, Indeed and similar sites | The **Apply Assistant** on your own computer | **Yes**, it waits in a queue until your computer is on |

## 3. The five-minute tour: the menu

The left-hand menu is grouped in the order you use it.

| Menu group | Page | One-line purpose |
|---|---|---|
| (top) | **Dashboard** | The overview: what needs you, how the funnel is doing, latest runs |
| **1 · Set up (one time)** | **Profile** | Your career facts. Everything is built from this |
| | **Resumes** | Your master resume, the template, and saved resumes |
| | **Countries** | Which countries to search, and the salary / visa rules for each |
| | **Job sources** | Connect the sites and services that supply jobs |
| | **AI models** | The AI providers, their keys, the fallback order, the local model |
| | **Settings** | Auto-Apply switch, limits, thresholds, blocklist, daily report |
| **2 · Find & score jobs** | **Schedules (automatic)** | When the app searches, scores, prepares and applies by itself |
| | **Jobs found & scored** | Every job found, with its score and the buttons to run steps by hand |
| **3 · Apply** | **Applications** | Every prepared, queued, sent or failed application |
| **Monitor** | **Reports** | The daily report |
| | **Logs & history** | A record of everything the app did, and why |
| | **System health** | Checks that everything is connected and working |

## 4. First-time setup

Do these once, in this order. The Dashboard shows a **Finish setup** checklist until they are done.

### Step 1. Create your account
Open the app. On the sign-in page choose **Create account**, enter your email, a password of 10 or more characters, and the **invite code** (the `CRON_SECRET` value set during installation). You become the owner. Nobody else can register afterwards.

### Step 2. Add an AI model key (AI models page)
The app uses free AI services. Open **AI models**, press **Edit** on a model (for example *gemini-flash* or *groq-llama*), paste its API key, save, then press **Test**. A green result means it works. Free keys are available from Google AI Studio (Gemini), Groq, and others listed on the page. Add at least one; adding two or three means a failure at one provider never stops you.

### Step 3. Build your profile (Profile page)
1. Upload your **master resume** (PDF or Word). This is the one source of truth: its sections and wording become your resume template, and it is kept as a fallback.
2. Optionally add **supporting documents**: your LinkedIn *Save to PDF*, a second resume, or the LinkedIn data export (zip). They only add skills the master resume lacks.
3. The result is a **draft**. Read it, correct anything wrong, then press **Confirm**.
4. Later you can edit the profile in **Edit your profile** (add or change skills, or edit the whole profile as JSON).

> Why this matters: the AI may only use facts that are in this profile. If a skill or achievement is missing here, it can never appear on a resume.

### Step 4. Choose countries (Countries page)
Add each country you want jobs in. For each, set job titles, industries, preferred locations, remote preference, salary range and currency, and work authorisation (for example "I need employer visa sponsorship"). The page also shows which job sources cover that country and what to connect to fill gaps. Fields you leave empty are filled from your Profile preferences.

### Step 5. Connect job sources (Job sources page)
Each source shows its status: **Working**, **Not connected**, **Problem**, or **Switched off**, plus what it needs and its limits. Typical choices:
- **Adzuna** and **JSearch**: paste the free API keys. Broad coverage in many countries.
- **MyCareersFuture** (Singapore): free, no key.
- **Company boards** (Greenhouse, Lever, Ashby, Workable): add company names under Settings → Job discovery. These can be applied to automatically.
- **Mailbox (job-alert emails)**: set up job alerts on LinkedIn, Naukri, Indeed, Bayt and others, connect a Gmail mailbox with an *app password*, and every alert email becomes a job. This is the most complete free route for portals without an API.
- **Hosted scrapers (Apify)**: optional paid-by-usage scrapers for LinkedIn, Naukri, SEEK and others, with a monthly budget so it cannot overspend.
Press **Test** on a source to check it, or **Scan now** to fetch immediately.

### Step 6. Settings
- **Auto-Apply**: the master switch. Leave it **off** while you learn the app. With it off, nothing is sent without your click.
- **Fit threshold**: the minimum score for a job to count as a match (default 65).
- **Application limits**: how many automatic applications per day and per week, and days to wait before applying to the same company again.
- **Blocklist**: companies or words that must never appear.
- **Daily report and health check**: the hour to send it, and your email. See section 9.
- **Reply tracking** and **Approve from your phone** (Telegram): optional.

### Step 7. Create a schedule (Schedules page)
Press **New schedule**, choose what it does (section 7), how often, the time and time zone, and save. The first run starts at the next hourly check.

### Step 8. Check System health
Open **System health**. Everything should be green: database up to date, hourly clock running, a schedule exists, a model is usable, GitHub connection works (**Test GitHub connection**). Anything red says exactly what to fix.

## 5. The daily workflow

### If everything is automatic (recommended once you trust it)
1. A schedule runs (for example every morning).
2. It searches your sources, removes duplicates, scores new jobs, and writes a resume and cover letter for each match.
3. Depending on the schedule: it waits for your approval, or approves by itself within your limits.
4. You get the **daily report and health report** by Telegram and email.
5. You open **Applications**, review what is pending, and approve or skip. Applications to Greenhouse, Lever, Ashby and Workable are sent from the cloud. LinkedIn, Naukri and Indeed ones wait for your computer's assistant.
6. Update the outcome (interview, rejected, offer) as replies come in.

### If you prefer to drive by hand
1. **Jobs found & scored** → **Search job sites now**.
2. **Score unscored jobs**.
3. Open a matched job → **Prepare resume and cover letter**.
4. Review → **Approve**.

## 6. Page by page

### Dashboard
- **Finish setup** checklist (until complete).
- **Automation banner**: warns if the hourly clock, schedule, models or GitHub connection need attention.
- **Pipeline strip**: five steps with counts (Found, not scored → Matched → Resume ready → Applied in the last 7 days → Needs you), each saying who does it.
- **Funnel**, **Failures and what needs you**, **How applying is going (last 30 days)**, **Recent applications**, **Latest runs**. You can change the period and filter by country.
- Buttons: **Search job sites now**, **Score unscored jobs**.

### Profile
- **Import**: upload the master resume and optional supporting documents; review the **imported draft**; **Confirm**.
- **Edit your profile**: add, change or remove skills, or edit as JSON.
- **Preferences**: roles, countries, salary, work status. Roles live here only.
- **Answer bank**: ready answers to standard application questions (notice period, visa, salary expectation...). Facts already in your profile are filled in automatically.
- **Questions the agent could not answer**: when a form asks something the app has no answer for, the application is handed back here. Answer once and every waiting application resumes. Answers about pay and visas are kept **per country** so one country's figure is never sent to another.

### Resumes
- **Master resume**: your uploaded original, with a preview.
- **Resume template**: the fixed layout (single column, plain text, readable by employer systems). The sections follow your own resume: Summary, Career Highlights, Case Studies, Core Competencies, Technical Skills, Experience, Certifications, Education, and so on. A style per country sets page size (A4 or Letter), spelling (British or American) and bullets per role.
- **What may change for each job**: switches for headline, summary, highlights, responsibilities and skills. Turn one off to keep that part exactly as in your master resume. Keep all on for the best-tailored resumes.
- **Saved resumes**: tagged versions you can reuse.

### Countries
One card per country: job titles, industries, preferred locations, remote, salary range and currency, work authorisation, notes, and which sources cover it. This is the single place to choose countries.

### Job sources
Status, requirements, limits and recent scans for each source, with **Test**, **Scan now**, credentials (stored encrypted, never shown again), and the mailbox and Apify sections.

### AI models
- The **fallback chain**: if a model fails or is rate-limited, the next is tried automatically; the **local model** is last. Each model shows a **Status**: *Working* (its latest call succeeded), *Unstable* (some recent calls failed), *Not working* (all recent calls failed; the last error is shown with what it usually means: quota used up, key rejected, model name retired), *Daily limit reached*, *No key* or *Not used yet*. "Calls today" counts successes and failures against the daily allowance.
- **Test** each model. **Recent failures** shows what went wrong.
- **Local model: last fallback**: *Only when the hosted models are failing* (recommended), *Always*, or *Off*, and a **Test the local model now** button that runs a real question on GitHub (3 to 6 minutes) and shows whether it works.
- If no model works at all, promising jobs are queued on the free rules alone, marked **rules only**, and a model re-checks them later. No job is lost.

### Settings
Described in section 4, step 6. Also **Job discovery** (countries, roles, company boards to read directly, ignore jobs older than N days, do not search the same thing within N hours) and **Resume memory** (reuse or adapt a past resume for a very similar job to save AI usage).

### Schedules (automatic)
See section 7.

### Jobs found & scored
- Tabs: **Review queue** (matched), **Not scored yet**, **Rejected (with reasons)**, **Applied**, **All jobs**. Filter by source and country; choose 10, 25, 50 or 100 per page.
- **What the last search did, source by source**: why a source added nothing (switched off, not connected, failed, nothing new).
- Buttons: **Search job sites now**, **Score unscored jobs**. Tick rows to **Prepare resumes for selected**. To run the whole schedule, use Schedules → **Run this schedule now**.
- **Add job manually**: paste a link and description for a posting you found yourself.
- Open a job to see **Why this score** (matched skills, gaps, seniority and visa fit), then **Prepare resume and cover letter**.

### Applications
- Filter by status, source, country; search by title or company.
- Columns: Role, Source and country, **Status**, **How it is applied**, **Next step**, Reply, Resume version.
- **Status**: *Pending approval* → *Approved, sending soon* → *Sending now* → *Applied*. Or *Waiting for assistant / you*, *Needs your input*, *Failed*.
- **Next step** is a button or link: *Review and approve*, *Apply with assistant*, *Answer and finish*, *See why and retry*.
- The **Apply assistant** card shows whether the assistant on your computer is running and has **Run assistant now**.
- Export everything to CSV.

### Application detail
Everything about one application, in three parts.
- **What to do now**: Approve / Skip, or the assistant and manual options.
- **Write a new resume for this application**: see section 8.
- **Outcome**: mark applied, interview, rejected, offer, withdrawn, with notes.
- **A. Job details**: the job as it was when prepared.
- **B. Resume and documents**: preview, download (DOCX), the original master resume, a change log showing exactly what was changed for this job, the **aimed-at-this-job score**, and the cover letter.
- **C. Answers and submission**: the answers prepared, and the exact record of what was sent (every value entered, files attached, time, confirmation).

### Reports
Daily reports with sections and links to each application. Also delivered by Telegram and email.

### Logs & history
Filter by date, source, country, company, status or run. **Runs** lists every automatic run with its counts and any error. Use this when you want to know *why* something happened.

### System health
Database status, the automation checklist (clock, schedule, models, GitHub connection, last run), **Test GitHub connection**, and configuration. Each problem comes with its fix.

## 7. Schedules: how automatic running works

A schedule is a saved plan. Every hour, a small GitHub job asks the app "is a schedule due?" and only then starts the full run.

**What it does** (choose one):
- *Find and score jobs only*: you do the rest.
- *Find, score, and prepare applications for my approval*: you approve each.
- *Find, score, prepare, and apply*: sends within your limits. With **Ask me before submitting** on, it still waits for you.

**Other fields**: how often (every day, weekdays, selected days, every few hours), time and time zone, how many applications to prepare per run, how many to submit per run.

**Run history**: each schedule lists its recent runs with time, result, counts and any error, and a **Details** link.

**If a run fails or finds the models down**, it is retried an hour later, up to three times. If GitHub is late, a daily backup check on Vercel notices and starts the run. If your laptop is off, nothing is lost: cloud steps do not need it, and assistant applications wait in the queue.

**Auto-Apply and limits.** A schedule can only submit when *Settings → Auto-Apply* is on, never beyond the daily limits, never to a company you applied to recently, and never with unverified documents.

### The backlog clears by itself
Searching finds more jobs than can be scored at once, so some wait to be scored. You do not need to press anything: every hour the app scores a batch of about 60, then writes the resume, cover letter and employer email for good matches (a few per hour, set in Settings → Automatic preparing and backlog clearing), following the rules of your active schedule. The **Waiting to be processed** card on Schedules and Jobs shows what is waiting and how long it will take. While a run is active, a banner shows what it has done so far (jobs found, scored, prepared). If no AI model works, the backlog waits and the app pauses for a few hours instead of retrying uselessly.

### Which button does what
| Button | Where | What it does |
|---|---|---|
| **Run this schedule now** | Schedules | Runs that schedule immediately: search, score, prepare, and apply if the schedule is set to. The whole cycle. |
| **Search job sites now** | Jobs found & scored, Dashboard | Searches the connected sites and scores what it finds |
| **Score unscored jobs** | Jobs found & scored, Dashboard | Scores jobs already found |
| **Prepare resumes for selected** | Jobs found & scored (tick rows first) | Writes the resume and cover letter for the ticked matched jobs |
| **Approve and apply selected / Skip selected** | Applications (tick rows first) | Approves or skips many applications in one go |
| **Run history** | Logs & history | Not a button that runs anything: it opens the list of past runs |

### Selecting many rows at once
On **Jobs found & scored** and **Applications**, tick the boxes (or **Select all on this page**, then set the page size to 100 at the top) and use the buttons above the table. Each row also has **View resume** (opens in a new tab) and, where it applies, **Approve and apply**. Approving sends automatic applications from the cloud, emails the employer where an address is listed, and queues the rest for your assistant.

## 8. Resume quality, and writing a new resume

### How each resume is written
For every job the AI is told to write for that job: a headline naming the role, a summary built around what the job asks for, each bullet reworded (strong verb, the job's own terms where your profile supports them, the result with its exact figure), and the most relevant highlights, case studies and skills first. A checker then verifies every sentence against your profile.

### The score on each application
The application page shows **Aimed at this job: N/100**, the share of the job's key terms you can honestly claim that the resume uses, how many bullets were reworded, and whether the headline and summary were written for the job. Below 75 the AI gets up to two more attempts. It also lists what the job asks for that your profile does *not* contain. Those are never added.

### Not happy with a resume? Write a new one
Open the application → **Write a new resume for this application**.
1. Optionally type instructions, for example "stress my payments and SQL experience; keep the summary to three sentences". Instructions steer emphasis and tone only; the checker still applies.
2. Press **Write a new resume**. It runs in the background (1 to 3 minutes). The old versions stay in the history.
3. The application returns to **Pending approval** with the new resume and cover letter. Press **Approve** to apply with it.

Rules: an application that is being sent right now cannot be regenerated. One that was **already submitted** asks you to confirm, because applying to the same job twice may be rejected as a duplicate; the earlier submission stays recorded in the history. If no AI model is available, your existing resume is left untouched.

## 9. Daily report and health report

After the hour you choose (Settings → Daily report), once a day you receive on Telegram and email: yesterday's results, the runs that happened, and a **health summary** that says what is healthy, what needs attention, and how to fix it. **Send now** tests it. Email uses your connected Gmail mailbox with an app password.

## 10. How applying works, site by site

| Job is on | Who sends it | Login needed |
|---|---|---|
| Greenhouse, Lever, Ashby, Workable | Cloud worker, automatically | No. These forms are public. Your computer can be off. |
| LinkedIn, Naukri, Indeed and similar | The **Apply Assistant** on your computer | Yes, once, inside the assistant's own browser. It never sees or stores your passwords. |
| Any other site | You, using the prepared resume and answers. If the posting lists an email address, the app emails the application for you | n/a |

The Applications list shows which of the three applies to each row.

### The Apply Assistant (your computer)
It opens a real browser window with your signed-in sessions, opens the posting, fills the form from the prepared resume, cover letter and answers, and then **stops** so you review and press the site's own Submit. In *hands-free* mode (Settings → Auto-Apply and Application limits) it also presses Submit, within your daily limits, with human-like pauses, and stops at the first security check.

**One-time setup on your computer**
1. Install Node 22. In the project folder run `npm ci` and `npx playwright install chromium`.
2. Create `.env.local` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Run `npm run assist` once, and sign in to LinkedIn, Naukri and Indeed in the window that opens.
4. Run `npm run assist:check`. It lists exactly what is missing and how to fix it.
5. For hands-free use: switch on Auto-Apply and hands-free mode in Settings, then run `npm run assist:watch`, and install the autostart (`docs/ASSISTANT_AUTOSTART.md`) so it starts when you sign in.

**Daily use**
- Approving an application that needs the assistant automatically asks a running assistant to start (within about 30 seconds). **Apply with assistant** on Applications or on the application page does the same.
- If your computer is off, the application stays queued and is done when the assistant next runs. You are alerted on Telegram if work has waited for hours.
- A web page cannot start a program on your computer. That is why the assistant must be running there.

### Applying by email
Two situations send an email with your resume and cover letter attached:

1. **The posting asks for applications by email** ("send your CV to ..."). The email *is* the application. After you approve, the app sends it from your own mailbox and marks the application **Applied**, recorded as an email.
2. **The posting lists an email address** next to a normal application route (Greenhouse, Lever, LinkedIn, a portal). The app applies the normal way **and** emails that address, which gives a second chance of being seen. You can switch this off in Settings.

The email is written for each job: a clear subject, and a short message that explains **why you fit this job**, tying the job's main requirements to your real results, mentions that the resume and cover letter are attached, and invites a conversation. It is checked against your profile like the resume, so nothing can be invented.

On the application page, the card **Email to the employer** shows the recipient, subject and message. You can edit all of it, pick another address found in the posting, type an address yourself (for a posting that lists none), write it again, and press **Send now**. It is sent automatically when you approve the application unless you switch that off for the email. It never sends twice, and there is a daily limit (Settings → Applying by email).

Emails are sent only to an address that appears in the posting or one you type. Sending uses the mailbox connected on the Job sources page (a Gmail app password). If sending fails, the reason is shown on the card, and an email-only application is returned to **Needs your input** so nothing is silently lost.

### The cover letter
Every cover letter is written to show **why you are a strong fit for that specific job**: it names the role and company, connects two or three of the job's main requirements to what you have actually done (with the exact figures from your profile), and says what you would bring to the team. It is measured the same way as the resume and rewritten if it comes out vague.

## 11. Status words, explained

| You see | Meaning | What to do |
|---|---|---|
| Not scored yet | Found, waiting to be scored | Run Score, or wait for the schedule |
| Matched / Review queue | Score above your threshold | Prepare the application |
| Rejected (with reason) | Below threshold or filtered | Open it to see why; change thresholds if wrong |
| Pending approval | Resume and cover letter ready | Review, then Approve or Skip |
| Approved, sending soon / Sending now | The cloud worker is sending | Nothing |
| Waiting for assistant / you | Needs your computer's assistant, or your own submission | Apply with assistant, or submit by hand |
| Needs your input | A required question had no answer | Answer on Profile, then approve again |
| Applied | Sent and recorded | Track the outcome |
| Failed | Sending failed | Open it for the reason; retry or write a new resume |
| rules only | Scored by free rules because no AI model worked | A model will re-check it automatically |

## 12. Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Search finds jobs from only one source | Other sources not connected or off | Job sources page, and *What the last search did* on Jobs |
| Jobs found but nothing matched | Jobs are not scored yet, or the threshold is high | Press Score; check Settings → Fit threshold |
| Buttons say "short version here" | GitHub is not connected | System health → Test GitHub connection |
| "No usable model" | No AI key, or keys unreadable | AI models: add a key and Test |
| The schedule never runs | No active schedule, or GitHub clock late | System health shows the cause; daily backup check starts a late run |
| Resume looks unchanged | Master resume used as fallback (no model), or a section is locked | Look for the warning box on the application; Resumes → switches; write a new resume |
| Application stuck at "Waiting for assistant" | Assistant not running on your computer | Run `npm run assist:check`, then `npm run assist:watch` |
| Application "Needs your input" | A required question has no answer | Answer it on Profile |
| No daily email | Mailbox not connected or wrong app password | Settings → Daily report → Send now shows the reason |

## 13. Safety and privacy

- **Auto-Apply is off by default**, and there are daily and weekly limits, a per-company cooldown, and a LinkedIn security-check stop.
- Everything is checked against your profile before you see it. Unverified documents can never be approved automatically.
- Passwords for job sites are never stored by the app. API keys and portal credentials are encrypted and never shown again.
- Only you can sign in (owner account).
- Free AI providers may use inputs for training, so avoid uploading ID numbers or dates of birth.
- Applying automatically on some sites is against their terms and can restrict an account. Keep limits low and prefer pressing Submit yourself on LinkedIn.

## 14. Quick reference

**Do once:** account → AI key → Profile (upload, confirm) → Countries → Job sources → Settings → Schedule → System health.

**Do daily (2 minutes):** read the daily report → Applications → approve or skip pending → run the assistant if needed → update outcomes.

**Do when needed:** check the email to the employer before approving (edit it if you like); answer handed-back questions on Profile; write a new resume for an application; add a job manually; check Logs when something looks wrong.

**Commands on your computer:** `npm run assist` (apply by hand-assisted), `npm run assist:watch` (hands-free, keeps running), `npm run assist:check` (diagnose).

## 15. Backups and the laptop
- **Backups:** `docs/BACKUP.md` explains the nightly encrypted backup of the database and master resume to a private GitHub repository (newest 60 days kept), and how to restore.
- **Laptop assistant, step by step with commands:** `docs/LAPTOP_SETUP.md`.

## 16. Pausing, and which job sources are worth it
- **Pause everything** (Settings, top card): found a job, or need a break? One switch stops everything that runs by itself (scheduled runs, searching, background scoring and preparing, automatic approving and applying from the cloud and from the assistant, and automatic employer emails). Your data stays; buttons you press yourself still work. The Dashboard shows a banner while paused. Switch it off to continue.
- **Why not every source on every run?** A search that already ran within the last few hours is skipped (it would only find the same jobs; the number of hours is under Settings → Job discovery), hosted scrapers (Apify) run only in scheduled runs, and a service that refuses its key is tried once, not once per search. *What the last search did, source by source* (Jobs page) lists every source with its reason, and says how many searches were skipped and why.
- **Which sources are worth it:** the Job sources page has a table for the last 30 days: searches, failures, postings read, new jobs, good matches, and a verdict per source (Productive, Some yield, Many jobs few fits, Nothing new, Returns nothing, Mostly failing) with advice to keep, fix or switch off. Numbers are labelled early until about a month of runs.
- **Apply assistant "not running":** having the computer on is not enough. The assistant is a program you start once on the computer (`docs/LAPTOP_SETUP.md`); the card turns green when it reports in.
