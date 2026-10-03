# Clinical Scribe: design plan

This file sets the look, layout and wording of the Clinical Scribe web app. It follows the repository's shared rules (`Global instruction/design.md`: white glassmorphism, plain language, no developer jargon) and adapts them to a blue and white clinical identity that works on phones as well as desktops.

## 1. Inspiration and what we take from each

| Source | What we take |
| --- | --- |
| Apple Liquid Glass (2025–2026 Human Interface Guidelines) | Glass belongs to the navigation and control layer (side menu, top bar, tab bar, dialogs, key buttons); content sits on calmer, more solid surfaces. Legibility comes first: glass gets brighter and more opaque behind text. Tint is used for meaning, not decoration. Corners are concentric: an inner element's radius is the outer radius minus the padding. |
| Microsoft Fluent 2 (Acrylic and Mica) | Translucent, blurred surfaces for things that float above the page (menus, drawers, dialogs, toasts); a faint tint layer so text never sits on raw blur. |
| NHS digital service manual | Blue and white as the colours of clinical trust; every text and control colour meets WCAG 2.2 AA (aim for AAA on body text); a strong, visible focus state; plain English with short sentences. |
| GOV.UK and NHS content style | Buttons say what happens ("Start recording", "Copy note"); one main action per screen; errors say what went wrong and what to do next. |
| Ambient clinical scribe products (Heidi, Nabla, Abridge, TORTUS) | One large, unmistakable record control; visible stages after recording (saving, transcribing, writing); the note shown in sections with an obvious copy action; templates treated as first-class items; history grouped by date. |
| This repository's family look (`YT Bulk Publish/app/ui/styles.css`) | Soft aurora blobs behind frosted panels, thin white borders with a faint dark edge, pill chips, segmented controls, toggle switches, short feedback animations. |

What we avoid, so the app does not look machine-made: purple-to-pink gradients, sparkle icons and "magic" words, emoji, oversized rounded "bubble" shapes, the default Inter look, neon glows, and decorative illustrations.

## 2. Typography

| Role | Font | Why |
| --- | --- | --- |
| Interface and body text | **Source Sans 3** (variable, 400–700) | A humanist sans in the tradition of Frutiger, the typeface most associated with hospital signage and NHS material. Very legible at small sizes, compact for tables and long notes, open licence. |
| Display headings (sign-in title, page titles, empty-state titles) | **Source Serif 4** (variable, optical sizes) | Brings the calm authority of a medical journal or clinic letter. Designed to pair with Source Sans 3. Used sparingly, never for body text or buttons. |
| Numbers that change (timer, minutes left, counts) | Source Sans 3 with `font-variant-numeric: tabular-nums` | Digits keep the same width so the timer does not jitter. |

Fonts are bundled with the app (no calls to font services), which keeps clinical pages free of third-party requests.

Scale (px): 12.5 caption (smallest allowed), 14 small, 15 body, 17 lead, 20 section title, 24 card title, 32 page title (serif), 44 sign-in title (serif). Line height 1.5 for body, 1.2 for headings. Labels and buttons use weight 600; body 400; serif headings 600. Form fields use 16 px on phones so iPhone Safari does not zoom in when a field is tapped.

## 3. Colour

All colours are defined once as CSS custom properties in `web/src/styles/tokens.css`.

