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

## Leaving a portal to yourself
If a portal cannot be signed in on this computer, or you prefer to apply there by hand, add this line to `.env.local`: `ASSIST_SKIP=naukri` (several: `naukri,shine`). The assistant never opens those portals; their applications stay waiting in the app for you to do manually. Remove the line to bring the portal back.

## If the computer feels slow
The assistant opens one browser, one page at a time, with a pause of 45 to 120 seconds between applications, and closes each page afterwards. It runs at low priority (set by the autostart) and only one copy per profile may work at a time; a second copy waits.
- See what is running: `ps aux | grep -E "assist|chrom" | grep -v grep | cut -c1-150` (several `assist.ts` lines means more than one is running) and open Activity Monitor, sorted by Memory.
- Close any browser window left over from `npm run assist:login`.
- Make it smaller: `ASSIST_LIMIT=10` in `.env.local` (applications per round), or `ASSIST_HOURS=22-6` so it only works at night. Then run `bash scripts/autostart/install.sh` again.
- Stop it completely: `bash scripts/autostart/install.sh --remove`.

## Without your computer: the cloud assistant
With Autopilot on, applications to employers' own pages (sites that need no sign-in) are applied for by a GitHub runner every hour (workflow "Cloud assistant (employer pages)", free for a public repository), and the assistant on your computer leaves them alone. Nothing to install. It uses the same repository secrets as the scheduled pipeline (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, APP_URL, and optionally the model and Telegram secrets).
LinkedIn, Indeed and Naukri stay with the assistant on your computer, because they need your signed-in browser session; from a cloud address they would also be likely to show security checks.
