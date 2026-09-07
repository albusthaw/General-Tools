# Version control rules

## Branches

- `main` holds finished, working tools.
- Do development on a feature branch named for the change, for example `feature/yt-bulk-publish-schedule` or a branch name given by the repository owner. Never commit directly to `main` unless asked.
- One branch per change. Keep branches short-lived and merge through a pull request when the owner asks for one.

## Commits

- Write the message as a short imperative sentence: "Add rename preview to YT Bulk Publish", not "added stuff".
- One logical change per commit where practical. Add a body when the "why" is not obvious.
- Do not put secrets, account names or private links in commit messages.

## What must never be committed

- Passwords, tokens, cookies, session files or browser profile folders (for example anything under a user's `Documents/YT Bulk Publish/Browser Profile`).
- `.venv/`, `__pycache__/`, `build/work/` and other generated working files. Each tool has a `.gitignore` for these.
- Test recordings that contain personal data.

## Before pushing

1. Run the tool's tests.
2. Check `git status` and `git diff --staged` for anything that should not be there.
3. Push with `git push -u origin <branch>`.

## Pull requests

- Describe what changed, how it was tested, and anything left open.
- Do not open a pull request unless the repository owner asks for one.
