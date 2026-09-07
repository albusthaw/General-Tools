# YT Bulk Publish

Publish, rename and update many YouTube Studio videos in one go, from a Windows desktop program with a frosted-glass interface.

YouTube Studio has no bulk publish for uploaded drafts and no flexible bulk rename. This tool works inside your own browser and clicks through the same screens a person would, one video at a time, while you watch.

## What it does

1. **Pick window**: shows a live picture of every open browser window. Click the one with YouTube Studio. If that window was opened normally, the tool offers to open its own browser window instead; you sign in there once and the sign-in is remembered in the tool's own profile folder.
2. **Videos**: reads the video list from the open page, from all channel content, or from a playlist link. Titles, status (Draft, Private, Unlisted, Public, Scheduled), date and length are shown with search, status filters and a "Save title list" button (CSV).
3. **Changes**: switch on what to change in bulk:
   - Visibility: Public, Unlisted, Private or Schedule (with a gap in minutes between videos). Drafts are finished and published with the chosen visibility.
   - Title: rename steps applied in order, with a live old-to-new preview. Steps: change a word or phrase (match case, whole words), remove text, add text at the start or end, number the videos (`{title}`, `{n}`, `{index}`, `{date}`, `{original}` tokens with start, step and digits), change letter case, tidy spaces, advanced pattern. Rule sets can be saved and loaded.
   - Description: replace all, add at start, add at end, or change a phrase.
   - Tags: add to existing or replace all.
   - Audience: made for kids or not (YouTube requires this before a draft can be published).
   - Playlist: add every selected video to an existing playlist.
4. **Run**: a summary, a practice-run option that saves nothing, a pause setting between videos, a per-video progress list, an activity log and a Stop button.

The tool keeps its files in `Documents\YT Bulk Publish\` (browser profile, logs, saved rule sets, settings).

## Run from source

Windows 10 or 11 with Python 3.10 or newer:

```
cd "YT Bulk Publish"
run.bat
```

`run.bat` creates a private Python environment, installs `requirements.txt` and starts the program. Google Chrome or Microsoft Edge must be installed; Brave and Vivaldi also work.

## Build the program

Double-click `build\build_release.bat`. The finished program appears as `Release\YT Bulk Publish.exe`. Building has to happen on Windows; see `Global instruction/release.md`.

## Tests

```
cd "YT Bulk Publish"
python -m unittest discover -s tests -v
```

- `tests/test_rename.py` covers the rename rules.
- `tests/test_engine_mock.py` starts a Chromium-based browser with remote control and runs the real engine against `tests/mock_studio.py`, a small local stand-in for YouTube Studio that uses the same element names as the real pages (video rows, editor, draft wizard, visibility and playlist pop-ups). It is skipped when no browser is found.

## How it works, briefly

The program (pywebview, HTML and CSS) talks to a Chromium-based browser through the browser's remote-control port (the same port developer tools use). Chrome no longer allows that port on its normal profile, so the tool starts the browser with a profile of its own inside `Documents\YT Bulk Publish\Browser Profile`. Nothing is sent anywhere else; there are no API keys and the tool never sees your password.

Element names for YouTube Studio live in `app/selectors.py`, each with several fall-backs and text-based searches. If YouTube changes its pages, that is the file to update.

## Known limits

- The live YouTube Studio pages could not be exercised during development (the test account required a phone confirmation at sign-in), so the engine was verified against the mock pages. Use the practice run on one or two videos first; the activity log names any screen part that could not be found.
- Scheduling relies on YouTube's date and time pickers and is the most fragile step; if it fails, the video is left unchanged.
- Firefox windows cannot be controlled; use Chrome, Edge or Brave.
- Window pictures and the browser-window picker are Windows only.

## Changes

### 1.0.0

- First release: window picker, video list, bulk visibility and draft publishing, custom rename rules with preview, description, tags, audience and playlist changes, practice run, activity log, build recipe for the Windows EXE.
