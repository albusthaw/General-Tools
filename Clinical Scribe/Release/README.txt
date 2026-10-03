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
  Version 1.4.0 (code 10400), 3.7 MB
  SHA-256 17c6d9c5f046237077e55c12f6668af77535e0b94f7fe63ffbc14802157427cf
  Signed with the kept signing key, so it installs over earlier copies.
  Built on 2026-10-03 with: node build/android/build-apk.mjs
