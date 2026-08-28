@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
    echo [First run] Installing dependencies (Electron binary ~100MB), please wait...
    set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
    call npm install --cache "%~dp0.npm-cache" --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo Install failed. Please run manually:
        echo   npm install --cache "%~dp0.npm-cache" --no-audit --no-fund
        pause
        exit /b 1
    )
)

start "" "node_modules\electron\dist\electron.exe" .
endlocal
