@echo off
chcp 65001 >nul
title DeepSeek Harness Desktop - One-click Rebuild
cd /d "%~dp0"

set "NODE=node"

echo.
echo ============================================================
echo   DeepSeek Harness Desktop - 一键打包
echo ============================================================
echo.

:menu
echo   1^) 本地源码打包
echo   2^) 远程源码打包
echo   3^) 修改本地源码路径
echo   0^) 退出
echo.
set "CHOICE="
set /p CHOICE=请选择 [0-3]: 

if "%CHOICE%"=="1" goto local
if "%CHOICE%"=="2" goto remote
if "%CHOICE%"=="3" goto setpath
if "%CHOICE%"=="0" goto end
echo 无效选择，请重试。
echo.
goto menu

:setpath
call :prompt_checkout
if errorlevel 1 goto menu
echo.
echo [OK] 已保存本地源码路径。
echo.
goto menu

:local
call :ensure_checkout
if errorlevel 1 goto menu
echo.
echo 使用本地源码: %CHECKOUT%
echo.
call npm run rebuild -- --checkout "%CHECKOUT%"
if errorlevel 1 goto fail
goto done

:remote
echo.
echo 将从 GitHub 克隆/更新稳定版并打包…
echo.
call npm run rebuild:remote
if errorlevel 1 goto fail
goto done

:ensure_checkout
set "CHECKOUT="
for /f "delims=" %%P in ('%NODE% -e "const c=require('./scripts/pack-config.cjs'); const p=c.readPackConfig().checkout||''; if(p) process.stdout.write(p)" 2^>nul') do set "CHECKOUT=%%P"

if not defined CHECKOUT (
  echo 尚未保存本地源码路径。
  call :prompt_checkout
  if errorlevel 1 exit /b 1
  for /f "delims=" %%P in ('%NODE% -e "const c=require('./scripts/pack-config.cjs'); process.stdout.write(c.readPackConfig().checkout||'')" 2^>nul') do set "CHECKOUT=%%P"
  if not defined CHECKOUT exit /b 1
  exit /b 0
)

echo 当前本地源码路径:
echo   %CHECKOUT%
echo.
set "USE="
set /p USE=直接使用该路径？[Y=直接用 / N=更改]: 
if /i "%USE%"=="N" (
  call :prompt_checkout
  if errorlevel 1 exit /b 1
  for /f "delims=" %%P in ('%NODE% -e "const c=require('./scripts/pack-config.cjs'); process.stdout.write(c.readPackConfig().checkout||'')" 2^>nul') do set "CHECKOUT=%%P"
)
if not exist "%CHECKOUT%\package.json" (
  echo [错误] 目录无效或不含 package.json:
  echo   %CHECKOUT%
  echo 请选 3 修改路径。
  exit /b 1
)
exit /b 0

:prompt_checkout
echo.
set "INPUT="
set /p INPUT=请输入 DSH 源码目录完整路径: 
if not defined INPUT (
  echo 已取消。
  exit /b 1
)
set "INPUT=%INPUT:"=%"
if not exist "%INPUT%\package.json" (
  echo [错误] 找不到 %INPUT%\package.json
  exit /b 1
)
%NODE% -e "const c=require('./scripts/pack-config.cjs'); c.writePackConfig({checkout:process.argv[1],mode:'local'}); console.log('saved:',process.argv[1])" "%INPUT%"
if errorlevel 1 (
  echo [错误] 保存配置失败
  exit /b 1
)
set "CHECKOUT=%INPUT%"
exit /b 0

:fail
echo.
echo [FAILED] 打包失败，请查看上方日志。
echo.
pause
exit /b 1

:done
echo.
echo [DONE] 安装包已生成到 dist\ 目录。
echo.
pause
exit /b 0

:end
echo 已退出。
exit /b 0
