@echo off
echo ============================================
echo  Final push - disable GitHub Actions schedules
echo ============================================
echo.
cd /d "%~dp0"
if exist ".git\index.lock" del /f ".git\index.lock"
git add -A
git diff --staged --name-only
git commit -m "chore: disable GitHub Actions schedules, Render runs bot 24/7"
git push origin main
echo.
echo Done! Now set up UptimeRobot (see instructions).
pause
