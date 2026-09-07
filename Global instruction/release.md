# Release rules

## Where builds go

Each tool has a `Release/` folder. The built program (for Windows tools, a single `.exe`) is written there by the tool's build script. Nothing else belongs in `Release/` except a short `README.txt` that says how the program was built.

## Building a Windows program

Windows programs are built with PyInstaller, on Windows. PyInstaller cannot make a Windows EXE from Linux or macOS, so building is a Windows-only step.

For `YT Bulk Publish`:

1. Install Python 3.10 or newer from python.org and tick "Add python.exe to PATH".
2. Double-click `YT Bulk Publish\build\build_release.bat` (or run `python build\build_release.py` from the tool folder).
3. The script creates a private environment, installs `requirements.txt`, draws the icon and runs PyInstaller with `build\yt_bulk_publish.spec`.
4. The result is `YT Bulk Publish\Release\YT Bulk Publish.exe`.

Before building, run the tests from the tool folder:

```
python -m unittest discover -s tests
```

## Version numbers

- Each tool keeps its version in one place in code (for `YT Bulk Publish`: `APP_VERSION` in `app/settings.py`).
- Use `major.minor.patch`. Raise `patch` for fixes, `minor` for new options, `major` for a changed workflow.
- Tag releases in git as `<tool-short-name>-v<version>`, for example `ytbp-v1.0.0`.

## Release notes

Add a short "What changed" list to the tool README under a **Changes** heading for each version: three to eight lines in plain language.

## Committing built files

A built EXE may be committed to `Release/` when the repository owner wants a ready-to-run copy in the repository. Prefer attaching the EXE to a GitHub Release when the file grows past a few tens of megabytes. Never commit the `build/work` folder or a `.venv` folder.

## Checks before a release

- Tests pass.
- The program starts on a clean Windows machine that has only the Microsoft Edge WebView2 runtime (included with Windows 10 and 11).
- No passwords, tokens or browser profile data are inside the build folder or the repository.
