# Design rules

Every tool in this repository shares one look and one voice.

## Look: glassmorphism

- Dark, calm background with soft moving colour blobs (an "aurora") behind everything.
- Content sits on frosted glass panels: translucent white fill (about 7 to 12 percent), a thin light border, a large corner radius (about 20 px), a soft deep shadow and a backdrop blur of roughly 24 to 30 px.
- One accent gradient for primary buttons and active states (violet to cyan in `YT Bulk Publish`). Danger actions use a warm red-orange gradient. Success, warning and error colours are green, amber and pink-red.
- Rounded pill chips for filters and status, toggle switches for on/off choices, segmented controls for one-of-few choices.
- Text uses the system font (Segoe UI on Windows). Headings are bold and short.
- Animations are short (150 to 350 ms) and used for feedback, not decoration.
- Custom title bar with the tool name, a step indicator and window controls. The title bar is the drag area.

The reference implementation is `YT Bulk Publish/app/ui/styles.css`. New tools should copy its tokens (colour variables, radius, blur) so the collection looks like one family.

## Voice: plain language

- No developer jargon on screen. Say "the tool cannot reach inside this window" rather than "no DevTools endpoint". Say "practice run" rather than "dry run". Never show selectors, stack traces, protocol names or code in the interface.
- Every error message says what happened and what the person can do next.
- Buttons name the outcome: "Load videos", "Next: choose changes", "Stop after this video".
- Keep YouTube's own words for YouTube's own things (Draft, Unlisted, Made for kids).
- Log lines shown on screen are short sentences with a time stamp.

## Code comments

- Comments explain intent for a future maintainer. They must not mention the name of any AI model or assistant.
- Keep the same friendly tone in comments, but technical terms are fine there.

## Flow

- Guide the person through numbered steps (pick, review, choose, run). Each step has one clear next action.
- Show a preview before anything irreversible (for example old title to new title).
- Offer a practice run whenever the tool changes something the person cannot easily undo.
- Show live progress with a per-item status list and an activity log, and always offer a way to stop.
