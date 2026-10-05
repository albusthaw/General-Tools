# Clinical Scribe apps: design plan

This file designs the two app versions of Clinical Scribe together:

- **The Android app**: an app installed on Android phones and tablets.
- **The iPhone web app**: Clinical Scribe added to the Home Screen of an iPhone or iPad from Safari. It opens full screen like an app.

Both apps do everything the website does. When an app is opened for the first time, it asks for the **server link** and then connects to that clinic's server. The website itself keeps its current look; nothing here changes it, apart from a small "Get the app" offer on phones (section 9).

This plan builds on `design.md` (brand, colours, fonts, glass rules, accessibility, voice). Where this file says nothing, `design.md` applies. The technical plan is in `appproject.md`.

## 1. Goals

1. **Same calm, clean look.** The same blue and white glass, the same fonts, the same plain words. A person who knows the website feels at home at once.
2. **Feels like a real app on each phone.** Navigation sits under the thumb. Screens slide in and out. Lists react to swipes and pulls. Buttons respond to touch with motion (and with a gentle vibration on Android).
3. **iPhone looks like iOS 27.** The iPhone web app follows the newest iOS style, Liquid Glass: floating glass bars, capsule shapes, large titles, sheets.
4. **Android looks like Android 16.** The Android app uses Material 3 Expressive motion and shapes, in the Clinical Scribe colours.
5. **Recording comes first.** One large record control, always one tap away, and a small recorder that follows you to other tabs while recording.
6. **No developer words and no "this page is for" remarks.** Titles, labels and buttons carry the meaning. Helper text appears only where a person must act or be warned.

## 2. Research and what we take from it

| Source | What we take |
| --- | --- |
| **iOS 27 Liquid Glass** (WWDC, June 2026) | Glass is the control layer: tab bars, toolbars, buttons and sheets float above the content as capsules. iOS 27 made the glass more tinted by default, with darker edges and brighter highlights, so it stays readable over busy content. Tab bars float, shrink while you scroll down and grow again when you scroll up. Search moved back inside the tab bar. Menus are glass too. Corners are concentric with the screen. People can choose clearer or more tinted glass, so we honour "reduce transparency". |
| **iPhone Home Screen web apps** (iOS 26 and 27) | Any site added to the Home Screen now opens as a web app ("Open as Web App" is on by default). In Safari's default compact layout, Share is inside the "⋯" button at the bottom right. Launch screens still come only from `apple-touch-startup-image` images. Home Screen web apps ask for the microphone again in each session, and keeping the screen awake works there (since iOS 18.4). |
| **Material 3 Expressive** (Android 16) | Spring motion, shapes that change on press (a round button briefly becomes a rounded square), a large floating action button, button groups, bottom sheets with a drag handle, snackbars, and wavy progress indicators. Apps draw edge to edge under the status bar and navigation bar. |
| **Ambient scribe phone apps** (Heidi, Nabla, Abridge) | One huge record button; a live sound level so people see the phone is listening; recording carries on with the screen off on Android; clear stages after recording; notes with one obvious Copy action. |
| **Clinical Scribe website** (`design.md`) | Brand colours, Source Sans 3 and Source Serif 4, glass rules, the four-step progress line, status chips, banners, voice and accessibility rules. |

## 3. One product, three looks

| Part | Website (unchanged) | Android app | iPhone web app |
| --- | --- | --- | --- |
| Navigation | Side menu, drawer and top bar; tab bar on phones | Bottom navigation bar, docked, edge to edge | Floating glass tab bar (a capsule) that shrinks while scrolling |
| Page titles | Serif page title | Large title that shrinks into the top app bar when you scroll | Large title (34 px, bold) that shrinks into a glass navigation bar when you scroll |
| Main quick action | Big record button on Scribe | Big record button on Scribe, plus a "New recording" floating button on History and Templates | Big record button on Scribe; a glass "+" button in the bar where something can be created |
| While recording, on other tabs | Small "Recording 03:21" pill | Mini recorder bar above the navigation bar | Mini recorder capsule above the tab bar |
| Dialogs | Centred dialogs; bottom sheets on phones | Bottom sheets with a drag handle | Sheets with a grabber, large rounded corners, half and full heights |
| Short messages | Toasts | Snackbars above the navigation bar | Glass capsule messages above the tab bar |
| Lists | Rows with an overflow menu | Swipe a row for Rename or Delete; pull down to refresh; long press for a menu | Same gestures, iOS style: swipe actions, pull to refresh, long press for a glass menu |
| Interface font | Source Sans 3 | Source Sans 3 | The iPhone system font (San Francisco), which follows the person's text size setting |
| Display font | Source Serif 4 | Source Serif 4 for the brand name only | Source Serif 4 for the brand name only |
| Touch feedback | Colour change | Shape change and a short vibration | Gentle spring scale (iPhone web apps cannot vibrate) |

