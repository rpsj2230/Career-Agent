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

## Three workers that back each other up
With Autopilot on, an application is taken by exactly one worker: it is claimed in the database before any browser opens, so two workers can never submit the same one.
- **GitHub runner** (free, hourly, nothing to install): employers' own pages (sites that need no sign-in). Workflow "Cloud assistant (employer pages)".
- **A small always-on machine** (optional, for example Oracle Cloud Always Free): the same employer pages, around the clock, headless. Set it up with `scripts/oracle/setup.sh` (steps below).
- **Your computer**: LinkedIn, Indeed, Naukri (they need your sign-in), and it takes over any employer page that has waited more than 90 minutes (`ASSIST_FALLBACK_MINUTES`) because the other two were down, busy or out of time.
An application that a worker started and then lost (the machine died mid-way) is handed back to you after 75 minutes, because nobody knows whether the employer received it.

### Setting up the always-on machine (Oracle Cloud, step by step)
1. **Sign up** at https://www.oracle.com/cloud/free/ ("Start for free"). A card is needed to verify who you are; for the Always Free resources it is not charged. Choose your **home region** with care: it cannot be changed later, and Always Free machines can only be created there.
2. **Make an SSH key** on your computer (once): `ssh-keygen -t ed25519` and press Enter for the defaults. Your public key is the file `~/.ssh/id_ed25519.pub` (`cat ~/.ssh/id_ed25519.pub`).
3. In the Oracle console: **Compute → Instances → Create instance**. Image: **Ubuntu 24.04**. Shape: **Ampere (VM.Standard.A1.Flex)** with 2 OCPU and 12 GB, or, if that says "out of capacity", try again later, try another availability domain, or use the AMD micro shape (1 GB is small for a browser). Networking: give it a public address. SSH keys: **paste your public key**. Create it.
4. In the instance's network settings keep only **port 22 (SSH)** open. The setup script also closes everything else on the machine.
5. **Connect:** `ssh -i ~/.ssh/id_ed25519 ubuntu@THE_PUBLIC_ADDRESS`.
6. **On the machine** run: `curl -fsSL https://raw.githubusercontent.com/rpsj2230/Career-Agent/main/scripts/oracle/setup.sh -o setup.sh && bash setup.sh`. It installs everything, asks for SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET (kept in a file only you can read), and starts the worker now and at every boot. It handles employers' own pages first.
7. Watch it: `journalctl -u career-agent-assist -f`. Stop it: `sudo systemctl disable --now career-agent-assist`.

### Adding LinkedIn, Indeed and Naukri to the always-on machine (optional)
Your computer signs in once as usual (`npm run assist:login`). Then:
1. On your computer: `npm run assist:export`. It saves your sign-ins to one file (as sensitive as a password) and prints the `scp` command; run it to copy the file to the machine, then delete the file on your computer.
2. On the machine: `bash ~/Career-Agent/scripts/oracle/enable-logins.sh`.
From then on the machine also applies on those three sites. If a site shows it a sign-in page, a CAPTCHA or a security check (likely from a datacenter address), the application is **passed to the assistant on your computer, not handed to you**, and the machine leaves that site alone for six hours. Your computer leaves those sites to the machine only while it reports in (every few minutes); if it stops, your computer takes them at once. Sites may ask you to verify, or restrict the account, when you sign in from a new place: that is the risk you accept by doing this.
Oracle can reclaim "idle" Always Free machines (check their current rule); if that happens the failover above means your computer simply takes over.
