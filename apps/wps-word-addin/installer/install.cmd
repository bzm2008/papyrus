@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
echo If WPS Writer is open, restart it to load Papyrus.
pause
