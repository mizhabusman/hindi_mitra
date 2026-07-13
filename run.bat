@echo off
REM ============================================================
REM   Hindi Mitra - one-click launcher (Windows)
REM
REM   Double-click this file. On the FIRST run it sets the app up
REM   (needs an internet connection); after that it starts quickly.
REM   It opens the app in your web browser automatically.
REM
REM   This PC needs:
REM     * Python 3.12+   https://www.python.org/downloads/
REM                      (tick "Add python.exe to PATH" when installing)
REM     * Node.js LTS    https://nodejs.org/
REM ============================================================

setlocal EnableExtensions
title Hindi Mitra Launcher
cd /d "%~dp0"

echo.
echo ============================================================
echo    Hindi Mitra - starting up
echo ============================================================
echo.

REM ---- 1. Check Python ----------------------------------------------
set "PY="
where python >nul 2>&1 && set "PY=python"
if not defined PY (where py >nul 2>&1 && set "PY=py -3")
if not defined PY goto :no_python

REM ---- 2. Check Node.js / npm ---------------------------------------
where npm >nul 2>&1 || goto :no_node
echo [OK] Python and Node.js are installed.

REM ---- 3. Check the secrets file ------------------------------------
if not exist ".env" (
  echo [!] Warning: ".env" was not found in this folder - the app needs it
  echo     ^(it holds the AI key and admin login^). Make sure you copied the
  echo     WHOLE folder, including the hidden ".env" file.
)

REM ---- 4. Backend: reuse the environment if it works, else build it -
cd backend
set "VENV_PY=.venv\Scripts\python.exe"
set "NEED_SETUP=1"
if exist "%VENV_PY%" ("%VENV_PY%" -c "import uvicorn, fastapi, alembic, anthropic, aiosqlite" >nul 2>&1 && set "NEED_SETUP=0")
if "%NEED_SETUP%"=="0" goto :backend_ready

echo.
echo First-time backend setup. This needs internet and can take a few
echo minutes - please wait...
if exist ".venv" rmdir /s /q ".venv"
%PY% -m venv .venv
if errorlevel 1 goto :venv_fail
"%VENV_PY%" -m pip install --upgrade pip
"%VENV_PY%" -m pip install -r requirements.txt
if errorlevel 1 goto :pip_fail
echo [OK] Backend ready.

:backend_ready
echo Preparing the database...
set "PYTHONPATH=%CD%"
"%VENV_PY%" -m alembic upgrade head
if errorlevel 1 echo [!] The database step reported a problem; continuing anyway.

start "Hindi Mitra - API (keep open)" cmd /k "%VENV_PY% -m uvicorn app.main:app --host 127.0.0.1 --port 8010"
cd ..

REM ---- 5. Frontend: install once, then start ------------------------
cd frontend
if exist "node_modules" goto :web_ready
echo.
echo First-time web setup. This needs internet and can take a few
echo minutes - please wait...
call npm install
if errorlevel 1 goto :npm_fail
echo [OK] Web app ready.

:web_ready
start "Hindi Mitra - Web (keep open)" cmd /k "npm run dev"
cd ..

REM ---- 6. Open the browser ------------------------------------------
echo.
echo Launching the servers and opening your browser...
timeout /t 10 /nobreak >nul
start "" "http://localhost:5173"

echo.
echo ============================================================
echo    Hindi Mitra is running.
echo.
echo    In your browser:  http://localhost:5173
echo    (opens automatically; if it says "cannot connect", wait a
echo     few seconds and refresh)
echo.
echo    Two small windows opened (API + Web). Keep them open while
echo    using the app. To stop the app, close those two windows.
echo ============================================================
echo.
pause
exit /b 0

:no_python
echo [X] Python was not found on this computer.
echo     Install Python 3.12 from https://www.python.org/downloads/ and tick
echo     "Add python.exe to PATH" during setup, then run this file again.
echo.
pause
exit /b 1

:no_node
echo [X] Node.js / npm was not found on this computer.
echo     Install Node.js LTS from https://nodejs.org/ then run this file again.
echo.
pause
exit /b 1

:venv_fail
echo [X] Could not create the Python environment.
echo.
pause
exit /b 1

:pip_fail
echo [X] Could not install backend dependencies (is the internet working?).
echo.
pause
exit /b 1

:npm_fail
echo [X] Could not install web dependencies (is the internet working?).
echo.
pause
exit /b 1
