# Career Agent: fill this form (browser extension)

For the applications the Mac assistant could not finish (Workday and other employer systems, job boards that refuse the assistant's browser), and for any application you open yourself.

## Two ways to use it

**Manual, whenever you want.** Open any application page, click the extension's icon, press **Fill this page from my data**. It fills your name and contact details, saved answers, years of experience, languages and plain agreement boxes, and attaches the resume (and cover letter, if the form has a box for it) that Career Agent made for that application. You read it, answer anything outlined in orange, and press Submit yourself. "Open the next one and fill it" does the same for the next waiting application in a new tab.

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

## Updating the extension itself

Your data updates by itself. The extension's own code changes rarely; when it does, its popup says "A newer extension is available". Then download the zip again, replace the folder's files with the new ones and press the reload arrow on `chrome://extensions`. (A listing in the Chrome Web Store would update it automatically, but the Web Store needs a developer account and a review, which only you can open.)

## For developers

`npm run build:extension` builds `extension/dist` and `public/downloads/career-agent-extension.zip` (it also runs before every `npm run build`). The link code is the app's address and a secret; only a hash of the secret is stored, and a new code replaces the old one. Tests: `tests/extension-e2e.test.ts` and `tests/extension-auto-e2e.test.ts` load the real extension into Chromium against a stand-in app and stand-in employer forms.
