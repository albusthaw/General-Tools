# Clinical Scribe: project plan

This file is the working plan for the Clinical Scribe tool. It explains what the tool does, how the parts fit together, how data is protected, and how it is deployed and upgraded. The look and wording rules are in `design.md`.

## 1. Purpose

Clinical Scribe records a consultation, turns the speech into a transcript, and writes a clinical note from that transcript in the format the clinician chooses. It runs on the owner's own Supabase project, so the owner keeps control of the data, the AI keys and the user accounts.

There are two roles:

| Role | Can do |
| --- | --- |
| User | Record and process consultations, create personal note templates with AI help, read and copy their own history. |
| Admin | Everything a user can do, plus manage people, credits, AI keys and models, shared templates, Google sign-in and email settings. Admins can open other people's records only through a logged review with a stated reason, and can read the audit log. |

## 2. Feature list (mapped to the request)

### 2.1 Sign-in
- The app opens on a sign-in page (email and password).
- "Continue with Google" appears only when an admin has switched Google sign-in on.
- Only people added by an admin can sign in. Public sign-up is switched off on the Supabase project, and any account that appears without an invitation is held as "waiting for approval".
- After sign-in, a user sees the Clinical Scribe module. An admin also sees the Admin settings section in the side menu.

### 2.2 Clinical Scribe module (tabs: Scribe, Templates, History)

**Scribe**
1. Choose a note template (SOAP note is the default) and an optional label for the visit.
2. Press Record. While recording: Pause/Resume, Finish, and Discard. A timer, a live sound level meter and the remaining credit are shown.
3. Audio is recorded in parts of up to 10 minutes. Each finished part is uploaded straight away, so a long consultation is mostly on the server before Finish is pressed.
4. On Finish, the last part is uploaded and the recording is handed to the server. From this point the server does all the work. The person can close the browser; the result appears in History.
5. The screen shows clear steps: Saving audio, Transcribing, Writing note, Ready. When the note is ready it appears with a Copy button, and the transcript is available with its own Copy button.
6. The person can pick another template and write another note from the same transcript.

**Templates**
- Shared templates (made by admins, available to everyone). One of them is the default. SOAP note is installed as the first default.
- Personal templates. To make one, the person describes the note they want (for example "medical clerking note: presenting complaint, HOPI, past history, drugs, allergies, social, family, examination, impression, plan"). The template AI turns this into a detailed template. The person reviews it, can ask for changes, can make small edits, names it and saves it.
- The saved template text is sent with the transcript when a note is written, so the note follows that format.

**History**
- A list of the person's own recordings with date, label, length, status and number of notes.
- Opening one shows:
  1. The raw transcript (read-only, copyable), with "Write another note" to use any template later.
  2. Every note written from it, newest first. Notes are final: they cannot be edited, only copied.
- Unfinished recordings (for example, the browser closed during recording) are shown with "Process the saved audio" and "Delete".

