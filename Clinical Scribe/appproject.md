# Clinical Scribe apps: project plan

This file is the technical plan for the two app versions of Clinical Scribe: the **Android app** and the **iPhone web app**. Their look is planned in `appdesign.md`. The server, database and website are described in `project.md`; this plan only adds to them.

## 1. What will be built

| Part | Result |
| --- | --- |
| App build of the web app | A second build of the same web app that has no server built in. On first start it asks for the server link, connects, and then offers every website function inside an app frame (tab bar, large titles, sheets, gestures). |
| iPhone web app | The app build published with the website at `<site>/app/`. People add it to the Home Screen from Safari. It works offline as an app shell and updates itself. |
| Android app | An installable Android app (APK) that contains the app build, made with Capacitor 8, plus a small native part in Java for recording with the screen off, safe sign-in storage, saving files and privacy. |
| Server additions | A public `connect` function that tells an app how to connect; the apps' sign-in return link; the Android app's origin for the server functions; a clinic name shown in the apps. |
| Website additions | A **Phone apps** page with the server link, QR code and downloads (admins only until 1.3.0, everyone from 1.4.0); a small "Get the app" bar on phones. |
| Deploy additions | Publishes `/app/`, writes `connect.json`, copies the Android app file into the site, sets the new server settings. |
| Android build workflow | A GitHub workflow that builds, checks and signs the Android app and (when asked) saves it in `Release/`. |

## 2. Choice of languages and tools

### 2.1 Shared interface: the existing web app

The apps reuse the existing web app: plain JavaScript modules built with Vite. Every screen, rule and server call already exists and is tested, so the apps get every website function from day one, and a fix in one place fixes all three versions. The app frame, themes and gestures are new modules in `web/src/app/` and `web/src/styles/app/`, loaded only by the app build.

### 2.2 Android: Capacitor 8 with a small Java plugin

| Option | Verdict |
| --- | --- |
| **Capacitor 8.5** (chosen) | Wraps the app build in a real Android app (Android 7 to Android 16, target SDK 36). Official plugins cover the app lifecycle and back gesture, the system bars and safe areas, vibration, the clipboard and the system browser. Our own native code is a small plugin. Build tools: JDK 21, Android Gradle Plugin 8.13, Gradle 8.14.3, Node 22. |
| Plain Android WebView in Kotlin | Possible, but every bridge, permission prompt, back gesture and inset fix would be written by hand. More code to secure and maintain. |
| Trusted Web Activity | Bound to one website address checked at build time. It cannot ask for a server link, so each clinic would need its own app. |
| React Native or Flutter | Every screen rewritten a second time; two code bases that drift apart. |
| Native Kotlin and Jetpack Compose | A full rewrite of every screen and rule. |

The native plugin is written in **Java 21**, like Capacitor's own Android library, so no Kotlin build plugin is needed.

### 2.3 iPhone: a Home Screen web app

A native iPhone app needs a Mac, Xcode, an Apple developer account and App Store review. The request is a web app that installs from the web, so the iPhone version is a Progressive Web App: a web app manifest, Apple's Home Screen tags, launch images and a service worker that keeps the app shell available offline. Since iOS 26, a site added to the Home Screen opens as a web app by default.

## 3. Connecting to a server (the server link)

### 3.1 What counts as a server link

Either of these, as the administrator gives it:

1. The address people use for Clinical Scribe in a browser, for example `https://name.github.io/General-Tools/` or `https://scribe.example.org/` (recommended; shown on the Phone apps page).
2. The server address itself, `https://<code>.supabase.co` (or a custom domain of the Supabase project).

### 3.2 Lookup

`web/src/lib/connection/lookup.js`:

1. **Tidy the link.** Trim it, add `https://` when no scheme is given, drop any query or `#` part, and make sure the path ends with `/`. Only `https` is accepted; plain `http` is accepted only for `localhost` and `127.0.0.1` (local testing), and the Android app blocks plain `http` anyway.
2. **Ask the site.** `GET <link>connect.json`. The deploy writes this file next to the website and next to the app.
3. **Ask the server.** If there is no `connect.json`, `GET <origin>/functions/v1/connect`.
4. **Check the answer** (`validate.js`), strictly:
   - `app` must be `"clinical-scribe"`;
   - `server_url` must be an `https` origin (no path, no user name or password);
   - `publishable_key` must be a publishable key (`sb_publishable_…`) or an older public key whose token says `role: anon`;
   - anything that looks like a secret key (`sb_secret_…`, a token with `role: service_role`) is refused and never stored;
   - `name` is optional plain text, at most 80 characters; `version` must look like `1.2.0`.
