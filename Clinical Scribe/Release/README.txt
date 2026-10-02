Clinical Scribe - Release folder

Clinical Scribe is a web app that runs on your own Supabase project. It is
published, not installed from this folder:

  - The server part (database, server functions and settings) goes to your
    Supabase project.
  - The web app, with the iPhone web app in its "app" folder, is built into
    "web/dist" and published on GitHub Pages, or on any static web host.

How it is published:
  - GitHub Actions: the workflow "Deploy Clinical Scribe" does everything in one
    run, started by hand from the Actions tab. Running it again installs an
    upgrade.
  - On a computer: node build/deploy/deploy.mjs  (from the Clinical Scribe folder).

The Android app is the one built file in this folder: clinical-scribe.apk.
It is made by the workflow "Build Clinical Scribe Android app" (or on a
computer with: node build/android/build-apk.mjs), and the deploy publishes it
with the website. The lines below say how this copy was built.

The version number is in the VERSION file. README.md explains every step.

Android app: clinical-scribe.apk
  Version 1.2.0 (code 10200), 3.6 MB
  SHA-256 dc67c669a93bba86183f42eab90db0e7a42026298b47a47648763ff88c7a2c24
  Signed with a new signing key. Keep the key (see README.md) so later copies install over this one.
  Built on 2026-10-02 with: node build/android/build-apk.mjs