## 4. App structure

### 4.1 Destinations

Both apps have five tabs (from 1.5.0), in the same order as the website:

| Tab | Icon | Contents |
| --- | --- | --- |
| **Clinical Scribe** | two speech bubbles | A conversation between two or more people: new recording, live recording, processing, the finished note |
| **Voice Note** | microphone with sound lines | One person dictating: the same recorder, with Voice Note templates |
| **Templates** | template | Shared and personal templates, the template helper |
| **History** | clock | Recordings by day, search, details, more notes |
| **More** | person in a circle | Your details, password, server, Admin settings (admins only), version, sign out |

Admin pages open from **More → Admin settings** as pages that slide in, each with a back button. On tablets and wide windows (900 px and wider) the tabs move into a glass side bar on the left, like iPad and Android tablet apps, and admin pages appear in the same side bar.

### 4.2 Screen flow

```
First launch ─► Connect (server link) ─► Confirm server ─► Sign in ─► Clinical Scribe tab
                     ▲                                       │
                     └──────── More → Change server ◄────────┘

iPhone, in Safari ─► "Add to Home Screen" steps ─► (opens from the Home Screen) ─► Connect …
```

Later launches go straight to the Clinical Scribe tab (or to Sign in when the session has ended). When the Android app reopens while a Voice Note is still recording, it opens on the Voice Note tab.

## 5. Screens

### 5.1 Connect

