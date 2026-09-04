@echo off
setlocal
cd /d "%~dp0"
title DeepSeek Harness Desktop - One-click Rebuild

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found. Please install Node.js and reopen this window.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found. Please install Node.js and reopen this window.
  echo.
  pause
  exit /b 1
)

node "%~dp0scripts\pack-menu.cjs"
set "ERR=%ERRORLEVEL%"

echo.
if not "%ERR%"=="0" (
  echo [FAILED] exit code %ERR%
) else (
  echo Press any key to close...
)
pause
exit /b %ERR%
