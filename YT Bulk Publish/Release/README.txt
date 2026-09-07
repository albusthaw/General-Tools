YT Bulk Publish - Release folder

"YT Bulk Publish.exe" in this folder is the finished Windows program. It needs
no installation: copy it anywhere and double-click it. Windows 10 or 11 with
the Microsoft Edge WebView2 runtime (included with Windows) and Google Chrome,
Microsoft Edge or Brave installed.

How the file is produced:
  - GitHub Actions: the workflow "Build YT Bulk Publish (Windows EXE)" builds it
    on a Windows runner whenever the tool's source changes (or when started by
    hand from the Actions tab) and commits the result here.
  - On Windows: double-click  build\build_release.bat  in the tool folder.

Starting the program with  --check  loads every part without opening a window
and writes  startup-check.txt  next to it. The build uses this to prove the
program works before the file is committed.

See Global instruction\release.md for details.
