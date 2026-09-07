# How to work in this repository

These rules apply to every assistant session and to any automation that acts on this repository.

## Run work inline

- Do the work yourself, step by step, in the main session. Do not hand the task to a swarm of helpers.
- Never run heavy, token-consuming agents in the background or in parallel. Reading and editing files, running tests and writing documentation are done inline.
- At most **one** background agent may exist at any time, and only for a narrow, well-defined job (for example, a single long search or a long test run). Wait for it to finish before starting another one.
- Do not use multi-agent workflows or fan-out orchestration unless the repository owner asks for it in their own words.

## Plan, then act

1. Read `claude.md` and the file that matches the task (`design.md`, `release.md`, `version control.md`).
2. Write down the steps before starting, and keep a task list up to date while working.
3. When something cannot be done from the current environment (for example, building a Windows EXE from Linux, or a login that needs a phone confirmation), finish everything else, then explain exactly what was blocked and how to finish it.

## Testing

- Run the tool's own tests before committing. For `YT Bulk Publish`, that is `python -m unittest discover -s tests` from the tool folder; the browser tests use the included mock Studio pages and skip themselves if no Chromium-based browser is installed.
- Never disable or delete a test to make a run pass.

## Reporting

- Report outcomes faithfully: what was done, what was verified, what failed and what remains.
- Keep secrets out of reports, logs and commits.
