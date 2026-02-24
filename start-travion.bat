@echo off
REM Travion - AI Travel Agent (Web + Backend)

echo ========================================
echo    TRAVION - AI Travel Agent
echo ========================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed. Please install Node.js to run Travion.
    pause
    exit /b 1
)

REM Check if Redis is running (optional)
echo Checking Redis connection...
ping -n 1 127.0.0.1 >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: Cannot reach localhost. Redis may not be running.
    echo Background jobs will be disabled.
    echo.
)

REM Kill any existing node processes for Travion
echo Cleaning up old processes...
taskkill /F /IM node.exe /FI "WINDOWTITLE eq Travion*" >nul 2>nul

REM Start Backend
echo Starting Travion Backend...
start "Travion Backend" cmd /c "cd travion_backend && npm run start:dev"

REM Wait for backend to initialize
echo Waiting for backend to start...
timeout /t 5 /nobreak >nul

REM Start Web Dashboard
echo Starting Travion Web Dashboard...
start "Travion Web" cmd /c "cd travion_web && npm run dev"

echo.
echo ========================================
echo    Services Started!
echo ========================================
echo.
echo Backend API:  http://localhost:3000
echo Web App:      http://localhost:5173 (or next available port)
echo.
echo Check the "Travion Web" window for the actual port if 5173 is occupied.
echo Press Ctrl+C in each window to stop services.
echo ========================================
echo.
pause