5. **Prove it works.** Call `get_public_config` on that server with that key. It must answer, and the server version must be 1.2.0 or newer.
6. **Confirm.** Show the clinic name (or the address) and wait for **Connect**.
7. **Save.** The connection (`server_url`, `publishable_key`, `name`, the link typed, the time) is saved on the device: `localStorage` in the iPhone web app, the Android app's private storage in the Android app. Up to five recent connections are kept.

Requests carry no credentials, follow no redirects to other sites (`redirect: "error"` for the server address), and time out after 15 seconds.

### 3.3 After connecting

- `web/src/lib/supabase.js` exports a live binding: the website creates the Supabase client from its built-in details at start; the app build creates it after the connection is chosen, before any other call. Each server gets its own sign-in storage name, so sessions never mix.
- **Change server** (More tab) is refused while audio is still being saved. Otherwise it asks once, signs out, and returns to Connect, which then shows the form and the recent servers instead of suggesting the same clinic again.
- **Connect links**: `io.github.albusthaw.clinicalscribe://connect?server=<link>` opens the Android app with the link filled in. The iPhone web app at `<site>/app/` fills in its own site. In both cases the person still confirms.
- **Versions**: a server older than 1.2.0 gets "This server needs an update before the apps can connect." The Android app compares its own version with the Android app published on the website (`android_app.version` in the site's `connect.json`), so it only offers an update that can really be downloaded: "Version 1.3.0 of the app is ready." with **Download**. The iPhone web app updates itself through its service worker.
- **Clinic name**: the confirm screen uses the name the server gives now (`get_public_config`), so a renamed clinic shows at once even when the site's `connect.json` was written earlier.

### 3.4 The server's answer

`supabase/functions/connect/index.ts` (public, `GET` only, `verify_jwt = false`):

```json
{
  "app": "clinical-scribe",
  "server_url": "https://abcdefghijklmnopqrst.supabase.co",
  "publishable_key": "sb_publishable_…",
  "name": "St Mary's Clinic",
  "version": "1.2.0",
  "site_url": "https://name.github.io/General-Tools/",
  "app_url": "https://name.github.io/General-Tools/app/"
}
```

The publishable key is public by design (it is already inside the website). The function reads it from the `CS_PUBLISHABLE_KEY` setting that the deploy saves (a secret key there is ignored), the website from `CS_SITE_URL`, the name and version from the database, and answers with `Access-Control-Allow-Origin: *`, `Cache-Control: max-age=300` and nothing else. The deploy writes the same details to `connect.json` in the site and in `/app/`; only the site's file also names the Android download (`android_app`: path, version and size), because that path is relative to the site.

## 4. Architecture

```
                          web/src (one code base)
                                   │
              ┌────────────────────┴─────────────────────┐
     site build (vite build)                  app build (vite build --mode app)
     server details built in                  no server details; asks for the server link
     website frame (unchanged)                app frame, iPhone and Android themes
              │                                          │
     <site>/  (GitHub Pages or own host)      ┌──────────┴──────────────┐
                                              <site>/app/          Android app (Capacitor)
                                              iPhone web app       app build + Java plugin
```

### 4.1 Build modes

- `vite build` makes the website exactly as today.
- `vite build --mode app --outDir dist/app` makes the app build. `import.meta.env.MODE === "app"` switches on the app start-up; the website build leaves all app modules out (they are imported only behind that check, so Vite drops them).
- The app build's page has its own Content Security Policy (`connect-src 'self' https: wss:` because the server is chosen at run time), its own manifest (`id`, `scope` and `start_url` of `./`), Apple Home Screen tags, launch images and a generated service worker.

### 4.2 Folders and modules

```
Clinical Scribe/
├── appdesign.md, appproject.md
├── android/                         Android app project (Capacitor 8, Java), committed
│   ├── app/src/main/AndroidManifest.xml
│   ├── app/src/main/java/io/github/albusthaw/clinicalscribe/
│   │   ├── MainActivity.java         hides screens from recents and screenshots; registers the plugin
│   │   ├── ScribeNativePlugin.java   bridge methods used by the app build
│   │   ├── RecordingService.java     foreground service (microphone) with Pause/Resume notification
│   │   ├── RecordingNotification.java builds the notification text and actions
│   │   ├── SecureStore.java          sign-in storage encrypted with an Android Keystore key
│   │   └── LinkRules.java            checks connect and sign-in return links
│   ├── app/src/main/res/             adaptive icon, monochrome icon, notification icon, splash, network rules
│   │   ├── FileSaver.java            writes a file to the place picked in "Save to…", in parts
│   │   └── RecordingText.java        the time shown in the notification
│   ├── app/src/test/java/…           JVM unit tests for LinkRules, RecordingText and FileSaver rules
│   └── build.gradle, settings.gradle, variables.gradle, gradle wrapper
├── build/
│   ├── android/build-apk.mjs         app build → Capacitor sync → Gradle (tests, lint) → align → sign → checks → Release/
│   ├── android/signing.mjs           signing key handling (kept key, new key, or a one-time key)
│   ├── android/package-check.mjs     checks on the finished app (id, version, permissions, settings, files)
│   ├── android/release-file.mjs      the Android part of Release/README.txt
│   ├── deploy/phone-apps.mjs         connect files, Android download and server settings for the apps
│   └── make-icons.mjs                also draws the Android legacy icons and the iPhone launch images
├── supabase/functions/connect/       public connection details
├── web/
│   ├── capacitor.config.json         app id, app name, web folder, Android project path
│   ├── public-app/                   app-only files: manifest, launch images
│   └── src/
│       ├── app/                      app start-up, connect screens, app frame, More tab, install screen,
│       │                             sheets, swipe rows, pull to refresh, large titles, floating button,
│       │                             mini recorder, offline bar, update notice, permission sheets
│       ├── lib/connection/           link tidying, lookup, answer checks, saved connections
│       ├── lib/platform/             platform detection, native bridge wrappers, files, clipboard,
│       │                             sign-in storage, app hooks used by shared screens
│       ├── views/phone-apps.js       the Phone apps page, for everyone (website and apps)
│       └── styles/app/               app frame, iPhone theme, Android theme, app components
└── Release/clinical-scribe.apk       the built Android app (saved by the workflow)
```

No file grows into a "god file": the app frame, each gesture, each sheet type and each platform adapter is its own module, and the shared screens only gain small, optional hooks.

### 4.3 How shared screens get app features

`web/src/lib/platform/hooks.js` exports one object, `appHooks`, that is empty in the website. The app start-up fills it. Shared screens call the hooks only when present:

| Hook | Called by | App behaviour |
| --- | --- | --- |
| `decorateDialog(dialog)` | `components/dialog.js` | Turns the dialog into a sheet with a grabber and drag to close |
| `enhanceList(list, { onRefresh, rowActions })` | History, Templates, People, Audit log | Pull to refresh, swipe actions, long-press menu |
| `recorderExtras(card)` | `views/scribe/record.js` | Adds the sound ring and the one-hand recorder layout |
| `enhancePicker(select, { title })` | `views/scribe/record.js` | A long choice (the note template) opens a sheet; with 7 or more choices it has a search field |
| `pageAction(button)` | Templates | The page's main button moves to the top bar ("+" on iPhone) or the floating button (Android) |
| `beforeRecording()` | `views/scribe/record.js` | Android: explains and asks for the microphone, then notifications |
| `copied(button)` | copy buttons | The button turns into a green "Copied" tick instead of a toast |
| `saveFile(blob, name)` | CSV export, audio download | Android: the system "Save to…" screen; the file is sent in parts of 768 KB |
| `copyText(text)` | `lib/clipboard.js` | Android: native clipboard |
| `startGoogleSignIn()` | sign-in screen | Android: system browser and return link |
| `haptic(kind)`, `openExternal(url)` | app frame, update notice | Android: short vibrations; https links open in the phone's browser |

The Android recording notification is not a hook: `app/native/recording.js` watches the recorder itself and starts, updates and stops the notification (and keeps the screen awake until the last part is uploaded). The recording label is never sent to Android.

### 4.4 Platform detection

`lib/platform/detect.js` decides once at start: `android` inside the Capacitor app (`Capacitor.getPlatform() === "android"`), `ios` on iPhone and iPad (including iPadOS that reports itself as a Mac but has touch), otherwise `web`. The result sets `data-platform` and `data-standalone` on the page, which select the theme. The iPhone theme also applies to the app build in iPhone Safari; the install screen shows there until the web app runs from the Home Screen.

## 5. Native features

| Feature | Android app | iPhone web app |
| --- | --- | --- |
| Recording with the screen off | The app's own recorder (section 5.1) in a foreground service of type microphone, with a wake lock and a notification showing the time and Pause/Resume. The screen may turn off as usual. | iOS mutes web apps when the phone locks, so **Screen off** turns the screen black with touches locked while the phone stays awake (section 5.1). If the phone locks anyway, the recording pauses. |
| Keep the screen awake | Not needed | Screen Wake Lock while recording; Screen off mode |
| Calls and other sound | Pause (never stop): audio focus lost, phone or internet call, microphone silenced by the system | Pause (never stop): audio session interrupted, microphone muted or ended, phone locked |
| Microphone permission | Explained first, then Android's prompt; "Open Settings" if refused | Safari's prompt (asked again in each session) |
| Notifications permission | Asked before the first recording (Android 13+) | Not used |
| Sign-in storage | Encrypted with a non-exportable AES-256-GCM key in the Android Keystore | Local storage, as the website |
| Google sign-in | System browser (Custom Tab) with PKCE, back to the app through `io.github.albusthaw.clinicalscribe://auth` | Same as the website, returning to `/app/` |
| Saving files (audit CSV, audio) | System "Save to…" picker | Browser download |
| Copy | Native clipboard | Browser clipboard |
| Vibration | Light, medium and error patterns | Not available on iPhone |
| Back gesture | Closes sheets, goes back, then leaves the app | iPhone back swipe in the web app |
| Privacy in recent apps | Screens hidden, screenshots blocked (`FLAG_SECURE`) | Not available on iPhone |
| Offline | App shell is inside the app | Service worker keeps the app shell |
| Updates | "A newer version of the app is ready" with a download link | Service worker updates on the next start |

### 5.1 Recording that never stops (1.3.0)

**Rule for every app and the website:** a call, other sound, a lost microphone or a locked phone never ends a recording. The recording pauses, keeps everything recorded so far, says why, and continues with **Resume**. Only Finish and Discard end it. Resume is always the person's choice, so nothing is recorded that they did not expect.

**Android: the app records by itself.** The page no longer records through the web view. `AudioPartRecorder.java` reads the microphone with `AudioRecord` (44.1 kHz mono), encodes AAC (48 kbps) with `MediaCodec` and writes ADTS files, one per part (`Adts.java`, `PartFiles.java`: `recordings/<recording id>/0001.aac`). Each frame is written as it is made, so a part survives a crash up to its last frame; a new part starts at a frame boundary, so nothing is lost between parts. It runs in the foreground service (type microphone, kept when the app is swiped away) with a partial wake lock that never outlasts the recording limit, so it carries on with the screen off. `RecorderHub.java` holds the one live recording: state, pause reasons, the time recorded, the recording limit, the notification and the observers. The microphone and encoder are opened before the service starts, and nothing is written until both are ready.
- The page collects finished parts (`recorderPart` events, and a full check when the app is shown again) and reads each part in 768 KB pieces into the same upload queue (IndexedDB) as the website. A part file is deleted only after the queue has stored it. The server already accepts `audio/aac`.
- **Pause** and **Resume** in the notification act on the recorder directly, even while the page is asleep.
- After the page was closed (the system may close it in the background), the next start takes up the recording that is still running, or finishes it when it ended meanwhile. Parts left by a crash are queued for their owner on the next start; parts nobody on the phone can save any more are removed.
- The recording limit (longest recording, minutes left) is also kept by the recorder, so it stops on time with the screen off.
- Signing out ends the recording on the phone and removes its audio, as the sign-out warning says.

**Android interruptions** (`Interruptions.java`, `PauseRules.java`): the recorder holds audio focus while recording. Losing it (a call ringing, music, video, an alarm, voice commands) pauses with the reason "call" or "other sound". The phone's audio mode (ringing, in a call, in an internet call) also pauses, and on Android 10 and newer so does a microphone silenced by the system. Resume is refused while a call is going on. Short notification sounds only lower other sound, so they do not pause.

**Web and iPhone interruptions** (`lib/recorder/web-capture.js`): the Audio Session API (type `play-and-record` while recording; state "interrupted"), a muted or ended microphone track, and on iPhone the page being hidden (iOS stops the microphone of web apps when the phone locks) pause the recording. After an interruption, Resume keeps the paused part as it is, opens the microphone again when it is not working, and starts a new part; Resume after the person's own pause carries on in the same part. Sound played by Clinical Scribe itself (any audio or video element) pauses the recording everywhere, the Android app included.

**iPhone Screen off** (`app/screen-off.js`): iOS lets no web app use the microphone while the phone is locked (WebKit stops capture; Safari 27 keeps this rule). **Screen off** keeps the app in front instead:
- a black screen (the pixels of OLED iPhones are then off, so it looks like a dark screen and saves power);
- touches do nothing, so a pocket cannot press anything; press and hold for about a second to come back (the finger lifting afterwards presses nothing);
- the screen wake lock keeps the phone from locking (iOS 18.4 and newer in Home Screen web apps). On older iOS, or when the request fails (for example in Low Power Mode), the dark screen says how to stop the phone locking;
- a dim timer shows the recording is running and moves every minute so it never marks the screen;
- it ends by itself when the recording pauses or finishes, so the reason is shown at once;
- if motion access is allowed (asked once, the first time Screen off is tapped), laying the phone face down while recording turns the screen dark by itself.
The same button is offered in Android browsers. The Android app does not need it.

**Recorder modules (web):** `lib/recorder/recorder.js` keeps the flow (server, limits, upload queue, pause reasons, taking up a phone recording); a *capture* records: `web-capture.js` (MediaRecorder parts and 5-second pieces in IndexedDB) or, in the Android app, `app/native/native-capture-core.js`. `lib/recorder/capture-rules.js` holds the pause reasons and their wording. Both captures get their outside parts passed in, so they are tested without a browser or a phone.

## 6. Security gates

1. **No secrets in the apps.** The app build contains no server address or key. The publishable key arrives at run time and is public by design. Service keys stay in Supabase Vault as before; nothing about the server model changes.
2. **Strict connection checks** (section 3.2): `https` only, answers checked field by field, secret keys refused, the clinic shown before connecting.
3. **No injection.** The app frame builds the page from DOM nodes with `textContent`, like the website; never `innerHTML` with data. The app build's Content Security Policy allows scripts, styles and fonts only from the app itself. Server data stays behind Row Level Security and typed SQL functions.
4. **Android WebView locked down.** No file or content access from web pages, no mixed content, web debugging off in release builds, navigation limited to the app itself (other links open in the system browser), no plain `http` traffic (`usesCleartextTraffic=false` and a network security config that trusts only system certificates).
5. **Links into the app are checked.** `LinkRules` accepts only `…://connect?server=https://…` (fills the form, never connects by itself) and `…://auth?code=…` (only while a Google sign-in started by the app is waiting; the PKCE code verifier never leaves the phone, so an intercepted code is useless).
6. **Sign-in storage encrypted** on Android with a Keystore key that never leaves the phone's secure hardware. `allowBackup=false` and data extraction rules keep it out of backups and device transfers.
7. **Privacy on screen.** `FLAG_SECURE` hides the app in recent apps and blocks screenshots on Android.
8. **The recording service runs only while recording**, is started only from a visible app after the microphone is allowed, and stops when the recording ends.
9. **Server side.** The `connect` function returns only public values and changes nothing. The Android app's origin (`https://localhost`) is added to the allowed origins of the server functions; every call still needs a valid sign-in. The sign-in return list gains only the app's own return link.
10. **Signed Android app.** Release builds are signed with the owner's key kept in GitHub secrets (section 7.3), never in the repository. Builds without the key use a one-time key and say so.
11. **Service worker scope.** The iPhone web app's service worker caches only the app's own files and never touches server requests, so no patient data is ever cached by it.

## 7. Building and releasing

### 7.1 Versions

- `VERSION` stays the single version: the website, the server, the app build and the Android app all show it.
- Android `versionName` = `VERSION`; `versionCode` = major × 10000 + minor × 100 + patch (1.2.0 → 10200).
- App id: `io.github.albusthaw.clinicalscribe` (based on the owner's GitHub Pages address).

### 7.2 Android build

`node build/android/build-apk.mjs`:

1. `vite build --mode app` into `web/dist/app`.
2. `npx cap copy android` puts the app build into the Android project.
3. `gradlew :app:assembleRelease :app:testReleaseUnitTest :app:lintRelease`.
4. Aligns the file and signs it with `apksigner` (v2 and v3 signatures; v1 is not needed from Android 7).
5. Checks the signature, the package details (`aapt2 dump badging`: app id, version and version code, Android levels, exactly the expected permissions, not debuggable), the compiled settings (no backups, no plain http, network rules present) and the files inside (app pages present; no source maps, iPhone launch images, settings or key files). The app pages are also checked for secrets before they are bundled.
6. Copies the result to `Release/clinical-scribe.apk` and writes how it was built (version, size, SHA-256, kind of key, date) at the end of `Release/README.txt`. The deploy reads the version from there.

Needs JDK 21, Node 22 and the Android SDK (platform 36, build tools 36). GitHub's Ubuntu runners have all of them.

### 7.3 Signing key

- Release builds are signed with a key stored in two GitHub secrets: `ANDROID_SIGNING_KEY` (the key text) and `ANDROID_SIGNING_PASSWORD` (at least 16 characters, one line, not trivially simple).
- The key text is the PKCS12 key file encrypted with the password: scrypt (N = 2^17, r = 8, p = 1) makes an AES-256-GCM key, and the text reads `CSK1.<salt>.<iv>.<sealed>`. A plain base64 PKCS12 file made elsewhere is accepted too. Because the repository is public and run downloads are visible to signed-in GitHub users, the key never leaves the run unencrypted.
- First time: the owner adds only `ANDROID_SIGNING_PASSWORD` and runs the workflow. It creates a key (RSA 4096, valid 30 years) protected by that password, signs the app with it, and offers the key text as a one-day download from the run page with steps to save it as `ANDROID_SIGNING_KEY`. Later builds use the saved key, so phones accept updates; a build with the kept key gives the same signing certificate every time.
- The key file exists only in a private temporary folder during the build and is deleted afterwards. Passwords reach `keytool` and `apksigner` through environment values, never on the command line or in the log.
- With no secrets at all, the workflow still builds a working app signed with a one-time key and says that installing a later build will need the old app removed first.

### 7.4 Workflow

`.github/workflows/clinical-scribe-android.yml` ("Build Clinical Scribe Android app"):
- Runs when the web app or the Android project changes (build and checks only) and on demand.
- On demand, an option saves the signed app to `Clinical Scribe/Release/clinical-scribe.apk` on the same branch.
- Keeps the app file as a download on the run page.

### 7.5 Deploy

`node build/deploy/deploy.mjs` (and the deploy workflow) also:
- builds the app into `web/dist/app` with the same version;
- writes `connect.json` to `web/dist/` and `web/dist/app/`;
- copies `Release/clinical-scribe.apk` to `web/dist/downloads/clinical-scribe.apk` when it exists (and refuses a file that is not an app);
- saves `CS_PUBLISHABLE_KEY` and `CS_SITE_URL` for the `connect` function, adds `https://localhost` to `CS_ALLOWED_ORIGINS`, and adds the app's return link to the sign-in settings (also when no website address is given);
- deploys the `connect` function with the others.

## 8. Server and website changes

| Change | Where |
| --- | --- |
| `connect` function | `supabase/functions/connect/`, with its pure answer builder in `_shared/connect.ts` |
| Clinic name (`app_settings.clinic_name`, at most 80 characters), set with `admin_set_clinic_name` (audited) and returned by `get_public_config` | New migration `20261004090000_phone_apps.sql` (adds only) |
| App origin allowed by the server functions | Deploy (`CS_ALLOWED_ORIGINS`) |
| App return link allowed for Google sign-in | Deploy (`signInPatch`) and the Google sign-in admin handler |
| Phone apps page with QR code | `web/src/views/phone-apps.js`, QR drawing with a small vetted library |
| "Get the app" bar on phones | `web/src/views/get-app.js`, website only |
| Downloads for host headers | `connect.json` allowed for every origin in `web/public/_headers` and `web/vercel.json` |

## 9. Testing

| Group | What it checks |
| --- | --- |
| Unit (Node) | Link tidying, lookup order and problems (offline, not found, too old, secret key), answer checks, the server's clinic name winning, version rules, platform detection, connect and return links, recent servers, the published Android app, saving files in parts on Android, the signing key text and plan, the checks on the finished Android app, the Release notes, the deploy's connect files and header files; recording from the browser with stand-ins (parts handed on, a muted or stopped microphone, a locked iPhone and the audio session pausing with a reason, Resume opening the microphone again), the Android app's recorder seen from the page with a stand-in phone (start settings, parts read in pieces and removed only after queueing, pauses and endings passed on, Resume refused during a call, parts left after a crash), the pause messages and the Screen off rules, the Vibration switch rules (on at first, kept on the phone, nothing vibrates while off) |
| Server functions (Deno) | The `connect` answer builder gives only public values and never takes a secret key for a public one |
| Server (local stack) | `connect` answers with the publishable key, version and site for any address and only answers reading; clinic name saved, audited once, admin only, odd names refused |
| Deploy (local stack) | The secrets for the apps (`CS_PUBLISHABLE_KEY`, `CS_SITE_URL`, the Android app's origin) and the app's return link are saved, and existing sign-in settings are kept |
| Browser (Playwright) | App build at `/app/`: iPhone in Safari (install steps, the clinic found from the site, link errors, connect, sign in, every tab, the "+" button in the top bar) and from the Home Screen (no install steps, every admin page with the back button, Phone apps with the QR code); Phone apps in More for people who are not admins, without the clinic name, and no Vibration switch outside the Android app; Android look (recording with the mini recorder on other tabs, swipe and long-press rename, pull to refresh, floating button, every tab at 320 px without sideways scrolling, Change server with the recent servers); the website's phone offer on iPhone and Android; recording on an iPhone with Screen off (a tap does nothing, press and hold comes back, a locked screen and a call pause it with the reason, Resume carries on); on the website, a stopped microphone and sound played by the app pause the recording, Resume opens the microphone again and the note is still made; no unexpected console errors. The Android look runs in Chrome on Android, which uses the same pages and frame as the Android app; the parts that need Android itself are covered by the Android checks and the real-phone list below |
| Android (Gradle and the build script) | Java unit tests (links, notification time, file rules, ADTS frames and scanning of cut or broken parts, part files and their limits, pause reasons for calls and other sound); the recorder itself on a stand-in phone (Robolectric, Android 16 and 11): whole parts until stopped, the wake lock only while recording, a ringing call, other sound and an internet call pausing with the reason, Resume waiting for a call to end, short sounds not pausing, a lost microphone opened again, the limit stopping by itself, Discard removing everything, the notification texts and the service; Android lint with no issues, release build, signature, a second build with the kept key giving the same certificate, package details, compiled settings and files |
| On a real phone (cannot run here: no emulator in this environment) | Install, record with the screen off for a long time, a call and music during a recording (pause, then Resume), Pause/Resume from the notification, swiping the app away while recording, Screen off and face down on an iPhone, Google sign-in round trip, Save to… screen, back gesture, updates over an older copy |

## 10. Build order

1. Plans: `appdesign.md`, `appproject.md` (this file).
2. Connection layer, live Supabase client, app build mode, platform detection, app hooks. Unit tests.
3. App frame and themes: tab bar, large titles, sheets, gestures, mini recorder, More tab, connect screens, install screen, offline and update notices. Browser tests.
4. Server: migration, `connect` function, Google sign-in return link, Phone apps page, "Get the app" bar. Server tests.
5. Android project: Capacitor, plugin, service, secure storage, links, icons, splash, signing script, local build and checks.
6. Deploy changes, Android workflow, deploy tests.
7. Full test run, documentation (README "Phone apps" section, `Release/README.txt`), version 1.2.0, commits, push, Android app build.

## 11. Known limits

- **iPhone**: a web app cannot record while the phone is locked or another app is open (an iOS rule). The recording then pauses and keeps everything; Screen off is the way to record with a dark screen. The microphone is asked again in each session; no vibration; no screenshot protection.
- **Android phones with strict battery savers** (some brands) may still stop apps in the background. The README says how to allow Clinical Scribe to run.
- **Android installs outside Google Play**: from 30 September 2026, Brazil, Indonesia, Singapore and Thailand allow such installs only from developers verified with Google (more countries from 2027). Publishing widely may need the owner to register as a developer with Google; Google Play publishing is not part of this work.
- **Testing**: this environment has no Android emulator or iPhone, so the checks marked "real phone" in section 9 must be done on a device.
