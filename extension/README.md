# Career Agent by Rupash Pratap (browser extension)

For the applications the Mac assistant could not finish (Workday and other employer systems, job boards that refuse the assistant's browser), and for any application you open yourself.

## Choose how it works (the top of the popup)

- **Default: fallback.** Works through the applications the assistant could not finish (see "Automatic mode" below).
- **Manual only.** Nothing runs by itself and the timer is off. You open a page and press "Fill this page".
- **Filter Auto Apply.** You filter the jobs yourself on LinkedIn or Naukri, then press one button and the extension applies to them one by one (see below).

## Two ways to use it

**Manual, whenever you want, on any page.** Open any application page, click the extension's icon, press **Fill this page from my data**. It fills your name and contact details, saved answers, years of experience, languages and plain agreement boxes. If the page is one of your applications in Career Agent it attaches the resume (and cover letter, if the form has a box for it) made for that application; **any other page gets your default resume** (the file on the Resumes page) and your profile data. You can change the choice in the list under the button. You read it, answer anything outlined in orange, and press Submit yourself. "Open the next one and fill it" does the same for the next waiting application in a new tab.

**Automatic mode.** It works through the applications the assistant has given up on (or that wait for an answer), one at a time: open the form in a new tab, fill it, attach its resume, press Next and Submit page after page, wait for the employer's own confirmation message, tell Career Agent (which records the confirmation text), close the tab, go on to the next. Switch it on in the popup: "Run by itself every 30 minutes while the browser is open", or press "Run the waiting list now".

Automatic mode only runs when **Auto-Apply is on in Career Agent**, it is not paused, and today's limit is not used up. Career Agent enforces those rules and the one-application-per-company cool-down itself; the extension cannot override them. An application is marked sent only when the employer's confirmation text appeared on the page.

**It stops and gives the application back to you, with the reason shown in Career Agent, at anything only a person should do:** a captcha; a password, payment or identity field; any required field it could not fill; a page that is not a known application system and does not name the company; a Submit it pressed but that showed no confirmation (that tab stays open for you to check); a form that does not move on after Next. It then does not reopen that application for a day.

**It never:** types a password, a payment or an identity number, creates an account, solves a captcha, downloads or installs anything, overwrites a field that already has something in it, or sends your data anywhere except to your own Career Agent.

**What it cannot do:** run while the browser is closed (it uses your normal browser, so it needs Brave or Chrome open; I have not tested it with the screen locked), get past a sign-in or account creation (you do that, then fill again), or fill custom widgets that are not real form fields. If a page loads its form late or behind an Upload button, press the button once and fill again.

## Install (once, no command line)

1. In Career Agent: **Profile**, card "Browser extension", press **Download the extension (zip)**. Unzip it somewhere permanent (do not delete the folder; the browser reads it from there).
2. Open `chrome://extensions` (Brave: `brave://extensions`), switch on **Developer mode**, press **Load unpacked**, choose the unzipped folder.
3. In Career Agent: same card, press **Make a link code**, then **Copy**.
4. Click the extension's icon, open "Link to Career Agent", paste the code, press **Link**, and allow when the browser asks. Done: it now updates itself.

The first time you press "Open the next one and fill it", "Run the waiting list now" or switch the automatic mode on, the browser asks to allow the extension on websites; that is needed to fill the employers' pages it opens for you.

## Filter Auto Apply (LinkedIn and Naukri)

For jobs that are not in Career Agent yet: you do the searching, the extension does the applying.

1. Choose **Filter Auto Apply** at the top of the popup.
2. **LinkedIn:** open Jobs, search, switch on the **Easy Apply** filter (and any other filter you want, such as date posted or location). **Naukri:** open a job list with your filters on (Naukri has no Easy Apply filter: jobs that apply on the company's own site are skipped).
3. In that tab, click the extension's icon, choose how many jobs at most (up to 25), and press **Apply to the jobs on this page, one by one**. Keep the tab open while it works. **Stop** ends it after the job in hand.

For each job it: opens the job, skips it if LinkedIn shows "Applied", if it applies on the company's own site, or if Career Agent already has it or applied to that company recently; asks Career Agent whether it may be sent; opens Easy Apply, fills every step from your profile and saved answers, presses Next and Submit, waits for LinkedIn's "Application sent", closes the window, and tells Career Agent. The job and its application then appear in Applications, marked as sent by the extension. If the form asks for a resume, your default resume is attached (otherwise LinkedIn's own saved resume is left as it is).

It gives a job back to you instead of sending it when a required question has no answer in your profile or answer bank, when a field only you may type (password, payment, identity number) appears, when the window does not move on, or when it sees a captcha. That job is closed without saving, listed in Applications as **Needs you** with the reason, and the run goes on to the next job. Answer the question once in Career Agent (or use "Open the form" and the extension's Fill) and the answer is used from then on.

**It stops the whole run** at a LinkedIn security check or a "daily limit reached" message, a sign-in wall, when Career Agent says a limit is reached, and when it pressed Submit but saw no confirmation (that window is left open for you to check).

**What it fills:** text boxes, `<select>` lists, radio buttons and check boxes (also when the page hides the real button behind a styled label, and groups of boxes marked "select all that apply"), dropdowns that open a list of options, boxes that search a list as you type, the phone country code, the country, and the agreement boxes. None of it depends on a site's class names.

**Questions it cannot answer at first.** A form often words a question differently from the answer you saved. The extension first matches the meaning of the question against your saved answers ("Would you be open to relocation?" finds "Are you willing to relocate?"). If that finds nothing it asks Career Agent, which may ask its AI models, from your profile only, and saves what it learns in your answer bank (edit or delete it there), so the next form that asks it, in any wording, is answered at once. It never lets the AI answer about pay, visas, work rights, identity or the law: those, and anything the profile does not show, are handed back to you. A handed-back job lists the exact questions under **Questions waiting for your answer** on the Applications page; answer each once and it is used from then on.

**A status box** at the top right of the LinkedIn or Naukri page says which job it is working on and has a **Stop** button. If it cannot find the jobs or a button, it says what the page showed, and **Diagnose this page** in the popup prints those facts so they can be copied.

**Limits Career Agent enforces (the extension cannot override them):** Auto-Apply on, not paused, the daily total; for LinkedIn also "Allow automated LinkedIn Easy Apply" in Settings, the LinkedIn daily limit (default 10) and weekly limit (default 40); one application per company in the cool-down period; never a job already sent. A pause of a few seconds between jobs lets each page settle.

**Be aware:** LinkedIn's terms restrict automated use of the site, and it may limit or restrict an account it sees doing that. Keeping to a small daily number is the main protection, and the decision to use this mode is yours. The page-reading for LinkedIn and Naukri was written from how those sites are laid out and tested against stand-in pages, not against the live sites: their pages change, and when something is not found the job is skipped or handed back with the reason rather than guessed at.

## Where the zip is kept

The zip is rebuilt and committed to this repository (`public/downloads/career-agent-extension.zip`) by the "Extension zip" workflow whenever the extension changes, and a copy for each version is published under the repository's Releases (`extension-v<version>`) and as a workflow artifact for 90 days. So the extension is always on GitHub as well as in the app.

## Updating the extension itself

Your data updates by itself. The extension's own code changes rarely; when it does, its popup says "A newer extension is available". Then download the zip again, replace the folder's files with the new ones and press the reload arrow on `chrome://extensions`. (A listing in the Chrome Web Store would update it automatically, but the Web Store needs a developer account and a review, which only you can open.)

## For developers

`npm run build:extension` builds `extension/dist` and `public/downloads/career-agent-extension.zip` (it also runs before every `npm run build`). The link code is the app's address and a secret; only a hash of the secret is stored, and a new code replaces the old one. Tests: `tests/extension-e2e.test.ts` and `tests/extension-auto-e2e.test.ts` load the real extension into Chromium against a stand-in app and stand-in employer forms.
