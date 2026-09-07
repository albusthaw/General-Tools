@echo off
rem Builds "Release\YT Bulk Publish.exe" on Windows. Double-click or run from a command prompt.
setlocal
cd /d "%~dp0\.."

if not exist ".venv\Scripts\python.exe" (
    echo Creating a private Python environment...
    py -3 -m venv .venv || python -m venv .venv || goto :nopython
)
call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip >nul
python -m pip install -r requirements.txt || goto :fail

echo Building the program...
if not exist "build\icon.ico" python build\make_icon.py
pyinstaller "build\yt_bulk_publish.spec" --distpath "Release" --workpath "build\work" --noconfirm --clean || goto :fail
rmdir /s /q "build\work" 2>nul

echo.
echo Done. The program is in the Release folder:
dir /b "Release\*.exe"
goto :end

:nopython
echo Python 3.10 or newer was not found. Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
goto :end

:fail
echo.
echo The build did not finish. Read the messages above for the reason.

:end
pause
