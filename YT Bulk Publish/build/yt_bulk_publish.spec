# PyInstaller recipe for YT Bulk Publish.
# Run from the tool folder on Windows:
#     pyinstaller build\yt_bulk_publish.spec --distpath Release --workpath build\work --noconfirm --clean
import os
from PyInstaller.utils.hooks import collect_all

HERE = os.path.abspath(os.path.dirname(SPEC))
ROOT = os.path.dirname(HERE)

datas = [(os.path.join(ROOT, "app", "ui"), os.path.join("app", "ui"))]
binaries = []
hiddenimports = [
    "webview.platforms.winforms",
    "webview.platforms.edgechromium",
    "websocket",
    "psutil",
    "win32gui",
    "win32process",
    "win32con",
    "win32ui",
    "win32api",
    "PIL.ImageGrab",
]
for package in ("webview", "pythonnet", "clr_loader"):
    try:
        d, b, h = collect_all(package)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:  # package missing on this machine; PyInstaller reports it later
        pass

icon = os.path.join(HERE, "icon.ico")

a = Analysis(
    [os.path.join(ROOT, "run.py")],
    pathex=[ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "numpy", "scipy", "pandas", "playwright"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="YT Bulk Publish",
    debug=False,
    strip=False,
    upx=False,
    console=False,
    icon=icon if os.path.exists(icon) else None,
    version=None,
)
