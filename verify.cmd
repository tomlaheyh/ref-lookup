@echo off
REM Pre-commit integrity check. Double-click, or run "verify" from the repo root.
REM Green PASS = safe to commit. Red FAILED = do not push.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0verify.ps1"
set RC=%ERRORLEVEL%
echo.
if not "%1"=="/q" pause
exit /b %RC%
