@echo off
chcp 65001 >nul
title OmniDex - Mise à jour de la collection de Aldeide
cd /d "%~dp0"

echo ====================================================
echo      OmniDex - Mise à jour en direct de la collection
echo ====================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERREUR] Node.js n'est pas installe ou n'est pas dans le PATH.
    echo Veuillez installer Node.js (https://nodejs.org) pour utiliser ce script.
    echo.
    pause
    exit /b 1
)

node update_collection.mjs

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [SUCCÈS] Données mises à jour avec succès !
    echo Vous pouvez rafraîchir la page index.html dans votre navigateur.
) else (
    echo.
    echo [ERREUR] La mise à jour a échoué.
)

echo.
pause
