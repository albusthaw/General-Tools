# Clinical Scribe apps: project plan

This file is the technical plan for the two app versions of Clinical Scribe: the **Android app** and the **iPhone web app**. Their look is planned in `appdesign.md`. The server, database and website are described in `project.md`; this plan only adds to them.

## 1. What will be built

| Part | Result |
| --- | --- |
| App build of the web app | A second build of the same web app that has no server built in. On first start it asks for the server link, connects, and then offers every website function inside an app frame (tab bar, large titles, sheets, gestures). |
| iPhone web app | The app build published with the website at `<site>/app/`. People add it to the Home Screen from Safari. It works offline as an app shell and updates itself. |
| Android app | An installable Android app (APK) that contains the app build, made with Capacitor 8, plus a small native part in Java for recording with the screen off, safe sign-in storage, saving files and privacy. |
| Server additions | A public `connect` function that tells an app how to connect; the apps' sign-in return link; the Android app's origin for the server functions; a clinic name shown in the apps. |
| Website additions | A **Phone apps** admin page with the server link, QR code and downloads; a small "Get the app" bar on phones. |
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
- **Change server** (More tab) is refused while audio is still being saved, signs out locally, clears the recording queue for that server, and returns to Connect.
- **Connect links**: `io.github.albusthaw.clinicalscribe://connect?server=<link>` opens the Android app with the link filled in. The iPhone web app at `<site>/app/` fills in its own site. In both cases the person still confirms.
- **Versions**: the app compares its version with the server's. Server older than 1.2.0: "This server needs an update before the apps can connect." App older than the server's minor version (Android): "A newer version of the app is ready." with a download link to `<site>/downloads/clinical-scribe.apk`. The iPhone web app updates itself through its service worker.

### 3.4 The server's answer

`supabase/functions/connect/index.ts` (public, `GET` only, `verify_jwt = false`):

```json
{
  "app": "clinical-scribe",
  "server_url": "https://abcdefghijklmnopqrst.supabase.co",
  "publishable_key": "sb_publishable_…",
  "name": "St Mary's Clinic",
  "version": "1.2.0",
  "app_url": "https://name.github.io/General-Tools/app/"
}
```

The publishable key is public by design (it is already inside the website). The function reads it from the `CS_PUBLISHABLE_KEY` setting that the deploy saves, the name and version from the database, and answers with `Access-Control-Allow-Origin: *`, `Cache-Control: max-age=300` and nothing else. The deploy writes the same content to `connect.json` in the site and in `/app/`.

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
│   ├── app/src/test/java/…           JVM unit tests for LinkRules and RecordingNotification
│   └── build.gradle, settings.gradle, variables.gradle, gradle wrapper
├── build/
│   ├── android/build-apk.mjs         app build → Capacitor copy → Gradle → sign → verify → Release/
│   ├── android/signing.mjs           signing key handling (secrets or a temporary key)
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
│       ├── views/admin/phone-apps.js the Phone apps admin page (website and apps)
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
| `onRecordingState(state)` | `lib/recorder/recorder.js` | Starts, updates and stops the Android recording notification; keeps the screen awake |
| `saveFile(blob, name)` | CSV export, audio download | Android: the system "Save to…" picker |
| `copyText(text)` | `lib/clipboard.js` | Android: native clipboard |
| `startGoogleSignIn()` | sign-in screen | Android: system browser and return link |

### 4.4 Platform detection

`lib/platform/detect.js` decides once at start: `android` inside the Capacitor app (`Capacitor.getPlatform() === "android"`), `ios` on iPhone and iPad (including iPadOS that reports itself as a Mac but has touch), otherwise `web`. The result sets `data-platform` and `data-standalone` on the page, which select the theme. The iPhone theme also applies to the app build in iPhone Safari; the install screen shows there until the web app runs from the Home Screen.

## 5. Native features

| Feature | Android app | iPhone web app |
| --- | --- | --- |
| Recording with the screen off | Foreground service of type microphone, started while the app is open, with a notification showing the time and Pause/Resume. Stops on finish, discard or sign-out. | Not possible on iPhone; the screen is kept awake and the recorder asks to keep the app open. |
| Keep the screen awake | `FLAG_KEEP_SCREEN_ON` while recording | Screen Wake Lock |
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
4. Signs with `apksigner` (v2 and v3 signatures), then checks the signature and the package details (`aapt2 dump badging`): app id, version, permissions, no debuggable flag.
5. Copies the result to `Release/clinical-scribe.apk`.

