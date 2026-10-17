# Apply assistant: start by itself, and the "Run assistant now" button

The assistant needs your computer only for portals that require you to be signed in (LinkedIn, Naukri, Indeed and similar). Employer sites on Greenhouse, Lever, Ashby and Workable are submitted in the cloud with your computer off.

A web page cannot start a program on your computer. So the assistant is set up once to start when you sign in, and the dashboard's **Run assistant now** button then makes it start a round straight away.

## One-time setup (about 10 minutes)
1. Install Node 22. In the project folder run `npm ci` and `npx playwright install chromium`.
2. Create `.env.local` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Run `npm run assist` once. A browser window opens: sign in to LinkedIn, Naukri, Indeed and the others you use. The sessions are kept on your computer.
4. In the app, **Settings → Application limits**, switch on the local hands-free option (the watcher only submits within your daily limits).
5. Install the autostart:
   - macOS or Linux: `bash scripts/autostart/install.sh`
   - Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File scripts\autostart\install.ps1`
   Remove it any time by adding `--remove` (macOS/Linux) or `-Remove` (Windows).
6. Optional: `ASSIST_HOURS=9-21` in `.env.local` limits the automatic rounds to those hours. The button always works.

## Using it
- Open the dashboard. The **Apply assistant** card shows *running* or *not running* and how many applications are waiting.
- Press **Run assistant now**; within about 30 seconds the assistant starts a round and the card shows the result.
- If your computer is off, the card says *not running*. Applications simply stay queued and are done when the computer is on again. You are alerted on Telegram if work has waited for hours.
- If a portal asks for a sign-in or CAPTCHA, the application is handed back to you with the reason; sign in again with `npm run assist`.
