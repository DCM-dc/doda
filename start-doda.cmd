@echo off
cd /d "%~dp0"
if exist "%~dp0doda-desktop.exe" (
  start "" "%~dp0doda-desktop.exe"
) else (
  call npm.cmd start
)
