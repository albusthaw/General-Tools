Clinical Scribe - Release folder

Clinical Scribe is a web app that runs on your own Supabase project, so there is
no program file to download. It is published instead:

  - The server part (database, server functions and settings) goes to your
    Supabase project.
  - The web app is built into "web/dist" and published on GitHub Pages, or on
    any static web host you choose.

How it is published:
  - GitHub Actions: the workflow "Deploy Clinical Scribe" does everything in one
    run, started by hand from the Actions tab. Running it again installs an
    upgrade.
  - On a computer: node build/deploy/deploy.mjs  (from the Clinical Scribe folder).

The version number is in the VERSION file. README.md explains every step.