| Token | Value | Use |
| --- | --- | --- |
| `--bg-0` | `#f4f7fc` | Page background (cool white) |
| `--bg-1` | `#e8eef8` | Background gradient end |
| `--ink` | `#13233f` | Main text (deep clinical navy) |
| `--ink-2` | `#3c4a63` | Secondary text (≥ 8:1 on white) |
| `--ink-3` | `#5a6880` | Muted text, hints (≥ 5.5:1 on white) |
| `--line` | `rgba(19, 35, 63, 0.12)` | Dividers and field borders |
| `--blue-700` | `#1747b0` | Primary button start, active nav text |
| `--blue-600` | `#2463d0` | Primary button end, links, focus ring (white text ≥ 5.5:1) |
| `--blue-100` | `#e3edff` | Selected rows, active nav fill |
| `--sky-200` | `#cfe4ff` | Aurora blob, info surfaces |
| `--aqua-200` | `#c8efea` | Aurora blob (small touch of aqua) |
| `--ok` | `#167a52` | Success text and icons |
| `--warn` | `#8a5300` | Warning text and icons |
| `--bad` | `#c22a45` | Errors, danger actions, recording dot |
| `--glass` | `rgba(255, 255, 255, 0.62)` | Floating glass (side menu, bars, dialogs) |
| `--glass-strong` | `rgba(255, 255, 255, 0.84)` | Content cards (text sits here) |
| `--glass-border` | `rgba(255, 255, 255, 0.9)` | Glass rim |
| `--glass-edge` | `rgba(19, 35, 63, 0.08)` | Faint dark outer edge |

Primary gradient: `linear-gradient(135deg, var(--blue-700), var(--blue-600))` with white text. Danger gradient: `#c22a45 → #e0503d`. Status chips use a pale fill with dark text of the same hue.

Aurora: four large, blurred, slowly drifting blobs in sky blue, ice blue, pale periwinkle and a small aqua. They stop moving when the device asks for reduced motion.

## 4. Glass rules

- Floating surfaces (side menu, top bar, mobile tab bar, drawers, dialogs, toasts, menus): `--glass`, `backdrop-filter: blur(24px) saturate(160%)`, 1 px white border, faint dark edge, soft shadow.
- Content cards (recorder, transcript, notes, tables, forms): `--glass-strong`, lighter blur (16 px). Long text always sits on this stronger glass.
- Never put body text directly on blur; never stack more than two glass layers.
- When the device asks for reduced transparency, or the browser cannot blur, glass becomes nearly solid white (`rgba(255,255,255,0.96)`).
- When the device asks for more contrast, borders become solid navy at 40 % and muted text becomes `--ink-2`.

## 5. Shape, spacing and depth

- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px.
- Radius: 10 (fields, small buttons), 14 (buttons, chips, list rows), 20 (cards), 28 (dialogs, recorder panel), 999 (pills, round record button). Inner radius = outer radius minus padding.
- Shadow: `0 18px 48px rgba(22, 40, 80, 0.12)` for cards, `0 8px 24px rgba(22, 40, 80, 0.10)` for small floating items.
- Touch targets are at least 44 × 44 px. The record button is 96 px on phones and 112 px on larger screens.

## 6. Layout

| Width | Layout |
| --- | --- |
| 1024 px and wider | Fixed glass side menu (264 px) on the left; content column up to 1120 px wide; Clinical Scribe tabs sit at the top of the content. |
| 760–1023 px | Side menu becomes a drawer opened from a glass top bar; tabs stay at the top of the content. |
| Below 760 px | Glass top bar (menu button, page title, account button); the drawer slides in from the left over a dimmed page; Clinical Scribe tabs move to a glass bottom bar above the phone's safe area; dialogs become bottom sheets; tables become stacked cards. |

Side menu contents:
- Clinical Scribe
- Phone apps (everyone, from 1.4.0)
- **Admin settings** (admins only): User settings, AI settings, Recording, Review records, Audit log, Google sign-in, Email (SMTP)
- Account area at the bottom: initials, name, role, Change password, Sign out.

## 7. Screens

**Sign in**: centred glass card over the aurora; serif title "Clinical Scribe"; email, password (with show/hide), "Sign in" button; "Continue with Google" button with the Google mark when switched on; a short line "Forgot your password? Ask your administrator." Errors appear inside the card.

**Scribe**: one recorder card. Before recording: note template picker, optional visit label, minutes left, a large round "Start recording" button. While recording: red pulsing dot with "Recording", large tabular timer, live level bars, Pause/Resume, Finish (primary), Discard (text button with confirmation). After Finish: a four-step progress line (Saving audio → Transcribing → Writing note → Ready) with a calm sentence under it ("You can close this page. The note will be in History."). When ready: the note card (sections, Copy note), the transcript card (collapsed by default, Copy transcript) and "Write another note".

