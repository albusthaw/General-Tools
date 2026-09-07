# YT Bulk Publish

Publish, rename and update many YouTube Studio videos in one go, from a Windows desktop program with a white frosted-glass interface.

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

Two ways, both described in `Global instruction/release.md`:

- **GitHub Actions**: run the workflow "Build YT Bulk Publish (Windows EXE)" from the Actions tab. It builds on a Windows runner, starts the program in check mode, and commits `Release\YT Bulk Publish.exe` to the branch.
- **On Windows**: double-click `build\build_release.bat`. The finished program appears as `Release\YT Bulk Publish.exe`.

Starting the program with `--check` loads every part without opening a window and writes `startup-check.txt` next to it; the build uses this to prove the EXE works.

## Icons

All icons are original drawings made for this program: the app icon (`build/icon.ico`, preview in `assets/app-icon.png`, drawn by `build/make_icon.py`) and the small interface icons, which are simple stroke shapes defined at the top of `app/ui/index.html`. No third-party icon sets or brand marks are used.

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

## Verified against the live YouTube Studio

On 7 September 2026 the engine was run against a real channel with two freshly uploaded drafts:

- reading the content list (video ids come from the thumbnail address, because draft rows carry no links);
- opening a draft through its deep link (`…/videos/upload?d=ud&udvid=<id>`), renaming it, setting the audience and publishing it as Unlisted through the upload wizard;
- opening a published video in the plain editor, renaming it and changing its visibility with the pop-up's Done button, then saving.

Both runs finished with zero problems. Use the practice run on one or two videos first whenever YouTube has changed its pages; the activity log names any screen part that could not be found.

A larger live run followed on the same day: 8 further clips were uploaded as drafts (YouTube's daily upload limit for the new channel stopped the batch at 10 videos per day, so 22 of the 30 prepared clips have to wait for later days). One bulk run over all 10 channel videos, mixing 8 drafts and 2 already-published videos, renamed the phrase "stress clip" to "Stress Test Clip", set the audience and published everything as Unlisted: 10 updated, 0 problems, about 53 seconds per draft and 6 seconds per video that needed no change. The rows-per-page control on the real list was switched to 10, 50 and 30 by the engine and verified each time; reading across several pages was stress-tested on the mock with 32 videos over 4 pages, because the smallest real page size (10) equals the number of videos on the channel today.

## Known limits

- Scheduling relies on YouTube's date and time pickers and was not part of the live run; if it fails, the video is left unchanged.
- Description, tags and playlist changes follow the same editor pattern but were exercised on the mock pages only.
- Firefox windows cannot be controlled; use Chrome, Edge or Brave.
- Window pictures and the browser-window picker are Windows only.

## Changes

### 1.0.0

- First release: window picker, video list, bulk visibility and draft publishing, custom rename rules with preview, description, tags, audience and playlist changes, practice run, activity log, build recipe for the Windows EXE.
