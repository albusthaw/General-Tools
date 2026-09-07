"""Build the Windows program into the Release folder.

    python build/build_release.py

Runs PyInstaller with the recipe in build/yt_bulk_publish.spec. Windows only:
PyInstaller cannot produce a Windows EXE from another operating system.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / "Release"
WORK = ROOT / "build" / "work"


def main() -> int:
    if sys.platform != "win32":
        print("The EXE has to be built on Windows. Run build\\build_release.bat there.")
        return 1
    icon = ROOT / "build" / "icon.ico"
    if not icon.exists():
        subprocess.run([sys.executable, str(ROOT / "build" / "make_icon.py")], check=False)
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(ROOT / "requirements.txt")], check=True)
    RELEASE.mkdir(exist_ok=True)
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        str(ROOT / "build" / "yt_bulk_publish.spec"),
        "--distpath",
        str(RELEASE),
        "--workpath",
        str(WORK),
        "--noconfirm",
        "--clean",
    ]
    result = subprocess.run(command, cwd=str(ROOT))
    shutil.rmtree(WORK, ignore_errors=True)
    if result.returncode == 0:
        print(f"Done. Program written to {RELEASE / 'YT Bulk Publish.exe'}")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