- Brand mark (white waveform on the blue gradient square) and "Clinical Scribe" in Source Serif 4.
- Title: **Connect**.
- Field **Server link**, with a **Paste** button inside the field. Hint under the field: "Ask your administrator for this link."
- Primary button **Connect**.
- When the link works, a confirmation card replaces the form: the clinic name in large type (or the server's address when no name is set), the address in small type below, then **Connect** (primary) and **Use another link** (quiet).
- **Recent servers** list under the form when the person has used other servers before. One tap reconnects; the × button removes one. After **Change server**, Connect shows this form straight away instead of suggesting the same clinic again.
- The iPhone web app opened from a clinic's own site, or the Android app opened from a connect link, shows the confirmation card at once with that clinic filled in. The person still confirms with one tap.
- Errors appear under the field in plain words (section 10).

### 5.2 Sign in

- Same fields and wording as the website: Email address, Password (show or hide), **Sign in**, **Continue with Google** when switched on, "Forgot your password? Ask your administrator."
- Above the form, a small glass chip shows the connected clinic with **Change** next to it.
- iPhone: fields sit together in one inset rounded group, iOS style. Android: the website's field style, with a slightly larger touch height (56 px).

### 5.3 Clinical Scribe and Voice Note: ready

- Large title **Clinical Scribe** or **Voice Note**, with the minutes left as a chip in the top bar.
- Under the title, the pair of type cards from the website (`design.md`, section 7), side by side, so the difference is clear at a glance and the other tab is one tap away.
- Card **New recording** (or **New voice note**), with only the templates of that type:
  - **Note template** as a tappable row showing the chosen template. Tapping opens a sheet with a search field and the template list (Shared, then Mine). The last used template is remembered, as on the website.
  - **Label (optional)** field.
- The record button: 128 px circle in the primary gradient, with a slow "breathing" glow ring. Under it: "Start recording".
- Warnings use the website's banners (no transcription set up, no minutes left, interrupted recordings).

### 5.4 Recording (both tabs)

The recorder fills the screen, so it is easy to use with one hand and readable from a distance.

- At the top: red dot and **Recording** (or **Paused**), then the type chip, the template name and the label.
- Only one recording runs at a time. The other recording tab shows "A Voice Note is being recorded" (or "A Clinical Scribe recording is going on") with **Go to the recording**.
- In the middle: the timer in large tabular digits (56 px). Around the central control, a **sound ring** grows and shrinks with the voice level, so people can see the phone is listening. When paused, the ring turns grey and still.
- The central circle (96 px) is **Pause** (or **Resume**). Below it, a wide primary capsule **Finish**. Below that, the quiet **Discard** text button, which always asks for confirmation.
- Android: "Recording carries on when the screen is off." under the controls, and a recording notification with **Pause** or **Resume** (section 7.2). The screen may turn off as usual.
- iPhone: a **Screen off** button (moon) next to **Discard**. It turns the screen black and locks touches while the recording carries on. Only a dim red dot with "Recording 12:34" is shown, and it moves to a new place every minute; "Press and hold to show Clinical Scribe" shows for a few seconds, and again on any touch. A press and hold of about a second shows the app, with a ring that fills while holding. If the phone cannot be kept from locking (older iOS, Low Power Mode), the dark screen says so in dim text: "This iPhone may lock by itself and pause the recording. To stop that, turn off Low Power Mode and set Auto-Lock to Never in Settings." Laying the phone face down does the same as the button once motion access is allowed (asked the first time Screen off is tapped). Screen off ends by itself when the recording pauses or finishes. Under the controls: "Use Screen off to keep recording with a dark screen." (with "or lay the phone face down" once that works). Android browsers get the same button.
- **Paused by itself:** a call, other sound, a lost microphone or a locked iPhone pause the recording and never end it. A calm banner above the recorder says why, and the Resume circle is ready:
  - "Paused for a phone call. Tap Resume when you are ready."
  - "Paused because another app played sound. Tap Resume to carry on."
  - "Paused because the microphone was needed elsewhere, for example for a call. Tap Resume to carry on." (iPhone and browsers, where the reason is not known)
  - "Paused because the screen locked or another app opened. Tap Resume to carry on." (iPhone)
  - "Paused while sound played in Clinical Scribe. Tap Resume to carry on."
  - "The microphone stopped. Tap Resume to try again."
  - "Another app is using the microphone. Tap Resume to try again."
  - Resume during a call: "You can resume when the call has ended." If the microphone cannot start again: "The microphone could not start again. If a call is going on, try again when it has ended."
  - A recording that ended on the phone while the app was closed (for example at the time limit) is saved as usual, with a short note saying so.
  The Android notification shows the reason in short: "Paused for a call · 4:05" and "Tap Resume when the call has ended".
- Motion: on press, Pause and Finish change shape on Android (round to rounded square and back) and scale with a spring on iPhone. Starting, pausing, resuming and finishing each give a short vibration on Android.

### 5.5 Processing and note (both tabs)

- The website's four steps (Saving audio → Transcribing → Writing note → Ready) shown as a vertical list with a moving indicator on the current step: a wavy line on Android, a smooth spinner on iPhone.
- The note card, then the transcript card (closed by default), then **Write another note**, which opens a template sheet.
- **Copy note** and **Copy transcript**: the button turns into a green tick with "Copied" for a moment.
- **New recording** (or **New voice note**) at the bottom.

### 5.6 Templates

- Large title **Templates**. A segmented control **Shared | Mine** sits under the title (a sliding glass thumb on iPhone; Material segmented buttons with a tick on Android).
- Template cards as on the website, each with its type chip. Tap opens the template in a sheet. Personal templates have **Edit** and **Delete** (any of them, also one that has already written notes). For admins, shared templates have **Edit**, **Make default** and **Archive**, and their own personal templates also have **Share with everyone** (from 1.4.0).
- Create: the "+" glass button in the navigation bar (iPhone) or the floating **Create template** button (Android) opens the template helper as a full-height sheet. The first step asks for the **Template Type** (Clinical Scribe or Voice Note); for admins it then asks who can use it: **Everyone in the clinic** (chosen first) or **Only me**.
- Pull down to refresh.

### 5.7 History

- Large title **History**, then two tabs, **Clinical Scribe** and **Voice Note**, each with its own search and page (from 1.5.0), then the search field (on iPhone it slides up with the title). The search finds labels, transcripts and notes in every recording, not only the page shown, and says how many were found; a match inside a transcript or note shows a short extract under the title.
- Ten recordings per page, grouped by day with headers that stay in place while scrolling: **Today**, **Yesterday**, then dates. Under the list: **Previous**, "Page 2 of 14" and **Next**, large enough for a thumb (from 1.4.0).
- Each row: the type's tinted icon, label (or time), time and length, status chip, number of notes.
- Gestures: swipe left for **Rename** (blue) and **Delete** (red, asks for confirmation); long press for a menu (Open, Rename, Delete); pull down to refresh.
- Android: floating **New recording** button (**New voice note** on the Voice Note tab) that shrinks to a round button while scrolling.
- Empty state: "No recordings yet" with a **Start recording** button.

### 5.8 History detail

- Top bar with a back button ("‹ History" glass capsule on iPhone, back arrow on Android) that leads to the History tab of the record's type, the label or time as the title, a type chip next to the date, and a "⋯" menu with Rename and Delete.
- Then the same content as the website: transcript card, **Write another note** (template sheet), then the notes. Each note is a card that opens and closes; the header shows the template name, when it was written and **Copy note**. Only the newest note is open at first. With two or more notes, **Newest first** / **Oldest first** changes the order (from 1.4.0).

### 5.9 More

- Profile header: initials avatar, name, email, role chip (Admin or User).
- Groups of rows, iOS settings style on iPhone and Material list style on Android:
  - **Account**: Your details, Change password.
  - **Server**: "Connected to St Mary's Clinic" with **Change server**.
  - **Admin settings** (admins only): User settings, AI settings, Recording, Review records, Audit log, Google sign-in, Email (SMTP).
  - **App**: **Phone apps** (for everyone, from 1.4.0); on Android a **Vibration** switch, "Short vibrations when you start, pause or finish a recording" (on at first, kept on the phone); Version; and on Android "Get the newest version" when the server has a newer one.
  - **Sign out** (red row, asks when audio is still being saved, as on the website).

### 5.10 Admin pages

The existing admin pages appear unchanged inside the app frame: large title, the page's main action under the title, cards, tables shown as stacked cards. Long tables get pull to refresh. Dangerous actions keep their confirmations.

### 5.11 Phone apps (website and apps)

A page that helps staff get the apps. From 1.4.0 everyone can open it: on the website from the side menu, in the apps from More. The clinic name card is for admins only.

- **Server link**: the link staff type into the apps, a **Copy** button and a QR code. Scanning the QR code with a phone camera opens the iPhone web app (or, on Android, the website with the app download).
- **Android app**: **Download** button (when the app file is published with the site), the app version, and two short steps.
- **iPhone and iPad**: the web app's address with **Copy**, and three short steps.
- **Name shown in the apps** (admins only): the clinic name staff see when they connect (for example "St Mary's Clinic"), with **Save**.

## 6. Shared app components

| Component | Behaviour |
| --- | --- |
| Tab bar | iPhone: floating glass capsule, 64 px high, 16 px from the screen edges, above the home indicator. The selected tab sits in a glass "lens" pill. While scrolling down it shrinks to a smaller capsule; scrolling up restores it. Android: docked bar, 76 px plus the system navigation area, active tab shown by a pill behind the icon. With five tabs a long name such as "Clinical Scribe" takes two lines on narrow phones instead of being cut off; every name then keeps room for two lines and the bar grows a little (68 px on iPhone, 80 px on Android), so the icons stay in one row. |
| Navigation bar with large title | Large title at rest; when the page scrolls 40 px, the title moves into a small centred (iPhone) or left-aligned (Android) title in a glass bar. Back button on pushed pages. Optional action buttons on the right. |
| Sheet | Slides up from the bottom; grabber (iPhone) or drag handle (Android); drag down or tap the dimmed page to close; half height and full height. Focus stays inside; Escape and the Android back gesture close it. Replaces dialogs inside the apps. |
| Mini recorder | Glass capsule above the tab bar while a recording is running and its own tab is not open: red dot, "Recording 03:21" (or "Paused"), Pause or Resume button. Tap anywhere else on it to return to the recording's tab (Clinical Scribe or Voice Note). |
| Floating action button (Android) | 56 px rounded square, primary gradient, icon plus label when extended; shrinks to the icon while scrolling down. |
| Swipe row | Swipe left to reveal actions; nothing happens until an action is tapped, so a long swipe never deletes by accident. The click the browser sends for the swipe or long press itself is dropped; the next tap always works. Actions are also in the long-press menu and on the item's own page, so nothing depends on swiping alone. |
| List picker | A long choice, such as the note template, opens a sheet instead of a small drop-down list. With 7 or more choices the sheet is tall and has a search field. |
| Pull to refresh | Pull down at the top of a list; a spinner appears and the list reloads; a short vibration on Android when the pull is far enough. |
| Copy button | Turns into a tick with "Copied" for 1.5 seconds. |
| Segmented control | Sliding thumb (iPhone glass, Android tonal with a tick). |
| Snackbar or message | Android: dark capsule at the bottom above the navigation bar. iPhone: glass capsule above the tab bar. Errors stay until dismissed. |
| Skeleton rows | Soft shimmering placeholders while lists load (still when reduced motion is on). |
| Offline bar | Thin amber bar under the top bar: "No internet connection. Recordings are kept on this phone and sent when you are back online." |

## 7. Platform details

### 7.1 iPhone web app (iOS 27 style)

- **Glass**: white at 72 % (iOS 27's more tinted default), blur 30 px with saturation 180 %, a bright inner top edge, a faint darker outer edge and a soft shadow. With "reduce transparency" the glass becomes nearly solid; with "increase contrast" edges become solid navy at 40 %.
- **Colour**: the Clinical Scribe blue (`--blue-600`) is the app's tint for buttons, links, selected tabs and switches. Grouped backgrounds are a cool off-white (`#f2f5fa`) with a faint aurora.
- **Type**: the system font. Large titles 34 px bold; navigation titles 17 px semibold; body 17 px; secondary text 15 px; footnotes 13 px. Body text uses the iPhone's own text size setting, so people who use larger text get it here too.
- **Shapes**: capsules for bars and buttons; cards 22 px radius; sheets 34 px top corners; grouped list sections 22 px radius; inner corners concentric.
- **Motion**: pages slide in from the right with a slight parallax; sheets rise with iOS's sheet curve; the tab bar minimises and restores smoothly; press feedback is a spring scale to 96 %.
- **Status bar and safe areas**: content runs under a translucent status bar; the top bar and tab bar respect the notch, Dynamic Island and home indicator areas.
- **Launch screen**: the brand mark in the centre of the off-white background, for every current iPhone and iPad size.
- **Install screen** (only in Safari, before it is on the Home Screen): brand mark, title **Add to Home Screen**, three numbered steps with small pictures of the Safari buttons, and a quiet **Continue in Safari** button.
  1. Tap ⋯ at the bottom of Safari, then tap Share.
  2. Tap Add to Home Screen.
  3. Keep Open as Web App switched on, then tap Add.

### 7.2 Android app (Android 16 style)

- **Surfaces**: the brand background with the aurora; cards on strong glass as on the website; the top app bar and navigation bar are light glass so the aurora shows through softly.
- **Colour**: primary `--blue-600` with white text; the active tab pill and selected chips in `--blue-100`; snackbars dark navy (`#1b2740`) with white text.
- **Type**: Source Sans 3. Large title 30 px semibold, small title 22 px, body 16 px. Follows the phone's font size setting.
- **Shapes and motion** (Material 3 Expressive): fully round buttons that briefly become rounded squares when pressed; the floating button grows and shrinks with a spring; pages fade and slide in; the processing step shows a wavy progress line.
- **Vibration**: a light tick for tab changes and pull to refresh; a firmer tap for starting, pausing, resuming and finishing a recording; a double buzz for errors.
- **Edge to edge**: the app draws under the status and navigation bars and pads its bars by the system insets.
- **Back gesture**: closes a sheet or menu first, then goes back a page, then returns to the Clinical Scribe tab; from the Clinical Scribe tab it leaves the app (a recording keeps running in the background).
- **Recording notification**: while recording: "Recording · 12:34" with **Pause**; while paused: "Paused · 12:34" with **Resume**. Tapping it opens the recorder. It disappears when the recording finishes.
- **App icon**: white waveform on the blue gradient, as an adaptive icon, plus a one-colour version for themed icons. **Launch screen**: the icon on the brand background (Android 12 and newer show it automatically).
- **Privacy**: the app's screens are hidden in the recent apps view, and screenshots of patient records are blocked.
- **Permissions**: before Android's own question, a short sheet explains why: "Clinical Scribe needs the microphone to record." and, for the notification, "Allow notifications to see and pause the recording when the screen is off." If the person refuses, the recorder explains how to allow it in Settings.

## 8. Responsive layout

| Width | App layout |
| --- | --- |
| Up to 380 px (small phones) | Record button 112 px; timer 48 px; tab labels stay, and long tab names take two lines; long titles wrap to two lines. |
| 381–899 px (phones, small tablets) | The design above. Content up to 640 px wide, centred. |
| 900 px and wider (tablets, windows) | Glass side bar with the four destinations (Clinical Scribe, Voice Note, Templates, History), Phone apps and Admin settings; content column up to 1120 px; sheets become centred dialogs; the mini recorder sits at the top of the side bar. |
| Landscape phones | Recorder controls sit beside the timer instead of under it; tab bar stays. |

Every screen is checked at 320, 360, 390, 402, 430, 768 and 1024 px widths, in portrait and landscape, with no sideways scrolling.

## 9. Getting the apps (website additions)

- **Phone apps** admin page (section 5.11).
- **On an iPhone or iPad**, the website shows a small dismissible glass bar at the bottom: "Get the iPhone app" with **Open**. It opens the iPhone web app's address, where the install screen (section 7.1) guides the person.
- **On an Android phone**, the same bar says "Get the Android app" with **Download**, when the app file is published with the site. After the download a sheet shows: "Open the downloaded file, then tap Install. If your phone asks, allow installs from your browser."
- The bar never appears inside the apps, never on computers, and stays hidden once dismissed.

## 10. Wording for the apps

All new text follows `design.md` section 11. The new phrases:

| Place | Text |
| --- | --- |
| Connect title, field, hint, button | Connect · Server link · Ask your administrator for this link. · Connect |
| Confirm | Connect to St Mary's Clinic? · Connect · Use another link |
| Connect errors | Enter the server link. · That link does not look right. Check it and try again. · Links must start with https://. · No Clinical Scribe server was found at that link. · The server cannot be reached. Check your internet connection and try again. · This server needs an update before the apps can connect. Ask your administrator. |
| More | Connected to · Change server · Version · Get version 1.3.0 (only when a newer Android app is published) · Sign out |
| Change server sheet | Change server? · You will be signed out of St Mary's Clinic on this phone. · Change server · Cancel |
| Recorder hints | Recording carries on when the screen is off. (Android) · Keep Clinical Scribe open while recording. (iPhone) |
| Notification | Recording · Paused · Pause · Resume |
| Permission sheets | Clinical Scribe needs the microphone to record. · Allow notifications to see and pause the recording when the screen is off. · Not now · Continue · Open Settings |
| Install screen | Add to Home Screen · the three steps in 7.1 · Continue in Safari |
| Website bar | Get the iPhone app · Get the Android app · Open · Download |
| Android download sheet | Open the downloaded file, then tap Install. If your phone asks, allow installs from your browser. |
| Offline | No internet connection. Recordings are kept on this phone and sent when you are back online. |
| Newer app | A newer version of the app is ready. · Download |
| Copy feedback | Copied |
| Recording tabs (1.5.0) | Clinical Scribe · Two or more people talking, like a consultation · Voice Note · Just you, dictating a note or a letter · New voice note · Start voice note · A Voice Note is being recorded · A Clinical Scribe recording is going on · One recording at a time. Finish it before you start another one. · Go to the recording |
| Templates (1.5.0) | Template Type · The Template Type stays as it was made. |

Words we never show: API, key (except "service key" on admin pages), endpoint, URL (we say "link" or "address"), JSON, token, session, cache, sync, debug, error codes, and sentences that explain what a page "is for".

## 11. Accessibility

- Everything in `design.md` section 10 applies.
- Touch targets: at least 48 × 48 px on Android and 44 × 44 px on iPhone; the record button is never smaller than 112 px.
- Gestures always have a visible alternative: swipe actions are also in the long-press menu and on the item's own page; pull to refresh also happens on returning to the tab.
- The sound ring and wavy line are decoration; screen readers hear the state ("Recording, 3 minutes 21 seconds") instead.
- Large text: layouts reflow up to 200 % text size; tab labels shorten never, they wrap or the bar grows.
- Reduced motion: no tab bar minimising, no breathing ring, no parallax; changes fade instead.
- Screen readers: tabs are a tab list with selected state; sheets are dialogs with a title; the mini recorder is a labelled region with its button.

## 12. What stays exactly the same

- The website's look and layout, its pages, its wording and its flows.
- The brand: colours, glass, aurora, icons, logo and fonts (the iPhone web app uses the system font for interface text only).
- Every rule about privacy prompts, confirmations, audit logging and plain language.
