# General Tools

A growing collection of small, practical desktop tools. Each tool lives in its own folder with its own README, source code and a `Release` folder for the built program. Shared working rules for the whole repository live in the `Global instruction` folder.

## Tools

| Tool | Folder | What it does |
| --- | --- | --- |
| YouTube Bulk Publisher | `YT Bulk Publish/` | Publish, rename and update many YouTube Studio videos in one go. |

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

## Repository layout

```
General-Tools/
├── CLAUDE.md                 short pointer to the Global instruction folder
├── Global instruction/       working rules: claude.md, agent.md, design.md, release.md, version control.md
└── YT Bulk Publish/          the first tool
```
