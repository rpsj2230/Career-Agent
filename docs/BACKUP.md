# Backups: database and files, stored in GitHub (encrypted)

## What is backed up, and where
- **Every night at 02:30 UTC** (and whenever you press Run in GitHub, Actions, *Backup database*), a GitHub job exports:
  - the **whole database** (profile, jobs, scores, applications, settings, logs, model keys in their encrypted form, email drafts), and
  - the **master resume file** and any other file in the `documents` bucket **except** the resume and cover letter written for each application (those can be rewritten from the database).
- It packs and **encrypts** them (AES-256) and stores one file per day in a **separate private GitHub repository**.
- It keeps the **newest 60 days**. When day 61 arrives, day 1 is deleted (and the repository history is rewritten, so the deleted backup is really gone). It continues that way: day 62 replaces day 2, and so on.

**Why a separate private repository?** The Career Agent code repository is **public**. A backup of your profile and job history must never be stored in a public place, even encrypted. The backup job refuses to run if the backup repository is the same as the code repository.

## One-time setup (about 5 minutes)
1. **Create the private repository.** GitHub, New repository, name `Career-Agent-Backups`, choose **Private**, tick "Add a README", Create.
2. **Create a token for it.** GitHub, your profile picture, Settings, Developer settings, Personal access tokens, **Fine-grained tokens**, Generate new token:
   - Repository access: **Only select repositories**, then `Career-Agent-Backups`
   - Repository permissions: **Contents: Read and write**
   - Expiration: the longest allowed (set a reminder to renew it)

   Copy the token (it is shown once).
3. **Choose a passphrase**: at least 16 characters, random, for example from your password manager. **Save it in your password manager. Without it a backup cannot be opened.**
4. In the **Career-Agent** repository: Settings, Secrets and variables, Actions, **New repository secret**, three times:

   | Name | Value |
   |---|---|
   | `BACKUP_REPO` | `rpsj2230/Career-Agent-Backups` |
   | `BACKUP_TOKEN` | the token from step 2 |
   | `BACKUP_PASSPHRASE` | the passphrase from step 3 |

   (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are already there.)
5. Run it once now: Career-Agent, **Actions**, *Backup database*, **Run workflow**. When it finishes you will see `daily/db-YYYY-MM-DD.tar.gz.enc` in the backup repository.

## How big is it?
Mostly text: a few MB at first. 10,000 stored jobs is roughly 50 to 200 MB of data, which compresses to roughly a quarter of that. 60 daily files of that size fit within GitHub's limits (the job stops with a clear message if one file passes GitHub's 100 MB limit). The master resume file adds a few hundred KB.

## Opening a backup on your computer
Use Git Bash on Windows (it comes with Git), or Terminal on Mac:

```
mkdir restore
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in db-2026-10-18.tar.gz.enc -pass pass:YOUR-PASSPHRASE | tar -xz -C restore
```

`restore/db/` holds one file per table, `restore/storage/` the files, `restore/manifest.json` the row counts.

## Restoring into a (new) Supabase project
1. Create the project and run the SQL files `supabase/migrations/0001_init.sql` and `0002_portals_runs_logs_schedules.sql` in its SQL editor.
2. In the `Career-Agent` folder on your computer (see `docs/LAPTOP_SETUP.md`, steps 1 to 3), with the **new** project's URL and service_role key in `.env.local`:

```
node scripts/restore.mjs restore
node scripts/restore.mjs restore --apply --reset-owner
```

   The first command shows what would be restored and changes nothing. `--reset-owner` forgets the old owner account so you can sign up again in the new project (sign up with your `CRON_SECRET` as the invite code).
3. Deploy the code to Vercel with the same environment variables, and add the GitHub secrets again.
4. Saved AI model keys are encrypted with your `SUPABASE_SERVICE_ROLE_KEY`, and a second copy with `CRON_SECRET`. Keep the same `CRON_SECRET` and they stay readable; otherwise paste the model keys again on the AI models page.

## Not included
- Your Supabase **login account** (it lives in Supabase Auth). After a restore into a new project you sign up again.
- The per-application resume and cover letter files (rewritable with "Write a new resume for this application").
- Secrets stored in Vercel and GitHub: keep a copy in your password manager.
