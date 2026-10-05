# Clinical Scribe

Clinical Scribe records a consultation or your own dictation, turns the speech into a transcript and writes a clinical note in the format you choose. It runs on your own Supabase project, so you keep control of the records, the AI keys and the user accounts.

- **Clinical Scribe**: for a conversation between two or more people, such as a consultation. Record with pause, resume and finish. The audio is saved in parts while you record. After you press Finish, the server does the rest, even if you close the browser. The transcript shows who said what.
- **Voice Note**: for one person dictating, such as a note or a letter. It works exactly like Clinical Scribe, and the AI is told that it is a dictation, not a conversation: the transcript has no speaker labels, spoken words such as "full stop" and "new paragraph" become punctuation in the note, and spoken corrections are applied.
- **Templates**: every template has a **Template Type**, Clinical Scribe or Voice Note, so each tab offers only its own templates. SOAP note (Clinical Scribe) and Dictated note (Voice Note) are ready to use. Each person can make their own templates by describing the note they want; the template AI writes the full template. People can delete their own templates at any time. Admins make templates for everyone, or for themselves and share them later.
- **History**: two tabs, Clinical Scribe and Voice Note, with every transcript and every note, ready to copy, 10 recordings to a page. The search finds any recording by its label, its transcript or its notes. The notes of a recording open and close; the newest is open. You can write another note from an old transcript at any time, with a template of the same type. Notes are final and cannot be edited.
- **Minutes**: each person has transcription minutes that only an admin can add. The server measures the real length of the audio before it is transcribed, so the minutes cannot be bypassed.
- **Admin settings**: people and their transcription minutes, AI keys and models (with lists that update from each service), the **Recording** page for audio, a logged review of other people's records, the audit log, Google sign-in and email settings. The admin pages show whether each recording or template is Clinical Scribe or Voice Note.
- **Phone apps**: an Android app and an iPhone and iPad web app with every feature of the website, laid out for phones. They ask for your server link once. The **Phone apps** page, open to everyone, has the link, a QR code and the downloads.

Transcription uses ElevenLabs or Gemini. Notes use Gemini (the default) or DeepSeek. The template helper uses one of Gemini or DeepSeek.

## Contents

