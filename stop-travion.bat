@echo off
REM Travion - Stop All Services
REM This script stops Backend and Frontend services forcefully

echo ========================================
echo    Stopping Travion Services
echo ========================================
echo.

echo [1/2] Stopping Backend...
taskkill /FI "WINDOWTITLE eq Travion Backend*" /T /F >nul 2>&1
if %ERRORLEVEL% EQU 0 (   
    echo Backend stopped successfully
) else (   
    echo No backend process found
)

echo.
echo [2/2] Stopping Web Dashboard...
taskkill /FI "WINDOWTITLE eq Travion Web*" /T /F >nul 2>&1
if %ERRORLEVEL% EQU 0 (   
    echo Web app stopped successfully
) else (   
    echo No web app process found
)

echo.
echo ========================================
echo    All services stopped!
echo ========================================
echo.
pause
