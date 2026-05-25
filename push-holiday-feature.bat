@echo off
echo ============================================
echo  Pushing ALL changes to GitHub
echo ============================================
echo.

cd /d "%~dp0"

if exist ".git\index.lock" (
    echo Removing stale git lock...
    del /f ".git\index.lock"
)

:: Clean up old files no longer needed
if exist "src\jobs\refreshHolidays.js"             del /f "src\jobs\refreshHolidays.js"
if exist ".github\workflows\refresh-holidays.yml"   del /f ".github\workflows\refresh-holidays.yml"
if exist "nse-holidays.json"                        del /f "nse-holidays.json"

git rm --cached --ignore-unmatch src/jobs/refreshHolidays.js
git rm --cached --ignore-unmatch .github/workflows/refresh-holidays.yml
git rm --cached --ignore-unmatch nse-holidays.json

:: Stage every changed file
git add -A

echo.
echo Files staged:
git diff --staged --name-only

echo.
git commit -m "fix: robust Dockerfile + all feature changes

- Dockerfile: npm install instead of npm ci (more forgiving on Back4App)
- Dockerfile: EXPOSE 3000 for Back4App health check
- index.js: health check HTTP server on port 3000
- index.js: write credentials.json from GOOGLE_CREDENTIALS env var
- nse.service.js: holiday detection via Yahoo Finance regularMarketTime
- gpt.service.js: proportional multi-ETF buying + allocation-aware prompt
- dailySavings.js: skip holidays + dynamic daily budget
- marketScan.js: skip holidays + pass allocation to GPT
- guardrails.engine.js: enforce caps on all categories
- allocation.js: sector 10%, commodity 25%, silverMax 13%
- scripts/runMarketScan.js: remove waitUntil3PMIST (was burning 2500 min/month)
- workflows: schedule market scan at 3PM IST sharp, no waiting"

echo.
git push origin main

echo.
echo ============================================
echo  Done! Go back to Back4App and click Retry.
echo ============================================
pause