1. [Deploy in one click](#1-deploy-in-one-click)
2. [First steps in the app](#2-first-steps-in-the-app)
3. [Phone apps](#3-phone-apps)
4. [Upgrade to a newer version](#4-upgrade-to-a-newer-version)
5. [Host the web app somewhere else](#5-host-the-web-app-somewhere-else)
6. [Deploy from your own computer](#6-deploy-from-your-own-computer)
7. [Privacy and security](#7-privacy-and-security)
8. [Problems and fixes](#8-problems-and-fixes)
9. [For maintainers](#9-for-maintainers)
10. [Changes](#changes)

## 1. Deploy in one click

The GitHub workflow **Deploy Clinical Scribe** sets everything up: the database, the server functions, the sign-in settings, the first admin account and the web app. The web app is published free on GitHub Pages. You prepare a few settings once, then press one button.

### What you need

- A Supabase account (https://supabase.com). The free plan works for trying the app. For real patients, use a paid plan (see [Privacy and security](#7-privacy-and-security)).
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
3. Wait about five minutes. When both parts of the run show a green tick, the run page shows the app address, for example `https://<your-name>.github.io/General-Tools/`, and the address of the iPhone web app.
4. Open the address and sign in with the admin email and password from step 3.

If you did not add the admin settings, open **Authentication → Users → Add user** in the Supabase dashboard and create a user with **Auto Confirm User** ticked. The first account in the project becomes the admin. Public sign-up is switched off at the very start of the deploy, so nobody else can create that first account.

The workflow appears in the Actions tab only after this folder is on the `main` branch. GitHub Pages also only accepts deploys from `main` unless you allow another branch under **Settings → Environments → github-pages**.

## 2. First steps in the app

1. **AI settings**: add your service keys and press **Check key** for each. Press **Update model lists** to load the models each service offers now. Choose the transcription service and model, the note service and model, and the template service. Models marked *recommended* are known to work well for each job, and the defaults are a good start. Press **Test chosen models** to send each chosen model a tiny request before you save. If your ElevenLabs account is an Enterprise account, you can switch on **Ask ElevenLabs not to keep recordings**; it is checked with ElevenLabs before it turns on.
2. **User settings**: add each person with their name, email address, a starting password and their transcription minutes. Make someone an admin only if they need it.
3. **Your name**: open the account menu (your name at the bottom of the side menu; on a phone, the account button at the top right) to set the name shown in the audit log.
4. **Google sign-in** (optional): the page explains each step. People can only sign in with Google if an admin has already added their email address.
5. **Email (SMTP)**: you can save mail server settings now. Nothing uses them yet.
6. **Templates**: SOAP note is the default for Clinical Scribe and Dictated note for Voice Note. On the **Templates** tab, or in **AI settings → Shared templates**, admins can make any shared template the default of its own type.

Admins also have the **Recording** page. It lists every recording, who made it and whether its audio is still kept. Audio follows the **Keep audio after transcription** setting in **AI settings → Recordings and sign-in**. When audio is deleted, by that setting or with its recording or account, the page shows it as deleted, with the date. To listen to or download audio, an admin gives a reason and ticks a box; the opening and every download are written in the audit log. Other people never see this page, and audio never has a public address.

## 3. Phone apps

Clinical Scribe has two phone apps with every feature of the website, laid out for phones: an **Android app** and an **iPhone and iPad web app**. Both have five tabs: **Clinical Scribe**, **Voice Note**, **Templates**, **History** and **More**. Both connect with the **server link**, which is the address of your Clinical Scribe website (for example `https://<your-name>.github.io/General-Tools/`). Everyone finds the link, a QR code and these steps on the **Phone apps** page: in the side menu of the website, and under **More** in the apps. On a phone, the website's sign-in page also offers the app.

### iPhone and iPad

1. Open the website in Safari and tap **Get the iPhone app**, or open the website address with `app/` added at the end.
2. Tap **⋯**, then **Share**, then **Add to Home Screen**. Keep **Open as Web App** switched on and tap **Add**.
3. Open Clinical Scribe from the Home Screen. It finds your clinic by itself: tap **Connect**, then sign in.

An iPhone does not let web apps use the microphone while the phone is locked or another app is open. To record with a dark screen, tap **Screen off** while recording: the screen turns black, taps do nothing, and the recording carries on. Press and hold the screen to come back. If you allow motion when asked, laying the phone face down does the same. If the phone locks anyway, the recording pauses and keeps everything; tap **Resume** when you are back. Safari asks for the microphone again in each session. The web app updates itself.

### Android

1. Build the app once (see [Build the Android app](#build-the-android-app) below). The next deploy publishes it with the website.
2. On the phone, open the website and tap **Get the Android app**, then **Download**. The **Phone apps** page has the same download.
3. Open the downloaded file and tap **Install**. If the phone asks, allow installs from the browser.
4. Open Clinical Scribe, enter the server link (or tap **Open the app** on the website, which fills it in), tap **Connect** and sign in.

The Android app keeps recording when the screen is off, another app is open, or the app is swiped away. A notification shows the time with **Pause** and **Resume**; it never shows the recording label. The app vibrates briefly when you start, pause or finish a recording; switch off **Vibration** in **More** to stop all its vibrations. When a newer app is published, the app says so and offers the download.

The app is installed from your website, not from Google Play. From 30 September 2026, phones in Brazil, Indonesia, Singapore and Thailand install such apps only from developers verified by Google, and more countries follow in 2027. If your clinic is in one of these countries, register as an Android developer with Google before you share the app.

### Calls and other sound

A recording never ends by itself, in the apps or on the website. A phone call, music or video from another app, an alarm, or a microphone that stops makes the recording pause. Everything recorded so far is kept, the recorder says why it paused, and **Resume** carries on when you are ready. During a call, Resume waits until the call has ended. Only **Finish** and **Discard** end a recording.

### Build the Android app

The workflow **Build Clinical Scribe Android app** builds the app, runs its checks and signs it. Run it from the **Actions** tab with **Run workflow**; it saves the app into the `Release` folder. Then run **Deploy Clinical Scribe** to publish it with the website.

A phone installs an update only when it is signed with the same key as the app it already has. Set up the key once:

1. Make a long random password, at least 16 characters (a password manager can make one). Add it as the repository secret `ANDROID_SIGNING_PASSWORD`.
2. Run **Build Clinical Scribe Android app**.
3. The run makes a new key. On the run page, under **Artifacts**, download **android-signing-key** (it is kept for one day). Open the file inside, copy all of its text and save it as the repository secret `ANDROID_SIGNING_KEY`. Then delete the downloaded file.
4. Later builds use this key, so phones accept every update. Keep both secrets: without them, phones must remove the app before they can install a new build.

The key text is encrypted with your password, so it is useless on its own. Without any secrets the workflow still builds a working app, signed with a one-time key; phones must remove that app before installing a later build. `Release/README.txt` says which version is in the `Release` folder and how it was signed.

### Clinic name

On the **Phone apps** page, admins set the name the apps show when they connect, for example "St Mary's Clinic". Changes are written in the audit log.

## 4. Upgrade to a newer version

1. Bring the new version into this repository's `main` branch (for example, merge the pull request or sync your copy).
2. Run **Deploy Clinical Scribe** again, exactly as in step 5 above.

Every step is safe to repeat, and an upgrade keeps all your data:

- Only database changes that are new are applied. Records, people, settings, templates, audio and the audit log are never reset. Sign-in settings you changed, such as Google sign-in, are kept too.
- Before it changes anything, the deploy checks that no database change would remove stored records. If one would, it stops at once.
- The deploy counts the records before and after the update: people, recordings, notes, templates, minutes history and the audit log. The run log shows "All records are still there" when nothing is missing. If records are missing, the run stops with a clear message. Then restore the latest backup in Supabase (**Database → Backups**; paid plans keep daily backups) before anyone uses the app.

The version number is shown at the bottom of the side menu, each upgrade is written in the audit log (filter **Updates**), and admins see a notice if the app and the server ever run different versions.

The same upgrade can be run from a computer with `node build/deploy/deploy.mjs` (see [section 6](#6-deploy-from-your-own-computer)).

## 5. Host the web app somewhere else

GitHub Pages is the simplest choice, but any static web host works, for example Vercel, Netlify or Cloudflare Pages. These hosts give the app its own address and can send extra security headers, which GitHub Pages cannot; the files `web/vercel.json` and `web/public/_headers` already contain them.

1. Create a site on the host from this repository with these settings:
   - Root (base) directory: `Clinical Scribe/web`
   - Build command: `npm run build`
   - Output directory: `dist`
   - Environment variables: `VITE_SUPABASE_URL` = `https://<code>.supabase.co` and `VITE_SUPABASE_PUBLISHABLE_KEY` = the publishable key from **Project Settings → API Keys** in Supabase. Both values are public by design; the server protects all data.
2. Run **Deploy Clinical Scribe** and type the site's address (for example `https://scribe.example.org/`) in the address box. This sets up the server and tells Supabase where people return to after signing in. It skips GitHub Pages and keeps the built app as a download on the run page instead.

To include the iPhone web app, use the build command `npm run build:all`. A site built by the host has no connect file, so in the phone apps people use the Supabase project address (`https://<code>.supabase.co`) as the server link; the **Phone apps** page then shows that address. A site made with the deploy (the run's download, or `node build/deploy/deploy.mjs web`) has the connect file and the Android download, so its own address works as the server link.

## 6. Deploy from your own computer

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
| `node build/deploy/deploy.mjs check` | Checks the values, the project, the tools and the database changes. Changes nothing. |
| `node build/deploy/deploy.mjs` | Builds the web app into `web/dist` (with the iPhone web app in `web/dist/app`), then sets up or upgrades the server. |
| `node build/deploy/deploy.mjs server` | The server only: database, server functions and settings. |
| `node build/deploy/deploy.mjs web` | The web app only, built into `web/dist`. |
| `node build/android/build-apk.mjs` | Builds, checks and signs the Android app into `Release/clinical-scribe.apk`. Needs JDK 21 and the Android SDK; the signing secrets above can be set the same way. |

Put the contents of `web/dist` on any static web host. The files use relative paths, so the app works in a sub-folder too.

## 7. Privacy and security

- **AI keys** are kept encrypted in Supabase Vault. Only the server functions can read them. Admins see only the last four characters, and keys never reach the browser.
- **Accounts**: public sign-up is switched off. Only admins add people. An account that appears any other way has no access until an admin approves it.
- **Records**: each person sees only their own recordings and voice notes; both are protected, kept and reviewed in the same way. Admins can open someone else's records only through **Review records**, which needs a reason and a confirmation. Every list viewed, record opened and item copied is written to the audit log with the admin's name and reason. The audit log cannot be changed or deleted, even by admins.
- **Audio** is kept in a private storage area and never has a public address. Admins choose how long it is kept (**AI settings → Recordings and sign-in**). Only admins can listen to or download it, on the **Recording** page, after giving a reason; each opening and download is written in the audit log. Gemini copies are deleted from Google as soon as the transcript is read. With **Ask ElevenLabs not to keep recordings** on, ElevenLabs keeps no copy; ElevenLabs allows this only for Enterprise accounts, so the switch checks with ElevenLabs before it turns on.
- **Minutes**: before a part of a recording is transcribed, the server measures how much sound the audio file really holds and charges that length. Paused time is not counted, and the length the app reports cannot lower the charge. A recording that needs more minutes than are left, or is longer than the longest recording allowed, is not sent to the AI service, and its minutes are given back. Only admins can add minutes.
- **Before recording real patients**: use paid plans for Supabase and the AI services, and sign the agreements your organisation needs (for example a data processing agreement or a business associate agreement). Choose a Supabase region that matches your data rules.
- **Give the app its own web address for real use.** All GitHub Pages sites of one GitHub account share the same address (`<your-name>.github.io`), so pages from your other repositories could read what the app keeps in the browser. Use a custom domain for GitHub Pages (**Settings → Pages → Custom domain**, then run the deploy again), or another host (section 5).
- **Phone apps** hold no server details or keys until you connect. They accept only https server links, show the clinic before connecting, and refuse a server that would hand out a secret key. The Android app keeps its sign-in encrypted with a key held in the phone's secure hardware, leaves nothing in phone backups, blocks screenshots, and hides its screens in the recent apps list. Its recording notification never shows the label.
- Notes are written by AI from the transcript. **Always check a note before you use it.** Clinical Scribe supports documentation; it does not replace clinical judgement.

The full security design is in `project.md` (section 7).

## 8. Problems and fixes

| What you see | What to do |
| --- | --- |
| "Get Pages site failed" in the run | Set **Settings → Pages → Source** to **GitHub Actions**, then run again. |
| "Branch … is not allowed to deploy to github-pages" | Run the workflow from `main`, or allow the branch under **Settings → Environments → github-pages**. |
| "Supabase did not accept the access token" | Create a new token (step 2) and update `SUPABASE_ACCESS_TOKEN`. |
| "Updating the database did not finish" | Check `SUPABASE_DB_PASSWORD`. You can reset it under **Project Settings → Database** in Supabase. |
| "The Supabase project is paused" | Free projects pause after a week without use. Restore it from the Supabase dashboard, then run again. |
| "The update was stopped before anything changed: … would remove stored records" | Nothing was changed. Do not edit the file yourself; report the problem so the database change can be fixed. |
| "Some records are missing after the database update" | Do not use the app. Restore the latest backup in Supabase (**Database → Backups**), then report the problem. |
| A model test says "This model is not available to your account" | Press **Update model lists**, choose a model marked *recommended*, then save. |
| The app says it is not connected | The web app was built without the project details. Run the deploy again, or check the two `VITE_` values on your web host. |
| Recordings stay at "Transcribing" | Check the key in **AI settings** with **Check key**. In Supabase, **Edge Functions → worker → Logs** shows what the worker is doing. |
| The phone app says "No Clinical Scribe server was found at that link" | Use the server link shown on the **Phone apps** page, or the Supabase project address `https://<code>.supabase.co`. |
| The phone app says the server "needs an update" | Run **Deploy Clinical Scribe** to bring the server up to date. |
| A template is missing when you start a recording | Each tab offers only the templates of its own type. Check the type on the template's card in **Templates**. To use it for the other tab, make a new template with that **Template Type**. |
| "The Template Type cannot be changed" | A template keeps the type it was made with. Make a new template and choose the other **Template Type**. |
| "A Voice Note is being recorded" on the Clinical Scribe tab (or the other way round) | Only one recording runs at a time. Tap **Go to the recording**, then finish or discard it before you start another one. |
| Android says "App not installed" when updating | The new copy was signed with another key. Remove the old app first, then install. Set up the signing key ([Build the Android app](#build-the-android-app)) so this does not happen again. |
| The recording paused by itself | A call, sound from another app or a microphone problem paused it, and the recorder says which. Tap **Resume** when you are ready; nothing recorded is lost. |
| The iPhone recording paused when the screen locked | iPhone pauses a web app's recording when the phone locks or another app opens. Use **Screen off** to record with a dark screen. If the phone still locks, turn off Low Power Mode and set **Auto-Lock** to **Never** in Settings. |
| The Android recording stops after the screen has been off for a while | Some phones close apps to save battery. In the phone's **Settings → Apps → Clinical Scribe → Battery**, choose **Unrestricted** (the words differ a little between phone makers). |
| A recording stopped with "This ElevenLabs account cannot use zero retention" | ElevenLabs allows zero retention only for Enterprise accounts. In **AI settings → Transcription**, switch off **Ask ElevenLabs not to keep recordings** and save. Then open the recording in History and choose **Try again**. |
| A recording stopped with "There are not enough transcription minutes for the real length of this recording" | The audio was longer than the minutes left. An admin adds minutes in **User settings**; then choose **Try again** on the recording in History. |
| A recording stopped with "The length of this recording's audio could not be checked" | The audio file was damaged or in a format the server does not accept. Record again. If it keeps happening, report which phone and browser were used. |
| No admin is left | In the Supabase **SQL Editor**, run `update public.profiles set role = 'admin', status = 'active' where email = 'you@example.org';` with your own email address. |

## 9. For maintainers

### Folder layout

```
Clinical Scribe/
├── README.md        this guide
├── project.md       plan: features, architecture, data model, security, testing
├── design.md        look and wording rules
├── VERSION          app version, shown in the app and recorded on the server
├── appdesign.md     design of the phone apps
├── appproject.md    plan of the phone apps: languages, connection, security, build
├── build/
│   ├── deploy/      the deploy and upgrade script (used by the workflow and by hand)
│   ├── android/     builds, checks and signs the Android app
│   ├── record-migrations.mjs   records released migrations (see Releasing)
│   └── make-icons.mjs          draws the icons and iPhone launch images
├── Release/         the Android app (clinical-scribe.apk); see Release/README.txt
├── android/         the Android app project (Capacitor, with a small Java part)
├── supabase/        config.toml, migrations, Edge Functions (worker, templates-ai, admin, connect)
├── web/             the web app and the phone app pages (Vite, plain JavaScript modules)
└── tests/           unit, server, deploy and browser tests, with stand-in AI services
```

### Tests

`tests/run-local.sh` runs every test against a local Supabase stack with stand-in AI services, so no real keys are needed. It needs Docker, the Supabase command-line tool, Node.js 20.19 or newer, `psql`, and Deno 2 for the server function checks. It resets the local database, so never point it at a project with real data.

```bash
tests/run-local.sh          # everything
tests/run-local.sh unit     # unit tests and server function checks, no Docker needed
tests/run-local.sh api      # server tests
tests/run-local.sh deploy   # the deploy script and a real upgrade from 1.0.0, against the local stack
tests/run-local.sh e2e      # browser tests at desktop and phone sizes, and the phone apps
tests/run-local.sh android  # the Android app's own tests and checks (needs JDK 21 and the Android SDK)
```

The workflow **Test Clinical Scribe** runs the same tests on GitHub whenever this folder changes, and **Build Clinical Scribe Android app** builds and checks the Android app whenever the web app or the Android project changes.

### Releasing a new version

1. Make the change. Database changes always go in a **new** migration file in `supabase/migrations/` with a later date in its name; never edit a migration that has been deployed. A change that would drop or empty a table, delete rows or drop a column is refused by the tests and by the deploy. Only after a careful review, with a plan to keep the data, may such a file be marked `-- cs:data-change-reviewed`.
2. Raise the number in `VERSION` (`major.minor.patch`) and add a short entry under **Changes** below.
3. Run `node build/record-migrations.mjs`. It records each migration's fingerprint, so the tests can spot a later edit to a released one.
4. Run the tests and merge to `main`. Run **Build Clinical Scribe Android app** (with **Save** on), then **Deploy Clinical Scribe**.
5. Tag the release as `cscribe-v<version>`, for example `cscribe-v1.1.0`.

## Changes

### 1.5.0

- New **Voice Note** tab for one person dictating, next to **Clinical Scribe** for conversations between two or more people. It records and processes the same way, and the AI is told it is a dictation, not a conversation.
- Templates have a **Template Type**, Clinical Scribe or Voice Note, chosen when the template is made. Each type has its own default: SOAP note and the new Dictated note.
- History has two tabs, Clinical Scribe and Voice Note, each with its own search and pages.
- The admin pages show the type: **Recording** (with a type filter), **Review records**, shared templates and the audit log.
- The phone apps have five tabs; long names take two lines on small phones instead of being cut off.
- The phone apps need a server on version 1.5.0 or newer.

### 1.4.0

- Templates: people can delete their own templates, even ones that already wrote notes. Admins choose **Everyone in the clinic** or **Only me** for a new template, look after shared templates on the Templates tab, and can share their own later.
- **Phone apps** is now for everyone: in the side menu of the website and under **More** in the apps. The clinic name stays with the admins.
- History shows 10 recordings a page with **Previous** and **Next**, and the search finds labels, transcripts and notes. The notes of a recording open and close; the newest is open, and the order can change.
- Minutes are charged for the real length of the audio, measured by the server from the file before it is transcribed. A recording that needs more minutes than an admin gave is not transcribed, and its minutes are given back.
- ElevenLabs allows zero retention only for Enterprise accounts. The switch now checks with ElevenLabs before it turns on, and a refusal is explained in plain words.
- Android: a **Vibration** switch in **More**.
- The phone apps need a server on version 1.4.0 or newer.

### 1.3.0

- A recording never ends by itself any more: a phone call, sound from another app, a locked iPhone or a microphone that stops pauses it, and the recorder says why. **Resume** carries on.
- Android: the app now records by itself, so recording carries on with the screen off, in other apps and after the app is swiped away. The time limit is kept with the screen off too.
- iPhone: the new **Screen off** button keeps recording with a black, touch-locked screen. Laying the phone face down does the same once motion is allowed.
- Sound played in Clinical Scribe pauses the recording, so it is not recorded.
- Signing out now also ends a recording on that device.

### 1.2.0

- New **phone apps**: an Android app and an iPhone and iPad web app with every feature of the website, laid out for phones in the style of each phone.
- The apps ask for the server link once and show the clinic before connecting. The new admin page **Phone apps** has the link, a QR code, the install steps and the clinic name.
- Android: recording carries on with the screen off, with Pause and Resume in the notification. Sign-in is kept encrypted on the phone, and screenshots are blocked.
- On a phone, the website's sign-in page offers the phone app.
- The deploy publishes the iPhone web app, the connect file and the Android download. The new workflow **Build Clinical Scribe Android app** builds, checks and signs the Android app.

### 1.1.0

- New admin page **Recording**: every recording with the state of its audio. Audio follows the **Keep audio** setting and shows as deleted once it is removed. Listening and downloading need a reason and are written in the audit log.
- **AI models**: **Update model lists** loads the models each service offers now, and **Test chosen models** checks the chosen models with a tiny request. The lists start with the current models known to work well: Gemini 3.5 Transcribe and Gemini 3.8 Flash, ElevenLabs Scribe v2 Medical, and DeepSeek Flash.
- Upgrades keep every record: the deploy refuses database changes that remove data, and counts the records before and after each update.
- Fixes: ElevenLabs zero retention is now sent the way ElevenLabs expects; Gemini transcripts include word timings for better speaker labels; Gemini answers that stop early are handled.
- The deploy and test workflows use newer GitHub actions, so the run log no longer warns about an old Node.js version.

### 1.0.0

- First release.
- Recording in parts with pause, resume and finish, crash recovery on the device, and processing that carries on after the browser is closed.
- Transcription with ElevenLabs or Gemini; notes with Gemini or DeepSeek; templates made with AI help.
- History with copyable transcripts and final notes, and more notes from old transcripts.
- Admin settings: people, transcription minutes, AI keys and models, logged record reviews, audit log, Google sign-in and email settings.
- One-click deploy and upgrade with GitHub Actions, or from a computer.