### 2.3 Admin settings (side menu category)
1. **User settings**: add people (name, email, starting password, role, starting credit), change password, change role, suspend or restore, remove, approve waiting accounts, assign transcription credit.
2. **AI settings**: save, replace, check and remove the keys for ElevenLabs, Gemini and DeepSeek; update the model lists from each service and test the chosen models; choose the transcription service (ElevenLabs or Gemini) and model; choose the note service (Gemini by default, or DeepSeek) and model; choose the single template service (Gemini or DeepSeek) and model; recording settings (audio retention, longest recording); manage shared templates.
3. **Recording** (admins only): every recording with its clinician, length, status and the state of its audio (kept until a date, deleted by the retention setting, deleted with the recording or with the account), filtered by person and by audio state. Deleted recordings stay listed as deleted. Listening or downloading needs a warning, a reason and a confirmation tick; the opening and every download are written to the audit log.
4. **Review records** (other people's history): a warning screen, a required reason and a confirmation tick before anything is shown. Every list view, record opened and copy action is written to the audit log with the admin's name, the person whose record it is, the record, the reason and the time.
5. **Audit log**: a read-only, filterable list of every admin action and every record review, with CSV export.
6. **Google sign-in**: step-by-step guidance, the redirect address to copy into Google Cloud, Client ID and Client secret fields, an on/off switch. Saving applies the settings to the Supabase project's sign-in service.
7. **Email (SMTP)**: a working settings form (server, port, security, user name, password, sender) that saves securely. It is deliberately not used by anything yet; the page says so.
8. **Phone apps** (from 1.2.0): the server link with a QR code, the Android download, the iPhone install steps and the clinic name the apps show (audited). The phone apps themselves are planned in `appproject.md` and designed in `appdesign.md`.

### 2.4 Credit
- Credit is counted in minutes of audio, kept separately for ElevenLabs and for Gemini, because the two services are paid separately.
- The active transcription service decides which balance is used.
- Admins can add minutes, set an exact balance, or mark a person as unlimited. Every change and every use is written to a credit ledger.
- The recorder shows the minutes left and stops by itself when the balance runs out (with a warning two minutes before).
- If transcription finally fails, the minutes are given back. After transcription, if the service reports a longer audio length than the browser did, the difference is charged, so the balance cannot be gamed.

## 3. Architecture

```
 Browser (static web app)                     Supabase project
 ┌──────────────────────────┐   HTTPS   ┌───────────────────────────────────────────┐
 │ Sign-in, Scribe, History │──────────▶│ Auth (email + Google, sign-up off)         │
 │ Templates, Admin pages   │           │ Postgres + Row Level Security              │
 │ Recorder + upload queue  │──upload──▶│ Storage: private "recordings" bucket       │
 │ (IndexedDB crash safety) │           │ RPC functions (validated, audited)         │
 └──────────────────────────┘           │ Vault: AI keys, worker secret, tokens      │
                                        │ pg_cron + pg_net: wake the worker          │
                                        │ Edge Functions:                            │
                                        │   worker        (jobs: transcribe, notes)  │
                                        │   templates-ai  (template builder)         │
                                        │   admin         (people, keys, sign-in)    │
                                        └──────────────┬────────────────────────────┘
                                                       │ HTTPS (keys never leave the server)
                                        ┌──────────────▼────────────────────────────┐
                                        │ ElevenLabs Speech to Text (Scribe v2)      │
                                        │ Gemini (Interactions API, Files API)       │
                                        │ DeepSeek (chat completions)                │
                                        └───────────────────────────────────────────┘
```

### 3.1 Why the web app is hosted outside Supabase
Supabase does not serve web pages from its default address: Edge Functions rewrite `text/html` responses to `text/plain` unless a custom domain is used. The web app is therefore a static site. The deploy workflow publishes it to GitHub Pages (free for this public repository). Any static host works; the README explains Vercel, Netlify and Cloudflare Pages, and `web/vercel.json` and `web/public/_headers` add security headers on hosts that support them. The web app holds only the project address and the publishable key, which are public by design; all protection is on the server.

### 3.2 Parts and responsibilities

| Part | Job |
| --- | --- |
| Web app (`web/`) | Interface only. Vanilla JavaScript modules built with Vite. No secret ever reaches it. |
| Database (`supabase/migrations/`) | Tables, Row Level Security, validated RPC functions, credit ledger, job queue, audit log, Vault access, cron schedule. |
| Storage | Private bucket for audio parts, one folder per person. Uploads are allowed only into the person's own folder and only while their recording is open. |
| Edge Function `worker` | Runs queued jobs: transcribe a part, join parts, write a note, clean up old audio. Woken by the database, never by browsers. |
| Edge Function `templates-ai` | Drafts and revises templates with the chosen template AI. |
| Edge Function `admin` | Admin actions that need server keys: create, suspend and remove accounts, change passwords, save and check AI keys, update and test model lists, open recording audio after a logged reason and stream it to the admin, apply Google sign-in settings, save the email stub. |

## 4. Recording and processing pipeline

### 4.1 In the browser
1. `start_scribe` (RPC) creates the record with status `recording` and returns the upload folder, the part length, the longest allowed recording and the credit left.
2. `MediaRecorder` records Opus in WebM (Chrome, Edge, Firefox, Android) or AAC in MP4 (Safari, iPhone) at 32 kbit/s, which is clear for speech and small (about 14 MB per hour).
3. Every 5 seconds the newest audio chunk is written to IndexedDB, so a crash or closed tab loses at most a few seconds.
4. Every 10 minutes the recorder starts a fresh part (a new, self-contained file) and the finished part is uploaded to `recordings/<user>/<scribe>/<part>.webm`, then registered with `register_segment` (RPC), which checks that the file really exists in Storage and belongs to the caller.
5. Pause and Resume use `MediaRecorder.pause()`/`resume()`. A call, other sound, a muted or stopped microphone, sound played by the app and, on iPhone, a locked screen also pause the recording and never end it: the recorder says why, and Resume carries on in a new part, opening the microphone again when needed. The screen is kept awake with the Wake Lock API while recording. The Android app records with its own recorder instead (`appproject.md`, section 5.1).
6. Finish uploads the last part and calls `finish_scribe` (RPC). Failed uploads are retried with back-off and kept in IndexedDB until they succeed, even across a reload. If the tab closes before the last upload finishes, the app finishes the job the next time it is opened.

### 4.2 On the server
`finish_scribe` checks the parts, works out the length (capped by the real time between start and finish), checks and charges credit, takes a snapshot of the current AI choices, and queues one `transcribe_segment` job per part. Inserting jobs wakes the worker through `pg_net`. A `pg_cron` job every 30 seconds also wakes the worker when work is due, so nothing depends on the browser.

The worker:
1. Answers the wake-up call at once (202) and keeps working in the background (`EdgeRuntime.waitUntil`).
2. Claims jobs with `FOR UPDATE SKIP LOCKED` and a lease. Up to three jobs run at once. A job that is not finished when its lease ends (for example, the function was stopped by the platform time limit) is picked up again.
3. Saves each job's progress in the job row (`state`), so a job continues from where it stopped instead of starting again.
4. Retries temporary problems (rate limits, timeouts, service errors) with growing delays; after five failures the record is marked as failed with a plain-language message and a Try again button, and the credit is returned.

**Why this gives "unlimited time"**: no single function call has to process a whole consultation. Each part is at most 10 minutes of audio. Gemini work runs in Gemini's background mode (`background: true`) and is polled, so even a slow answer never hits the Supabase time limit (150 seconds on the free plan, 400 seconds on paid plans). ElevenLabs transcribes a 10-minute part in seconds. A two-hour recording is simply twelve independent jobs.

### 4.3 Job types

| Job | What it does |
| --- | --- |
| `transcribe_segment` | ElevenLabs: send the audio part (multipart upload) to `POST /v1/speech-to-text` with diarisation; build "Speaker 1: …" lines from word speaker labels; store `audio_duration_secs`. Gemini: upload the part to the Files API, create a background interaction, poll until complete, read the text and speaker annotations, then delete the interaction and the file from Google. |
| `finalize_transcript` | Runs when the last part is done. Joins parts in order, saves the transcript, corrects the credit charge if the services measured more audio, and queues the first note with the template chosen before recording. |
| `generate_note` | Sends the template text and transcript to the note AI. Gemini runs as a background interaction; DeepSeek streams. Saves the note as final text. |
| `cleanup` | Hourly: deletes audio past the retention period through the Storage API, removes old finished jobs, closes expired record reviews. |

### 4.4 Status values
- Record: `recording` → `processing` → `transcribed`, or `failed`.
- Part: `uploaded` → `transcribing` → `done`, or `failed`.
- Note: `queued` → `writing` → `done`, or `failed`.

## 5. AI services and models

The admin picks models from saved lists, or types a model name. **Update model lists** fetches each service's current list (Gemini `GET /v1beta/models`, DeepSeek `GET /models`; ElevenLabs has no list of speech-to-text models, so its list is built in) and saves it in `app_private.model_catalog`. Known good models come first and are marked *recommended*; known models the key is not offered are marked too. Gemini transcription lists only `*-transcribe` models and never the `-live` ones, which stream live audio and cannot take a recorded file; writing lists leave out speech, image, live, embedding and transcription models. **Test chosen models** sends each chosen model a tiny request: one second of silent WAV audio for Gemini transcription (inline `data`), a key check for ElevenLabs, and a one-word prompt for notes and templates. Defaults (October 2026):

| Use | Service | Default model | Notes |
| --- | --- | --- | --- |
| Transcription | ElevenLabs | `scribe_v2_medical` | Batch model tuned for clinical audio; `scribe_v2` is the general model. `scribe_v1` is deprecated. |
| Transcription | Gemini | `gemini-3.5-transcribe` | Dedicated speech-to-text model with speaker labels (up to 30 minutes per request with speaker labels, which fits the 10-minute parts). General models such as `gemini-3.8-flash` also work through a transcription prompt. |
| Notes (default) | Gemini | `gemini-3.8-flash` | Through the Interactions API with `thinking_level: low`. |
| Notes | DeepSeek | `deepseek-flash` | OpenAI-format chat completions; thinking off by default for speed, switchable. `deepseek-v4-pro` is the stronger model. |
| Templates (one service) | Gemini or DeepSeek | `gemini-3.8-flash` / `deepseek-flash` | JSON output: name, description, body. |

API facts the code relies on:
- ElevenLabs: `POST https://api.elevenlabs.io/v1/speech-to-text`, header `xi-api-key`, multipart fields `model_id`, `file`, `diarize`, `timestamps_granularity`, optional `language_code`. Zero retention is the query parameter `?enable_logging=false`, not a form field. Response has `text`, `words[]` (`text`, `type`, `speaker_id`, `start`, `end`) and `audio_duration_secs`.
- Gemini: header `x-goog-api-key`. Files: `POST /upload/v1beta/files` with the resumable protocol, then `GET/DELETE /v1beta/files/{id}`. Interactions: `POST /v1beta/interactions` (`model`, `input`, `system_instruction`, `generation_config`, `response_format`, `background`, `store`), `GET` and `DELETE /v1beta/interactions/{id}`. Audio input is `{type: "audio", mime_type, uri}` for an uploaded file or `{type: "audio", mime_type, data}` for small inline audio. Status values: `in_progress`, `queued`, `completed`, `failed`, `cancelled`, `requires_action` (tools only, so treated as failed), and `incomplete` or `budget_exceeded` (used only when they carry text). Text is in `output_text` or in `steps[].content[]`. Audio counts as 32 tokens per second. The transcription model takes `generation_config.transcription_config` with `mode: {type: "verbatim", diarization_mode: "speaker", timestamp_granularities: ["word"]}`.
- DeepSeek: `POST https://api.deepseek.com/chat/completions`, bearer key, `thinking: {type: "enabled" | "disabled"}`, `stream: true`, `response_format: {type: "json_object"}`; `GET /models` for the list.

Privacy notes shown to admins: use paid plans (free plans may keep or use data); ElevenLabs "zero retention" (`?enable_logging=false`) is offered as an option for plans that allow it; Gemini interactions and files are deleted as soon as the result is read.

### 5.1 Prompts and prompt-injection defence
- System instructions fix the rules: use only what is in the transcript, never invent findings, write "Not discussed" for missing sections, follow the template headings exactly, plain text output, British English.
- Transcript, template and template requests are placed inside clearly marked blocks, and the instructions say that text inside them is data, not instructions. Marker look-alikes inside user text are neutralised before sending.
- AI output is only ever shown as text (never as HTML) and is stored as final text.

## 6. Data model (main tables, all in `public` with RLS on)

| Table | Key columns | Who can read |
| --- | --- | --- |
| `profiles` | id (auth user), email, full_name, role (`user`/`admin`), status (`active`/`suspended`/`pending`), credit_seconds_elevenlabs, credit_seconds_gemini, credit_unlimited | Self; admins (all) |
| `app_settings` | single row: AI choices and models, reasoning options, retention, longest recording, Google on/off, email stub fields | Admins through RPC; public part through `get_public_config()` |
| `templates` | scope (`shared`/`personal`), owner_id, name, description, body, source_request, is_default, is_archived | Shared: everyone signed in; personal: owner |
| `scribes` | owner_id, title, status, template_id, provider/model snapshot, duration, transcript, error, timestamps | Owner only (admins only through review RPCs) |
| `scribe_segments` | scribe_id, seq, storage_path, mime_type, bytes, duration, status, transcript, provider_duration | Owner only |
| `notes` | scribe_id, owner_id, template snapshot (name and body), provider/model, status, content, error | Owner only; no update or delete by users |
| `credit_ledger` | user_id, provider, change_seconds, balance_after, kind, scribe_id, actor_id, note | Self; admins |
| `jobs` | kind, scribe_id, segment_id, note_id, status, state, attempts, run_after, locked_until, last_error | Server only |
| `audit_log` | time, actor, action, target user, scribe, reason, details, user agent | Admins; append-only for everyone |
| `review_sessions` | admin, target user, reason, started, expires, ended | Server only (through RPC) |
| `ai_usage` | user, kind, provider, model, tokens, time | Admins; used for rate limits |

Private schema `app_private` (not exposed by the API): runtime settings (worker address), secret metadata (last four characters, who changed it, when), helper functions, the saved model lists (`model_catalog`), admins' 15-minute audio access grants (`recording_access`), and a short record of each deleted recording (`deleted_recordings`: owner, name, date, length, why it was deleted), so the Recording page can show it as deleted. Triggers fill `deleted_recordings` when a recording or an account is deleted; it holds no transcript, note or audio.

## 7. Security model

| Risk | Defence |
| --- | --- |
| AI key leak | Keys are stored only in Supabase Vault (encrypted at rest). Only `service_role` can call the functions that read them. The browser never receives a key; admins see "saved, ending in 4f2a" only. Keys are never written to logs; provider error text is cleaned of anything that looks like a key before it is stored. |
| Reading other people's records | Row Level Security limits every table to its owner. Admins have no direct read access to other people's scribes; they must use review RPCs that write the audit entry first, in the same transaction, and require an open review with a reason. |
| Listening to other people's audio | Audio is in a private bucket with no public or signed addresses. Only the admin function serves it: `svc_recording_unlock` needs an active admin, a reason (10 to 500 characters) and a confirmation, writes the audit entry and grants access for 15 minutes. Each part is then streamed as `application/octet-stream` with `no-store`; downloads are logged too. Audio deleted by the retention setting can never be opened. The Recording page and its list function refuse anyone who is not an admin. |
| Audit tampering | `audit_log` has no update or delete grants and a trigger that rejects updates and deletes for every role. |
| Data loss on upgrade | Migrations only add. The unit tests and the deploy refuse top-level statements that drop or empty a table, delete rows or drop a column, and released migrations are fingerprinted so an edit is caught. The deploy counts records before and after `supabase db push` and stops with restore advice if any are missing. |
| SQL injection | All access goes through PostgREST parameters or SQL functions with typed parameters. No dynamic SQL is built from user input. Every function sets `search_path = ''` and uses fully qualified names. |
| Script injection (XSS) | The web app builds the page with `textContent` and DOM nodes only, never `innerHTML` with data. A Content Security Policy limits scripts, styles and connections to the app and the Supabase project. |
| Prompt injection | See section 5.1. Output is text only and cannot trigger any action. |
| Account creation by strangers | Sign-up is off; Google sign-in only works for emails already added; any account created without an admin invitation is held as `pending` and has no access. |
| Locking out the last admin | The server refuses to suspend, demote or remove the last active admin, and refuses self-removal. |
| Cost abuse | Credit checks for transcription; hourly limits for template drafts and notes per person; key checks and model lists are admin-only. |
| Worker abuse | The worker accepts calls only with a random secret generated inside the database and kept in Vault; compared in constant time. |
| Function access | `verify_jwt` is off (required for the new publishable/secret keys) and every function checks the caller itself: user token through the Auth server, active profile, and role for admin routes. |
| Storage abuse | Private bucket, 50 MB per file, audio types only, uploads only into the caller's own open recording folder, no client deletes. |
| Secrets in a public repository | The repository holds no project address, key or password. The deploy workflow reads GitHub secrets and masks every derived value; workflow logs are public, so nothing secret is echoed. |
| Shoulder-surfing and shared devices | Automatic sign-out after a period without activity (not while recording), and sign-out clears local drafts. |
| Other sites on the same web address | All GitHub Pages sites of one account share one origin, and so share browser storage. The README tells owners to give the app its own address (a custom domain or another host) before real use. |

Default privileges are changed in the first migration so new functions are not executable by `anon` or `authenticated` unless granted on purpose.

## 8. Folder layout (no "god files")

```
Clinical Scribe/
├── README.md              deploy and upgrade guide
├── project.md             this plan
├── design.md              look and wording rules
├── VERSION                app version (major.minor.patch)
├── appproject.md, appdesign.md   plan and design of the phone apps
├── build/
│   ├── deploy/            deploy and upgrade script, used by the workflow and by hand
│   ├── android/           builds, checks and signs the Android app
│   ├── record-migrations.mjs  records released migrations' fingerprints
│   └── make-icons.mjs     draws the icons and the iPhone launch images
├── Release/               the Android app (clinical-scribe.apk) and README.txt
├── android/               Android project (Capacitor) with the app's own Java code
├── supabase/
│   ├── config.toml        local development settings
│   ├── migrations/        one file per area, applied in order
│   ├── seed.sql           local development only
│   └── functions/
│       ├── _shared/       auth, http, validation, errors, vault, providers, prompts
│       ├── worker/        job runner, one module per job type
│       ├── templates-ai/  template drafting
│       ├── admin/         one handler module per admin area
│       └── connect/       public connection details for the phone apps
├── web/
│   ├── index.html, vite.config.js, package.json
│   └── src/
│       ├── main.js        start-up only
│       ├── lib/           supabase client, API wrappers, DOM helpers, router, recorder, uploads, storage, format,
│       │                  connection (server link) and platform (device, app links, app hooks)
│       ├── components/    buttons, dialogs, toasts, tabs, menus, copy blocks, chips, QR code
│       ├── views/         one module per screen (sign-in, scribe, templates, history, each admin page)
│       ├── app/           phone apps only: start-up, connect, app frame, tabs, sheets, gestures, Android bridge
│       └── styles/        tokens, base, layout, components, one file per screen group, app/ for the phone apps
└── tests/
    ├── unit/              web app rules and deploy helpers (Node test runner)
    ├── functions/         server function helpers (Deno)
    ├── api/               server tests against a local stack
    ├── deploy/            the deploy script against a local stack
    ├── e2e/               browser tests (desktop and phone widths)
    ├── mock-ai/           stand-in AI services and Management API
    └── run-local.sh       runs everything
```

Each module has one job. Screens talk to the server only through `lib/api/*.js`. Edge Function entry files only route; the work lives in handler modules.

## 9. Deployment ("one click") and upgrades

### 9.1 First deployment
1. Create a Supabase project.
2. In GitHub: add three repository secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`), optionally `CLINICAL_SCRIBE_ADMIN_EMAIL` and `CLINICAL_SCRIBE_ADMIN_PASSWORD`, and set Pages to "GitHub Actions".
3. Run the workflow **Deploy Clinical Scribe** (one click). It runs the unit tests, then `build/deploy/deploy.mjs`, which:
   - checks the token and the project (waits while a new project starts, stops at once for a paused one) and reads the API keys, hiding them in the log;
   - builds the web app with the project address and publishable key, and refuses to continue if any secret is found in the built files, so a failed build stops before the server is changed;
   - applies sign-in settings through the Management API before anything else on the server, so nobody can sign up on a new project during the deploy: sign-up off, email sign-in on, the password rule, the site address and the redirect list (addresses already listed and stricter rules are kept);
   - checks that no migration would remove stored records, and counts the records (people, recordings, notes, templates, audit log, minutes history);
   - links the project and applies database migrations (`supabase db push`);
   - deploys the three Edge Functions with JWT verification off, bundled on Supabase's side (no Docker needed);
   - saves the function settings (project reference and the one web address allowed to call the functions);
   - counts the records again and stops with restore advice if any are missing (a deleted record or two during the deploy is only a warning);
   - records the functions address for the worker and the version now running;
   - creates the first admin when the optional secrets are present and the project has no accounts yet;
   - writes a short report on the run page.
   The workflow then publishes the web app to GitHub Pages. With an app address given instead, it skips Pages and keeps the built app as a download.
4. Without the optional admin secrets: add a user in Supabase (Authentication → Users → Add user). The first account in the project becomes the admin automatically.

### 9.2 Upgrades
- Database changes are new, numbered migration files; `supabase db push` applies only the ones not yet applied, so data stays.
- Data guard: migrations that would drop or empty a table, delete rows or drop a column are refused by the tests and by the deploy; released migrations are fingerprinted in `tests/unit/released-migrations.json` (`node build/record-migrations.mjs` at each release); the deploy compares record counts before and after the update.
- To upgrade: bring the new code into the repository (pull or sync), then run the same workflow again. Every step is safe to repeat.
- `VERSION` is shown in the app. Each deploy records it on the server (`svc_set_server_version`), each change of version is written to the audit log, and admins see a notice when the app and the server versions differ.
- The same steps run by hand from a terminal with `node build/deploy/deploy.mjs` (parts: `check`, `server`, `web`).

## 10. Testing plan
`tests/run-local.sh` runs every group below; the workflow **Test Clinical Scribe** runs it on GitHub whenever the tool changes.
- **Unit tests** (Node test runner, `tests/unit`): formatting, CSV export escaping, recorder part timing, upload queue retry rules, audit wording, the deploy helpers (settings checks, key choice, sign-in settings merge, leak check, record count comparison), and the migration guard (no data-losing statements, released migrations unchanged, new ones sort last).
- **Server function checks** (Deno, `tests/functions`): type check and lint of every function, prompt assembly and marker neutralising, template answer parsing, note clean-up, transcript building from word labels, error sorting and retry rules, key hiding, model list rules and Gemini answer states.
- **Server tests** (`tests/api`, local Supabase stack with stand-in AI services): first admin, waiting accounts, keys never returned, recording and background processing with both transcription services, notes with both note services, template helper, finished notes final, retries and credit refund, privacy between people (tables and storage), audit log immutability, logged record review, the Recording list and audio access (refused before a reason, for users and for visitors; logged opening and download; retention and deleted states), ElevenLabs zero retention, model list update and test, credit, roles, suspension, removal, last-admin protection, Google sign-in settings, email stub, worker secret.
- **Deploy tests** (`tests/deploy`): the real deploy script against the local stack with a stand-in command-line tool and Management API: first deploy, a repeat deploy that keeps settings and records the upgrade, a deploy that loses records and stops, older keys, a failed step, a paused project, a wrong token, missing values, check mode, and that no secret is ever printed. A real upgrade from 1.0.0 with records checks that every record is kept and works with the new features.
- **End to end** (`tests/e2e`, Playwright): sign-in, recording with Chromium's fake microphone, pause and resume, parts, background processing with the page closed, crash recovery, note writing, history, another note, template builder, admin pages, model list update and test, record review logging, listening to and downloading recording audio with logging, audit log and CSV, Google sign-in, email settings, at phone and desktop widths, with no console errors and no sideways scrolling.
- **Security checks**: the deploy scans the built web app for keys and tokens before anything is published; the server tests try to read other people's data and to change the audit log with user tokens.

## 11. Known limits
- iPhones stop the microphone of a web page when the screen locks or the browser moves to the background. The recording then pauses and keeps everything; the iPhone web app's Screen off keeps recording with a dark screen (`appproject.md`, section 5.1). Audio already saved is never lost.
- Speaker labels from the transcription services are generic ("Speaker 1") and may switch numbering between 10-minute parts; the note AI is told to work out who is the clinician and who is the patient from the content.
- Very large organisations should raise the Supabase plan limits (storage, function time) and the AI service plan limits (ElevenLabs concurrency).
- The tool supports clinical documentation; it does not replace clinical judgement. Notes must be checked before use.

## 12. Build order
1. `project.md` (this file), then `design.md`.
2. Database migrations and database tests.
3. Shared function modules, then the worker, the template function and the admin function, with tests.
4. Web app: tokens and components, sign-in, shell, Scribe, History, Templates, admin pages.
5. Deploy script, workflow, README, root README row.
6. Local end-to-end run, fixes, screenshots, security review.
7. Commit and push.
