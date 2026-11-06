@echo off
rem Double-click to start HeartQuarters. It opens in your browser.
rem Close this window to stop it.
cd /d "%~dp0"
if not exist node_modules call npm install
call npm start
pause
