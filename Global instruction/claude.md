# Working rules for this repository

This file is the entry point for any assistant or contributor working in this repository. Read it fully, then read the files it points to before making changes.

## 1. What this repository is

General Tools is a collection of small, practical desktop tools. Each tool lives in its own top-level folder (for example `YT Bulk Publish/`) with its own README, source code, tests and a `Release/` folder for the built program. The root README gives brief information about every tool.

## 2. Files you must read

Read each of these before the matching kind of work. They are all in this folder.

| File | Read it when | What it covers |
| --- | --- | --- |
| `agent.md` | Always, before starting any task | How to work: run work inline, at most one background agent, how to plan and report |
| `design.md` | Building or changing any user interface or user-facing text | Glassmorphism look, plain language, no developer jargon on screen |
| `release.md` | Building, packaging or publishing a program | Building the EXE into `Release/`, version numbers, release notes |
| `version control.md` | Committing, branching or pushing | Branch names, commit messages, what must never be committed |

The rules in `agent.md` apply to every session and take priority when files seem to disagree.

## 3. Rules that always apply

- Never write passwords, tokens, cookies or browser profile data into the repository. Test accounts and credentials are given for one session only and stay out of files, logs and commit messages.
- Keep each tool self-contained in its own folder. Shared rules go in this folder, not in the tools.
- Code comments are welcome, but they must not mention the name of any AI model or assistant. Write comments as a human maintainer would.
- User-facing text (windows, buttons, messages, logs shown on screen) must be plain language with no developer jargon. Follow `design.md`.
- Do not leave the work half done. If part of a task is blocked, finish every other part and say clearly what was left out and why.
- Prefer small, reviewable changes and describe them accurately. If tests fail, say so and show the output.

## 4. How to add a new tool

1. Create a top-level folder named after the tool, for example `Thumbnail Maker/`.
2. Inside it: `README.md`, source folder, `tests/`, `build/` (build recipe) and `Release/`.
3. Follow `design.md` for the interface and `release.md` for building.
4. Add one row to the tools table in the root `README.md` with a one-line description.
5. Commit following `version control.md`.

## 5. Current tools

- `YT Bulk Publish/`: Windows tool that publishes, renames and updates many YouTube Studio videos in one go. Its engine drives the user's own browser through the browser's remote-control port; see the tool README for how it works and how to test it against the included mock Studio pages.