**Templates**: two groups, Shared and Mine, as cards with name, short description and a View button. "Create template" opens the builder: describe → draft appears → edit or "Ask for changes" → name → Save. For admins the builder first asks "Who can use this template?" with **Everyone in the clinic** (chosen first) or **Only me**. Admins also edit, make default and archive shared templates from the template's dialog, and can share one of their own with everyone. Anyone can delete their own templates.

**History**: search field ("Search labels, transcripts and notes") and a list grouped by day (Today, Yesterday, dates), 10 recordings per page with Previous, "Page 2 of 14" and Next under the list. Search covers every recording and says how many were found; a match inside a transcript or note shows a short extract under the title. Each row: label, time, length, status chip, note count. The detail view: transcript card, "Write another note" picker, then the notes as cards that open and close: the header shows the template name, when it was written and Copy note; only the newest is open at first; with two or more notes a quiet button switches between Newest first and Oldest first. Delete in an overflow menu.

**Phone apps**: in the side menu for everyone, under Clinical Scribe. The server link with Copy and a QR code, the Android download and the iPhone steps; admins also see the clinic name card.

**Admin pages**: page title, one main action at the top right (stacked under the title on phones), then cards. Tables on desktop, stacked cards on phones. Dangerous actions sit in an overflow menu and always confirm in a dialog that names the person or item.

**Review records**: an amber warning panel first; a person picker, a required reason and a confirmation tick; "Start review" begins a session shown by an amber bar at the top ("Review in progress — every record you open is recorded") with "End review".

## 8. Components

Buttons (primary, secondary glass, quiet, danger, icon-only with a label for screen readers), text fields, password field with show/hide, select, textarea, toggle switch, segmented control, chips, status chips, cards, list rows, tables, dialogs and bottom sheets, overflow menus, toasts, banners (info, warning, danger, success), empty states, loading skeletons, the step progress line, copy blocks, the level meter, and the timer. Icons are simple 1.75 px line icons at 20 px, drawn in the app (no icon fonts).

## 9. Motion

150–250 ms ease-out for hover, press, open and close. The recording dot pulses slowly (1.6 s). The aurora drifts over 30 s. Everything decorative stops when the device asks for reduced motion.

## 10. Accessibility

- WCAG 2.2 AA throughout: text contrast 4.5:1 (body text aims for 7:1), controls 3:1.
- Visible focus ring on every control: 3 px `--blue-600` outline with a 2 px white halo, so it shows on glass.
- Full keyboard use; dialogs trap focus and return it on close; Escape closes dialogs and drawers.
- Live regions announce recording state changes, copy results and processing progress.
- Labels on every field; errors are linked to their field.
- Language set to `en-GB`.

## 11. Voice

- Plain British English, short sentences, no developer words on screen. Say "service key" (not "API key"), "the AI service did not accept the key" (not "401"), "saving audio" (not "uploading blob").
- No page subtitles that explain what a page is for. Titles, labels and buttons carry the meaning; helper text appears only where a person must act or be warned.
- Buttons name the outcome: "Start recording", "Finish", "Copy note", "Write another note", "Create template", "Ask for changes", "Save template", "Add person", "Save key", "Check key", "Start review", "End review", "Download CSV".
- Error messages say what happened and what to do next, for example: "The AI service did not accept the saved key. Ask an administrator to check it in AI settings."
- Keep the services' own names: ElevenLabs, Gemini, DeepSeek, Google, Supabase (only where the admin must act in Supabase).
- Dates and times use the device's locale, 24-hour clock where the locale uses it.

## Phone apps

The Android app and the iPhone web app keep this look and wording, inside an app frame made for phones: a tab bar, large titles, sheets and gestures, styled after each phone. Their design is in `appdesign.md`.
