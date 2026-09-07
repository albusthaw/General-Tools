@echo off
rem Start YT Bulk Publish from source (needs Python 3.10 or newer).
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Creating a private Python environment...
    py -3 -m venv .venv || python -m venv .venv
    ".venv\Scripts\python.exe" -m pip install --upgrade pip
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)
".venv\Scripts\pythonw.exe" run.py
