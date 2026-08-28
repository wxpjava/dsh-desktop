@echo off
chcp 65001 >nul
title DeepSeek Harness Desktop - Rebuild
cd /d "%~dp0"

echo.
echo ============================================================
echo   DeepSeek Harness Desktop - One-click Rebuild
echo   Default checkout : D:\develop\DeepSeek Harness
echo   Custom checkout  : set DSH_DESKTOP_DSH_CHECKOUT=your\path
echo ============================================================
echo.

call npm run rebuild
if errorlevel 1 (
  echo.
  echo [FAILED] Check the error messages above.
  echo.
  pause
  exit /b 1
)

echo.
echo [DONE] Installer has been generated in the dist\ folder.
echo.
pause
