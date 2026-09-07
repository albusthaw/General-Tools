# Design rules

Every tool in this repository shares one look and one voice.

## Look: white glassmorphism

- Light, calm background (near-white with a faint cool tint) with soft moving pastel colour blobs (an "aurora") behind everything: lavender, sky blue, blush and mint.
- Content sits on frosted glass panels: translucent white fill (about 55 to 85 percent), a thin white border plus a very faint dark edge, a large corner radius (about 20 px), a soft shadow and a backdrop blur of roughly 22 to 28 px.
- Text is deep navy (`#1b2140`) with softer navy tints for secondary text; never grey on grey. Keep small text at 12.5 px or larger and at least medium weight when it sits on glass.
- One accent gradient for primary buttons and active states (violet to blue in `YT Bulk Publish`), with white button text. Danger actions use a warm red-orange gradient. Success, warning and error colours are green, amber and rose, always dark enough to read on white.
- Rounded pill chips for filters and status (pastel fill, dark matching text), toggle switches for on/off choices, segmented controls for one-of-few choices.
- Text uses the system font (Segoe UI Variable / Segoe UI on Windows). Headings are bold and short; body text is 14 px.
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
