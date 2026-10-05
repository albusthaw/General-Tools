# General Tools

A growing collection of small, practical tools. Each tool lives in its own folder with its own README, source code and a `Release` folder for the built program. Shared working rules for the whole repository live in the `Global instruction` folder.

## Tools

| Tool | Folder | What it does |
| --- | --- | --- |
| YouTube Bulk Publisher | `YT Bulk Publish/` | Publish, rename and update many YouTube Studio videos in one go. |
| N8N Automation imports | `N8N Automation imports/` | Importable n8n workflows, starting with a clinical decision helper that reads clinical images and emails a report. |
| Clinical Scribe | `Clinical Scribe/` | Records consultations and dictated voice notes and writes clinical notes from a chosen template, on your own Supabase project. One-click deploy and upgrade, with an Android app and an iPhone web app. |

More tools will be added over time.

## YouTube Bulk Publisher

YouTube Studio lets you upload many videos at once, but it has no way to publish or rename them in bulk, and drafts have to be finished one by one. This Windows tool fills that gap. It works inside your own browser, using the same buttons a person would click, so no API keys or passwords are ever given to the tool.

What it does:

1. Shows a picture of every open browser window so you can click the one with YouTube Studio. If that window cannot be controlled, the tool opens its own browser window where you sign in once.
2. Reads the list of videos (channel content or a playlist) with their titles and status: Draft, Private, Unlisted, Public or Scheduled.
3. Lets you choose what to change in bulk: visibility (including publishing drafts), title, description, tags, audience and playlist.
4. Renames titles with your own rules: change a word or phrase, remove text, add text at the start or end, number the videos, change letter case, or use an advanced pattern. A live preview shows every old and new title before anything is saved.
5. Applies the changes one video at a time with a progress list, an activity log and a "practice run" mode that saves nothing.

The interface uses a white frosted-glass look and plain language throughout. The built program is placed in `YT Bulk Publish/Release/`.

See `YT Bulk Publish/README.md` for setup, building and known limits.

## Clinical Scribe

A web app for clinicians. It records a consultation (Clinical Scribe) or a clinician's own dictation (Voice Note), turns the speech into a transcript with ElevenLabs or Gemini, and writes a clinical note with Gemini or DeepSeek in the format the clinician chooses (SOAP note or Dictated note by default, or templates made with AI help). Processing carries on in the background even if the browser is closed. Admins manage people, transcription minutes, AI keys and models; every look at someone else's records or audio is logged with a reason.

It runs on your own Supabase project. The GitHub workflow "Deploy Clinical Scribe" sets up the database, server functions, sign-in settings, the first admin and the web app in one run, and the same run installs upgrades without losing any records. See `Clinical Scribe/README.md` for the step-by-step guide.

The phone apps have every feature of the website, laid out for phones: an Android app (built by the workflow "Build Clinical Scribe Android app" and published with the website) and an iPhone and iPad web app that is added to the Home Screen from Safari. Both connect with the clinic's server link.

## Repository layout

```
General-Tools/
├── CLAUDE.md                 short pointer to the Global instruction folder
├── Global instruction/       working rules: claude.md, agent.md, design.md, release.md, version control.md
├── .github/workflows/        builds, tests, the Clinical Scribe deploy and its Android app build
├── YT Bulk Publish/          Windows tool for YouTube Studio
├── N8N Automation imports/   importable n8n workflow files
└── Clinical Scribe/          clinical note web app on Supabase, with phone apps
```
