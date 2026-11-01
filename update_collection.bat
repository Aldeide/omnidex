@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "NO_PAUSE_FLAG="
if /i "%~1"=="--silent" set "NO_PAUSE_FLAG=1"
if /i "%~1"=="--no-pause" set "NO_PAUSE_FLAG=1"
if /i "%~2"=="--silent" set "NO_PAUSE_FLAG=1"
if /i "%~2"=="--no-pause" set "NO_PAUSE_FLAG=1"
if defined NO_PAUSE set "NO_PAUSE_FLAG=1"

echo ====================================================
echo      OmniDex - Mise a jour de la collection
echo ====================================================
echo [%date% %time%] Debut de la synchronisation...
echo.

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERREUR] Node.js n'est pas installe ou introuvable dans le PATH.
    echo Veuillez installer Node.js - https://nodejs.org
    if not defined NO_PAUSE_FLAG pause
    exit /b 1
)

node update_collection.mjs %*
set "EXITCODE=%ERRORLEVEL%"

if %EXITCODE% EQU 0 (
    echo.
    echo [SUCCES] Donnees mises a jour et synchronisees avec succes !
    echo Le site GitHub Pages est a jour : https://aldeide.github.io/omnidex/
) else (
    echo.
    echo [ERREUR] La mise a jour a echoue avec le code : %EXITCODE%
)

echo.
echo [%date% %time%] Fin de la synchronisation.

if not defined NO_PAUSE_FLAG pause

exit /b %EXITCODE%
