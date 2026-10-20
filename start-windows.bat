@echo off
title Scavenger Royale Server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed - it is needed to run the game server.
  echo   Trying to install it automatically with winget...
  echo.
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo.
    echo   Automatic install did not work. Opening nodejs.org - install the LTS version,
    echo   then double-click start-windows.bat again.
    start "" https://nodejs.org/
    pause
    exit /b 1
  )
  echo.
  echo   Node.js is installed. Close this window and double-click start-windows.bat again.
  pause
  exit /b 0
)
echo.
echo   TIP: if Windows Firewall asks, tick "Private networks" and click "Allow access"
echo   so your friends can connect.
echo.
node server.js
pause
