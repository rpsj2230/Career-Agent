# Career Agent: fill this form (browser extension)

For the sites the assistant cannot automate (Workday, Taleo and other employer systems that make an account per company, job boards that refuse the assistant's browser).
You open the application page in your own Chrome or Brave, press the extension's button, and it fills the form from your Career Agent data. **You press Submit yourself.**

What it does: fills your name, contact details, saved answers (from the Answer bank), years of experience (from your roles; your default for a tool they do not show), language proficiency (from the
languages on your Profile) and ticks plain agreement boxes. What it never does: press any button, submit, type a password, a payment or an identity number, overwrite a field that already has something in it, or send your data anywhere (it stays in the extension's own storage on your computer).

What it could not answer is outlined in orange on the page and listed in the extension's popup.

## Install (once)

1. In the project folder: `npm run build:extension`
2. Open `chrome://extensions` (Brave: `brave://extensions`), switch on **Developer mode**, press **Load unpacked**, choose the folder `extension/dist`.
3. In Career Agent: **Profile**, then **Download fill data for the browser extension**. Open the extension's popup, open "Your data", paste the file's text, press **Save**. Repeat after you change your profile or answers.

## Use

Open the application form, press the extension's icon, press **Fill this page from my data**, read what it filled, answer the orange fields, and press Submit yourself.
