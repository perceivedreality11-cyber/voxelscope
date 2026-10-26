@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 first: https://nodejs.org/
  pause
  exit /b 1
)
echo Open http://127.0.0.1:8787 in your browser.
echo First-run administrator credentials will appear below.
node server/index.js
pause
