@echo off
cd /d "%~dp0"

rem PMAS: predpochitaem Node-backend (realnaya 3D-rekonstrukciya).
rem Esli Node net - staticheskiy server Python (bez rekonstrukcii).
where node >nul 2>nul
if %errorlevel%==0 (
  if "%PORT%"=="" set PORT=3000
  if not exist node_modules (
    echo PMAS - pervaya ustanovka zavisimostey, npm install...
    call npm install
  )
  echo PMAS - zapusk s 3D-rekonstrukciey na http://localhost:%PORT%
  echo Dlya ostanovki nazhmite Ctrl+C
  start http://localhost:%PORT%
  node backend\server.js
) else (
  if "%PORT%"=="" set PORT=8080
  echo Node.js ne nayden - staticheskiy rezhim bez 3D-rekonstrukcii.
  echo PMAS - zapusk na http://localhost:%PORT%
  echo Dlya ostanovki nazhmite Ctrl+C
  start http://localhost:%PORT%
  python -m http.server %PORT%
)
