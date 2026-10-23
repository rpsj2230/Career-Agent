# Career Agent: fill this form (browser extension)

For the sites the assistant cannot automate (Workday, Taleo and other employer systems that make an account per company, job boards that refuse the assistant's browser), and for any application you open yourself.

**What it does**
- Gets your latest details, saved answers and waiting applications from Career Agent by itself (after a one-time link). Nothing to paste or re-export when you change your profile.
- On the page you are looking at: fills your name and contact details, saved answers, years of experience, languages, plain agreement boxes, and attaches the resume (and cover letter, if the form has a box for it) that Career Agent made for that application.
- "Open the next one and fill it": opens the applications waiting for you one after another, each in a new tab, filled and with its resume attached. You read it, answer anything outlined in orange, and press Submit yourself, then press "I submitted it" in the extension so Career Agent records it.

**What it never does:** press Submit or any other button, type a password, payment or identity number, create an account, overwrite a field that already has something in it, or send your data anywhere except to your own Career Agent.

**What it cannot do:** submit for you (by design; the Mac assistant is the hands-free part), get past a sign-in or account creation (you do that, then press the button again), or fill custom widgets that are not real form fields. If a page loads its form late or behind an Upload button, press the button once and fill again.

## Install (once, no command line)

1. In Career Agent: **Profile**, card "Browser extension", press **Download the extension (zip)**. Unzip it somewhere permanent (do not delete the folder; the browser reads it from there).
2. Open `chrome://extensions` (Brave: `brave://extensions`), switch on **Developer mode**, press **Load unpacked**, choose the unzipped folder.
3. In Career Agent: same card, press **Make a link code**, then **Copy**.
4. Click the extension's icon, open "Link to Career Agent", paste the code, press **Link**, and allow when the browser asks. Done: it now updates itself.

The first time you press "Open the next one and fill it", the browser asks to allow the extension on websites; that is needed to fill the employers' pages it opens for you.

## Updating the extension itself

Your data updates by itself. The extension's own code changes rarely; when it does, its popup says "A newer extension is available". Then download the zip again, replace the folder's files with the new ones and press the reload arrow on `chrome://extensions`. (A listing in the Chrome Web Store would update it automatically, but the Web Store needs a developer account and a review, which only you can open.)

## For developers

`npm run build:extension` builds `extension/dist` and `public/downloads/career-agent-extension.zip` (it also runs before every `npm run build`). The link code is the app's address and a secret; only a hash of the secret is stored, and a new code replaces the old one.
