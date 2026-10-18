# Setting up the apply assistant on your own computer (step by step)

You need this **only** for applications on LinkedIn, Naukri, Indeed and similar sites that require you to be signed in. Applications on Greenhouse, Lever, Ashby and Workable, and applications sent by email, are sent from the cloud and need none of this.

Nothing here runs in Claude's cloud session: it runs on **your** Windows PC or Mac, in a normal browser window.

## On a Mac: one command does everything
1. Press **Cmd + Space**, type **Terminal**, press Enter.
2. Paste this one line and press Enter:

```
curl -fsSL https://raw.githubusercontent.com/rpsj2230/Career-Agent/main/scripts/mac-setup.sh | bash
```

3. Answer its questions. It installs what is missing (Node.js), downloads the project to `/Users/rupash/Claude/Personal/Career-Agent` (set `CAREER_AGENT_DIR=/some/folder` before the command to choose another place), installs it, asks you to paste two values from Supabase (Project URL and the `service_role` key: Supabase, your project, Project Settings, API), checks everything, opens the browser so you can sign in to LinkedIn, Naukri and Indeed once, and offers to start the assistant automatically whenever you sign in to the Mac.
4. If it says "A window asked to install the Apple developer tools", click Install, wait for it to finish, and paste the same line again. It is safe to run again at any time; it only fills in what is missing.
5. If you choose a folder that syncs to the cloud (Google Drive, iCloud, Dropbox), your Supabase key is kept in `~/.career-agent/env` instead and `.env.local` is a shortcut to it, so the key is never uploaded.
6. In the app: **Settings, Auto-Apply** on, and **Application limits, "Let the apply assistant on my computer press Submit by itself"** on. The **Apply assistant** card on the Applications page then turns green.

The manual steps below are the same thing written out, for Windows or if you want to see each step.

## 0. What you need
- A Windows 10/11 PC, a Mac, or Linux, that is switched on while it applies.
- Two values from Supabase (step 4).

## 1. Install Node.js and Git (once)
1. Node.js 22 or newer: https://nodejs.org (choose the LTS or Current installer, run it, accept the defaults).
2. Git: https://git-scm.com/downloads (accept the defaults).
3. Close and reopen your terminal, then check:

```
node --version
git --version
```

`node` must print v22 or higher.

**Which terminal?** Windows: press the Windows key, type `PowerShell`, open it. Mac: press Cmd+Space, type `Terminal`.

## 2. Download the project (once)

```
cd ~
git clone https://github.com/rpsj2230/Career-Agent.git
cd Career-Agent
```

(In Windows PowerShell, `cd ~` goes to your user folder. That is fine.)

## 3. Install it (once)

```
npm ci
npx playwright install chromium
```

This downloads the program's parts and a browser the assistant controls. It takes a few minutes.

## 4. Tell it where your database is
Open Supabase, your project, **Project Settings, API**. Copy:
- **Project URL** (looks like `https://abcdefgh.supabase.co`)
- **service_role** key (the long secret one, NOT the anon key). Treat it like a password.

Create the file `.env.local` inside the `Career-Agent` folder.

**Mac / Linux** (paste the whole block, with your own values):

```
printf 'SUPABASE_URL=https://abcdefgh.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=paste-the-service-role-key-here\n' > .env.local
```

**Windows PowerShell:**

```
Set-Content -Encoding ascii .env.local -Value "SUPABASE_URL=https://abcdefgh.supabase.co","SUPABASE_SERVICE_ROLE_KEY=paste-the-service-role-key-here"
```

The file is ignored by git, so it is never uploaded. Do not share it.

## 5. Check that everything is ready

```
npm run assist:check
```

It prints one line per check, with OK or FIX and what to do. Run it again after each fix. At this point a few lines are expected to say FIX (signing in to the portals, hands-free switches, the background watcher); the next steps fix them.

## 6. Sign in to the job portals once

```
npm run assist:login
```

A browser window opens with one tab per portal. Sign in to LinkedIn, Naukri, Indeed (and any other you use) **in that window**. The sessions are kept on your computer in the folder `.career-agent/browser` inside your user folder; the app never sees your passwords. When you have finished, **close the browser window**. To sign in again later, run the same command.

## 7. Let it work by itself (optional, "hands-free")
1. In the app: **Settings, Auto-Apply** switch on, and **Settings, Application limits, "Let the apply assistant on my computer press Submit by itself"** on. Keep the daily limits low.
2. Start the watcher:

```
npm run assist:watch
```

Leave that window open. It checks every 20 minutes, and immediately when you press **Apply with assistant** or approve an application that needs it. Stop it with Ctrl+C.

3. Start it automatically when you sign in to your computer:
   - Mac / Linux: `bash scripts/autostart/install.sh`
   - Windows PowerShell: `powershell -ExecutionPolicy Bypass -File scripts\autostart\install.ps1`

   To remove it, add `--remove` (Mac/Linux) or `-Remove` (Windows) to the same command.
4. Keep the computer awake while you want it to apply (Windows: Settings, System, Power; Mac: System Settings, Battery, prevent sleep).

If you prefer to review each form yourself, skip step 7: `npm run assist` opens each application, fills it, and waits for you to press the site's own Submit button.

## 8. Every day
Nothing. Applications that need the assistant wait in the queue ("Waiting for assistant") and are done when your computer is on and the watcher is running. The Applications page shows whether the assistant is running.

## 9. Updating later

```
cd "<the project folder>"
git pull
npm ci
```

## Troubleshooting

| Message | Fix |
|---|---|
| `SUPABASE_URL is not set` | `.env.local` is missing or in the wrong folder. It must be inside `Career-Agent`. |
| The browser the assistant uses is not installed | Run `npx playwright install chromium` |
| A portal keeps asking you to sign in | Run `npm run assist` and sign in again in that window. |
| A CAPTCHA or security check appears | Solve it yourself in the window. Hands-free mode stops and hands the application back. |
| `assist:check` says the watcher is not running | Start `npm run assist:watch` (step 7). |
