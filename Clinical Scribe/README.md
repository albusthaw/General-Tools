# Clinical Scribe

Clinical Scribe records a consultation, turns the speech into a transcript and writes a clinical note in the format you choose. It runs on your own Supabase project, so you keep control of the records, the AI keys and the user accounts.

- **Scribe**: record with pause, resume and finish. The audio is saved in parts while you record. After you press Finish, the server does the rest, even if you close the browser.
- **Templates**: SOAP note is ready to use. Admins add shared templates for everyone. Each person can make their own templates by describing the note they want; the template AI writes the full template.
- **History**: every transcript and every note, ready to copy. You can write another note from an old transcript at any time. Notes are final and cannot be edited.
- **Admin settings**: people and their transcription minutes, AI keys and models, a logged review of other people's records, the audit log, Google sign-in and email settings.

Transcription uses ElevenLabs or Gemini. Notes use Gemini (the default) or DeepSeek. The template helper uses one of Gemini or DeepSeek.

## Contents

1. [Deploy in one click](#1-deploy-in-one-click)
2. [First steps in the app](#2-first-steps-in-the-app)
3. [Upgrade to a newer version](#3-upgrade-to-a-newer-version)
4. [Host the web app somewhere else](#4-host-the-web-app-somewhere-else)
5. [Deploy from your own computer](#5-deploy-from-your-own-computer)
6. [Privacy and security](#6-privacy-and-security)
7. [Problems and fixes](#7-problems-and-fixes)
8. [For maintainers](#8-for-maintainers)
9. [Changes](#changes)

## 1. Deploy in one click

The GitHub workflow **Deploy Clinical Scribe** sets everything up: the database, the server functions, the sign-in settings, the first admin account and the web app. The web app is published free on GitHub Pages. You prepare a few settings once, then press one button.

### What you need

- A Supabase account (https://supabase.com). The free plan works for trying the app. For real patients, use a paid plan (see [Privacy and security](#6-privacy-and-security)).
- This repository on GitHub, with permission to change its settings.
- An API key for at least one transcription service (ElevenLabs or Gemini) and one note service (Gemini or DeepSeek). You add these later, inside the app.

### Step 1: Create a Supabase project

1. In the Supabase dashboard, choose **New project**.
2. Give it a name, choose a region near the people who will use it, and set a strong **database password**. Keep this password; you need it in step 3.
3. Wait until the project is ready (about two minutes).
4. Note the **project code**. It is the 20-letter part of the project address `https://<code>.supabase.co`. You can also find it under **Project Settings → General → Project ID**.

### Step 2: Create a Supabase access token

1. Open https://supabase.com/dashboard/account/tokens.
2. Choose **Generate new token**, name it (for example "Clinical Scribe deploy") and copy it. It starts with `sbp_`.

### Step 3: Add the settings to GitHub

In the repository on GitHub, open **Settings → Secrets and variables → Actions** and add these with **New repository secret**:

| Name | Value | Needed |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | The token from step 2 | Yes |
| `SUPABASE_PROJECT_REF` | The 20-letter project code from step 1 | Yes |
| `SUPABASE_DB_PASSWORD` | The database password from step 1 | Yes |
| `CLINICAL_SCRIBE_ADMIN_EMAIL` | Your email address, for the first admin account | Recommended |
| `CLINICAL_SCRIBE_ADMIN_PASSWORD` | A password for that account: at least 10 characters, with letters and numbers | Recommended |

The two admin settings are only used while the project has no accounts. After that they are ignored, so they never change an existing account.

### Step 4: Switch on GitHub Pages

Open **Settings → Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**.

### Step 5: Run the deploy

1. Open the **Actions** tab and choose **Deploy Clinical Scribe** on the left.
2. Choose **Run workflow**. Keep **main** as the branch and leave the address box empty.
3. Wait about five minutes. When both parts of the run show a green tick, the run page shows the app address, for example `https://<your-name>.github.io/General-Tools/`.
4. Open the address and sign in with the admin email and password from step 3.

If you did not add the admin settings, open **Authentication → Users → Add user** in the Supabase dashboard and create a user with **Auto Confirm User** ticked. The first account in the project becomes the admin. Public sign-up is switched off at the very start of the deploy, so nobody else can create that first account.

The workflow appears in the Actions tab only after this folder is on the `main` branch. GitHub Pages also only accepts deploys from `main` unless you allow another branch under **Settings → Environments → github-pages**.

## 2. First steps in the app

1. **AI settings**: add your service keys and press **Check key** for each. Choose the transcription service and model, the note service and model, and the template service. The defaults are a good start.
2. **User settings**: add each person with their name, email address, a starting password and their transcription minutes. Make someone an admin only if they need it.
3. **Your name**: open the account menu (your name at the bottom of the side menu; on a phone, the account button at the top right) to set the name shown in the audit log.
4. **Google sign-in** (optional): the page explains each step. People can only sign in with Google if an admin has already added their email address.
5. **Email (SMTP)**: you can save mail server settings now. Nothing uses them yet.

## 3. Upgrade to a newer version

1. Bring the new version into this repository's `main` branch (for example, merge the pull request or sync your copy).
2. Run **Deploy Clinical Scribe** again, exactly as in step 5 above.

Every step is safe to repeat. Only database changes that are new are applied, so all records, people and settings are kept. Sign-in settings you changed, such as Google sign-in, are kept too. The version number is shown at the bottom of the side menu, each upgrade is written in the audit log (filter **Updates**), and admins see a notice if the app and the server ever run different versions.

The same upgrade can be run from a computer with `node build/deploy/deploy.mjs` (see [section 5](#5-deploy-from-your-own-computer)).

## 4. Host the web app somewhere else

GitHub Pages is the simplest choice, but any static web host works, for example Vercel, Netlify or Cloudflare Pages. These hosts can also send extra security headers, which GitHub Pages cannot; the files `web/vercel.json` and `web/public/_headers` already contain them.

1. Create a site on the host from this repository with these settings:
   - Root (base) directory: `Clinical Scribe/web`
   - Build command: `npm run build`
   - Output directory: `dist`
   - Environment variables: `VITE_SUPABASE_URL` = `https://<code>.supabase.co` and `VITE_SUPABASE_PUBLISHABLE_KEY` = the publishable key from **Project Settings → API Keys** in Supabase. Both values are public by design; the server protects all data.
2. Run **Deploy Clinical Scribe** and type the site's address (for example `https://scribe.example.org/`) in the address box. This sets up the server and tells Supabase where people return to after signing in. It skips GitHub Pages and keeps the built app as a download on the run page instead.

## 5. Deploy from your own computer

You need Node.js 20.19 or newer (https://nodejs.org) and the Supabase command-line tool, version 2.50 or newer (https://supabase.com/docs/guides/local-development/cli/getting-started). Docker is not needed.

Open a terminal in the `Clinical Scribe` folder and set the same values as in step 3. On macOS or Linux:

```bash
export SUPABASE_ACCESS_TOKEN="sbp_..."
export SUPABASE_PROJECT_REF="abcdefghijklmnopqrst"
export SUPABASE_DB_PASSWORD="your database password"
export APP_URL="https://scribe.example.org/"        # where the web app will be
export CLINICAL_SCRIBE_ADMIN_EMAIL="you@example.org" # optional, first deploy only
export CLINICAL_SCRIBE_ADMIN_PASSWORD="..."          # optional, first deploy only
node build/deploy/deploy.mjs check
node build/deploy/deploy.mjs
```

On Windows PowerShell, set each value with `$env:SUPABASE_ACCESS_TOKEN = "sbp_..."` and so on, then run the same two `node` commands.

| Command | What it does |
| --- | --- |
| `node build/deploy/deploy.mjs check` | Checks the values, the project and the tools. Changes nothing. |
| `node build/deploy/deploy.mjs` | Builds the web app into `web/dist`, then sets up or upgrades the server. |
| `node build/deploy/deploy.mjs server` | The server only: database, server functions and settings. |
| `node build/deploy/deploy.mjs web` | The web app only, built into `web/dist`. |

Put the contents of `web/dist` on any static web host. The files use relative paths, so the app works in a sub-folder too.

## 6. Privacy and security

- **AI keys** are kept encrypted in Supabase Vault. Only the server functions can read them. Admins see only the last four characters, and keys never reach the browser.
- **Accounts**: public sign-up is switched off. Only admins add people. An account that appears any other way has no access until an admin approves it.
- **Records**: each person sees only their own recordings. Admins can open someone else's records only through **Review records**, which needs a reason and a confirmation. Every list viewed, record opened and item copied is written to the audit log with the admin's name and reason. The audit log cannot be changed or deleted, even by admins.
- **Audio** is kept in a private storage area. Admins choose how long it is kept (**AI settings → Recordings and sign-in**). Gemini copies are deleted from Google as soon as the transcript is read. ElevenLabs offers zero retention on plans that allow it.
- **Before recording real patients**: use paid plans for Supabase and the AI services, and sign the agreements your organisation needs (for example a data processing agreement or a business associate agreement). Choose a Supabase region that matches your data rules.
- Notes are written by AI from the transcript. **Always check a note before you use it.** Clinical Scribe supports documentation; it does not replace clinical judgement.

The full security design is in `project.md` (section 7).

## 7. Problems and fixes

| What you see | What to do |
| --- | --- |
| "Get Pages site failed" in the run | Set **Settings → Pages → Source** to **GitHub Actions**, then run again. |
| "Branch … is not allowed to deploy to github-pages" | Run the workflow from `main`, or allow the branch under **Settings → Environments → github-pages**. |
| "Supabase did not accept the access token" | Create a new token (step 2) and update `SUPABASE_ACCESS_TOKEN`. |
| "Updating the database did not finish" | Check `SUPABASE_DB_PASSWORD`. You can reset it under **Project Settings → Database** in Supabase. |
| "The Supabase project is paused" | Free projects pause after a week without use. Restore it from the Supabase dashboard, then run again. |
| The app says it is not connected | The web app was built without the project details. Run the deploy again, or check the two `VITE_` values on your web host. |
| Recordings stay at "Transcribing" | Check the key in **AI settings** with **Check key**. In Supabase, **Edge Functions → worker → Logs** shows what the worker is doing. |
| No admin is left | In the Supabase **SQL Editor**, run `update public.profiles set role = 'admin', status = 'active' where email = 'you@example.org';` with your own email address. |

## 8. For maintainers

### Folder layout

```
Clinical Scribe/
├── README.md        this guide
├── project.md       plan: features, architecture, data model, security, testing
├── design.md        look and wording rules
├── VERSION          app version, shown in the app and recorded on the server
├── build/
│   ├── deploy/      the deploy and upgrade script (used by the workflow and by hand)
│   └── make-icons.mjs
├── Release/         nothing is built into a file; see Release/README.txt
├── supabase/        config.toml, migrations, Edge Functions (worker, templates-ai, admin)
├── web/             the web app (Vite, plain JavaScript modules)
└── tests/           unit, server, deploy and browser tests, with stand-in AI services
```

### Tests

`tests/run-local.sh` runs every test against a local Supabase stack with stand-in AI services, so no real keys are needed. It needs Docker, the Supabase command-line tool, Node.js 20.19 or newer, `psql`, and Deno 2 for the server function checks. It resets the local database, so never point it at a project with real data.

```bash
tests/run-local.sh          # everything
tests/run-local.sh unit     # unit tests and server function checks, no Docker needed
tests/run-local.sh api      # server tests
tests/run-local.sh deploy   # the deploy script against the local stack
tests/run-local.sh e2e      # browser tests at desktop and phone sizes
```

The workflow **Test Clinical Scribe** runs the same tests on GitHub whenever this folder changes.

### Releasing a new version

1. Make the change. Database changes always go in a **new** migration file in `supabase/migrations/` with a later date in its name; never edit a migration that has been deployed.
2. Raise the number in `VERSION` (`major.minor.patch`) and add a short entry under **Changes** below.
3. Run the tests, merge to `main`, then run **Deploy Clinical Scribe**.
4. Tag the release as `cscribe-v<version>`, for example `cscribe-v1.1.0`.

## Changes

### 1.0.0

- First release.
- Recording in parts with pause, resume and finish, crash recovery on the device, and processing that carries on after the browser is closed.
- Transcription with ElevenLabs or Gemini; notes with Gemini or DeepSeek; templates made with AI help.
- History with copyable transcripts and final notes, and more notes from old transcripts.
- Admin settings: people, transcription minutes, AI keys and models, logged record reviews, audit log, Google sign-in and email settings.
- One-click deploy and upgrade with GitHub Actions, or from a computer.
