# Several people (profiles) in one Career Agent

You can run the same job search, scoring, resume writing and applying for more than one person: yourself, family members, or a second profile of your own. Each person is a **profile**. Nothing is shared between profiles except the AI models and the shared job-source keys.

## One-time setup (about two minutes)
1. Deploy this version. Until you do step 2 the app works exactly as before.
2. Open **System health**, copy the SQL shown for **0003_profiles**, paste it into Supabase (SQL editor, **Run**). Your existing data becomes the **Main profile**; nothing is lost or moved.
3. Open **People (profiles)** in the menu and **Add a profile**: a name and *their* email address.

## What belongs to each profile
Separate for every person: Profile (resume data), answer bank, Countries, Schedules, Settings (limits, Auto-Apply, pause, delivery), jobs, scores, resumes, applications, logs, reports, the **mailbox** (the address they apply from and where their job alerts arrive), and their daily limits.

Shared by all: the AI models and their keys, the job-source keys (Adzuna, JSearch, Apify), and who may sign in. Free-tier model limits are therefore shared, which is why models are spread across providers and keys.

## Working on a profile
The header shows a **Profile** drop-down once there are two or more. Everything on every page then belongs to the person chosen, and a coloured banner says whose profile it is. Set up each new profile the same way you set up your own: Profile, Countries, Job sources → mailbox, Schedules.

## What the automation does
The hourly check, the scheduled pipeline (search, score, prepare, apply), the morning report, the Telegram approve/skip buttons and the apply worker all run **once per profile that is switched on**, one after another, each inside that profile only. A problem in one profile never stops the others. **People (profiles) → Switch automation off** pauses one person.

## Who is told what
- **You** get everything on **Telegram** (each message starts with the person's name once there are several) and by **email**.
- **The person** gets the same notifications by **email only** (never Telegram), at the email you entered for them.
- Emails go out from the person's own mailbox when they have connected one (Job sources → Mailbox, a Gmail app password), otherwise from the main profile's mailbox.

## Applying from each person's own email
Employer applications by email are sent from **that person's** mailbox, never from someone else's. A profile with no mailbox cannot send them and is told so. The environment's SMTP settings and the cloud LinkedIn session belong to the main profile only.

## LinkedIn, Naukri, Indeed (the assistant on your computer)
These need each person's own sign-in, so each person has their own assistant and browser folder:

```
npm run assist:login                       # you (main profile), as before
ASSIST_FOR="Priya" npm run assist:login    # Priya signs in to HER LinkedIn / Naukri / Indeed, in ~/.career-agent/browser-priya
ASSIST_FOR="Priya" npm run assist:watch    # her hands-free assistant
bash scripts/autostart/install.sh --for "Priya"    # start hers at sign-in too (macOS / Linux)
```
`ASSIST_FOR` is the profile's name (any capitals). Without it the assistant works for the main profile.

## Letting a family member sign in
**Settings → Team access**: add their Google email, choose **Jobs & Apply** or **View only**, and tick which profiles they can open (their own). They see only those profiles and cannot change profiles, settings or models. With none ticked they see the main profile only (as before).

## Deleting a profile
**People (profiles) → Delete profile** removes the person and everything they own (jobs, applications, resumes and stored files, settings, logs). You must type the name to confirm. The main profile cannot be deleted.

## Good to know
- Backups include every profile (and are restored profiles first).
- Apify's monthly budget is counted once across all profiles; each profile keeps its own list of scrapers.
- A new profile starts with default limits (15 applications a day, Auto-Apply **off**). Switch Auto-Apply on for them only when their Profile and mailbox are ready.