Needs JDK 21, Node 22 and the Android SDK (platform 36, build tools 36). GitHub's Ubuntu runners have all of them.

### 7.3 Signing key

- Release builds are signed with a key stored in two GitHub secrets: `ANDROID_SIGNING_KEY` (the key file, base64) and `ANDROID_SIGNING_PASSWORD` (at least 16 characters).
- First time: the owner adds only `ANDROID_SIGNING_PASSWORD` and runs the workflow. It creates a key protected by that password, signs the app with it, and offers the key file as a one-day download from the run page with steps to save it as `ANDROID_SIGNING_KEY`. Later builds use the saved key, so phones accept updates.
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
- copies `Release/clinical-scribe.apk` to `web/dist/downloads/clinical-scribe.apk` when it exists;
- saves `CS_PUBLISHABLE_KEY` for the `connect` function, adds `https://localhost` to `CS_ALLOWED_ORIGINS`, and adds the app's return link to the sign-in settings;
- deploys the `connect` function with the others.

## 8. Server and website changes

| Change | Where |
| --- | --- |
| `connect` function | `supabase/functions/connect/`, with its pure answer builder in `_shared/connect.ts` |
| Clinic name (`app_settings.clinic_name`, at most 80 characters), set with `admin_set_clinic_name` (audited) and returned by `get_public_config` | New migration `20261004090000_phone_apps.sql` (adds only) |
| App origin allowed by the server functions | Deploy (`CS_ALLOWED_ORIGINS`) |
| App return link allowed for Google sign-in | Deploy (`signInPatch`) and the Google sign-in admin handler |
| Phone apps admin page with QR code | `web/src/views/admin/phone-apps.js`, QR drawing with a small vetted library |
| "Get the app" bar on phones | `web/src/views/get-app.js`, website only |
| Downloads for host headers | `connect.json` allowed for every origin in `web/public/_headers` and `web/vercel.json` |

## 9. Testing

| Group | What it checks |
| --- | --- |
| Unit (Node) | Link tidying, lookup order, answer checks (secret keys refused), version rules, platform detection, connect and return link parsing, "Get the app" rules, app hooks |
| Server functions (Deno) | The `connect` answer builder never includes anything but public values |
| Server (local stack) | `connect` answers with the publishable key, name and version, for any origin; clinic name saved and audited; admin-only; app origin accepted by the admin function |
| Deploy (local stack) | `connect.json` in site and app, app build present, APK copied when present, `CS_PUBLISHABLE_KEY` and the app origin saved, the return link added, the `connect` function deployed |
| Browser (Playwright) | App build at `/app/`: connect flow with errors and confirm, recent servers, sign in, every tab and admin page inside the app frame; iPhone theme at iPhone sizes (floating tab bar, large titles, install screen in Safari, none when standalone); Android theme through a test stand-in for the native bridge (sheets, swipe actions, pull to refresh, floating button, mini recorder while recording, back gesture, change server); no sideways scrolling from 320 px, no console errors; the website unchanged apart from the phone bar |
| Android (Gradle) | Java unit tests, Android lint, release build, signature check, package details (app id, version, permissions, not debuggable, no plain http) |
| On a real phone (cannot run here: no emulator in this environment) | Install, record with the screen off, Pause/Resume from the notification, Google sign-in round trip, Save to… picker |

## 10. Build order

1. Plans: `appdesign.md`, `appproject.md` (this file).
2. Connection layer, live Supabase client, app build mode, platform detection, app hooks. Unit tests.
3. App frame and themes: tab bar, large titles, sheets, gestures, mini recorder, More tab, connect screens, install screen, offline and update notices. Browser tests.
4. Server: migration, `connect` function, Google sign-in return link, Phone apps page, "Get the app" bar. Server tests.
5. Android project: Capacitor, plugin, service, secure storage, links, icons, splash, signing script, local build and checks.
6. Deploy changes, Android workflow, deploy tests.
7. Full test run, documentation (README "Phone apps" section, `Release/README.txt`), version 1.2.0, commits, push, Android app build.

## 11. Known limits

- **iPhone**: recording stops if the screen locks or another app is opened (an iOS rule for web apps); the microphone is asked again in each session; no vibration; no screenshot protection.
- **Android installs outside Google Play**: from 30 September 2026, Brazil, Indonesia, Singapore and Thailand allow such installs only from developers verified with Google (more countries from 2027). Publishing widely may need the owner to register as a developer with Google; Google Play publishing is not part of this work.
- **Testing**: this environment has no Android emulator or iPhone, so the checks marked "real phone" in section 9 must be done on a device.
