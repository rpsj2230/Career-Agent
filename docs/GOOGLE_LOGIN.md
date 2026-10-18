# Sign in with Google, and giving other people limited access

The app already has a **Continue with Google** button on the login page. It works once Google sign-in is switched on in Supabase (about 10 minutes, one time).

## 1. Create the Google credentials (Google Cloud)
1. Open https://console.cloud.google.com and choose (or create) a project.
2. **APIs & Services, OAuth consent screen**: user type **External**, app name `Career Agent`, your email as support and developer contact. Save. (You can leave it in "Testing" and add yourself and your team under **Test users**; or publish it, which does not need verification for basic sign-in.)
3. **APIs & Services, Credentials, Create credentials, OAuth client ID**: type **Web application**.
4. Under **Authorized redirect URIs** add exactly:

   `https://amaetwzmgbyqgcqwstau.supabase.co/auth/v1/callback`

   (That is your Supabase project URL followed by `/auth/v1/callback`.)
5. Create. Copy the **Client ID** and **Client secret**.

## 2. Switch it on in Supabase
1. Supabase, your project, **Authentication, Sign In / Providers, Google**: switch **Enable** on, paste the Client ID and Client secret, save.
2. **Authentication, URL Configuration**:
   - **Site URL**: `https://career-agent-sand.vercel.app`
   - **Redirect URLs**: add `https://career-agent-sand.vercel.app/api/auth/callback`
   - If you use Vercel preview addresses, add `https://*-rupash.vercel.app/api/auth/callback` too.

## 3. Use it
Open the login page and press **Continue with Google**. The Google account's email must be allowed:
- Your own email (the owner) is always allowed. If you first created your account with a password using the same email, Google sign-in signs you into the same account.
- Anyone else needs to be added under **Settings, Team access** (below), or listed in the `ALLOWED_EMAILS` variable (those become super admins).

If Google sign-in fails, the login page says so. The usual causes: the redirect URI in step 1.4 is not exactly as above, the Redirect URL in step 2.2 is missing, or the email is not on the allowed list ("This account is not allowed").

## Giving other people limited access (Settings, Team access)
Only you, the **super admin**, see Settings. In **Settings, Team access** add an email and choose:

| Access | Sees | Can do |
|---|---|---|
| **Jobs & Apply** | **Jobs found & scored** and **Applications** only | Everything in those two sections: prepare resumes, approve, send, skip, regenerate, add a job by hand, use the apply assistant. Nothing else. |
| **View only** | The same two sections | Look only. Every action is refused. |

They sign in with **Google** using that email. They never see Settings, AI models, Profile, Schedules, Logs, System health or any key. Changing or removing someone takes effect on their next click. Their sign-ins and refusals appear in **Logs & history**.

The apply assistant on your computer and the hourly GitHub automation are unaffected: they run as you.
