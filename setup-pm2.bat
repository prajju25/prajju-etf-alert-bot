@echo off
echo ============================================
echo  ETF Bot - PM2 Setup for Windows
echo ============================================
echo.

cd /d "%~dp0"

echo [1/4] Installing PM2 globally...
call npm install -g pm2
if %errorlevel% neq 0 (
    echo ERROR: PM2 install failed. Make sure Node.js is installed.
    pause
    exit /b 1
)

echo.
echo [2/4] Installing PM2 Windows Startup service...
call npm install -g pm2-windows-startup
call pm2-windows-startup install

echo.
echo [3/4] Starting ETF bot with PM2...
pm2 delete etf-bot 2>nul
pm2 start index.js --name etf-bot --time
pm2 save

echo.
echo [4/4] Done! Bot is running.
echo.
pm2 status

echo.
echo ============================================
echo  ETF Bot is now running 24/7 on this PC.
echo  It will auto-restart on crashes + reboots.
echo.
echo  Useful commands:
echo    pm2 status          - check if bot is running
echo    pm2 logs etf-bot    - view live logs
echo    pm2 stop etf-bot    - stop the bot
echo    pm2 restart etf-bot - restart the bot
echo ============================================
pause
