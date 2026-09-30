@echo off
setlocal EnableExtensions
rem ------------------------------------------------------------
rem  deploy.bat : push this folder to GitHub Pages
rem  Repo: https://github.com/niratorn/OBdating
rem  Site: https://niratorn.github.io/OBdating/
rem  Double-click to run. Everything is logged to deploy-log.txt
rem ------------------------------------------------------------
cd /d "%~dp0"
set "REPO_URL=https://github.com/niratorn/OBdating.git"
set "SITE_URL=https://niratorn.github.io/OBdating/"
set "LOG=%~dp0deploy-log.txt"
echo ==== deploy %date% %time% ==== > "%LOG%"

where git >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Git is not installed. Install Git for Windows, then run this again.
  echo git not found>>"%LOG%"
  goto :fail
)

git config user.email >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Git does not know who you are yet. Run these two lines once in a terminal:
  echo        git config --global user.name "Your Name"
  echo        git config --global user.email "you@example.com"
  goto :fail
)

if exist ".git\index.lock" (
  echo Removing a stale .git\index.lock
  del /f /q ".git\index.lock" >>"%LOG%" 2>&1
)

if not exist ".git" (
  echo First run: linking this folder to %REPO_URL%
  git init -b main >>"%LOG%" 2>&1
  if errorlevel 1 goto :fail
  git remote add origin %REPO_URL% >>"%LOG%" 2>&1
  git fetch origin main >>"%LOG%" 2>&1
  if not errorlevel 1 git reset --mixed origin/main >>"%LOG%" 2>&1
)

set "PY="
where py >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if not defined PY (
  where python >nul 2>&1
  if not errorlevel 1 set "PY=python"
)
if defined PY (
  %PY% -c "import sys" >nul 2>&1
  if errorlevel 1 set "PY="
)
if defined PY (
  echo Building index.html from src ...
  %PY% build.py >>"%LOG%" 2>&1
  if errorlevel 1 (
    echo [FAIL] build.py failed. Nothing was pushed. See deploy-log.txt
    goto :fail
  )
) else (
  echo [WARN] Python not found. index.html was NOT rebuilt from src.
  echo python not found, build skipped>>"%LOG%"
)

where node >nul 2>&1
if errorlevel 1 (
  echo [WARN] Node.js not found. Tests were skipped.
  echo node not found, tests skipped>>"%LOG%"
) else (
  echo Running tests ...
  node tests\core.test.js >>"%LOG%" 2>&1
  if errorlevel 1 (
    echo [FAIL] Tests failed. Nothing was pushed. See deploy-log.txt
    goto :fail
  )
)

git add -A >>"%LOG%" 2>&1
if errorlevel 1 goto :fail
git diff --quiet
if errorlevel 1 (
  echo [FAIL] Some changes were not staged. See deploy-log.txt
  git status >>"%LOG%" 2>&1
  goto :fail
)
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Update OBdating" >>"%LOG%" 2>&1
  if errorlevel 1 goto :fail
) else (
  echo No file changes. Checking that GitHub has the latest commit ...
)

echo Pushing to GitHub ...
git push -u origin main >>"%LOG%" 2>&1
if errorlevel 1 (
  echo [FAIL] git push failed. If a GitHub sign-in window opened, finish it and run this again.
  goto :fail
)

set "LOCAL="
set "REMOTE="
for /f %%i in ('git rev-parse HEAD') do set "LOCAL=%%i"
for /f "tokens=1" %%i in ('git ls-remote origin refs/heads/main') do set "REMOTE=%%i"
echo local %LOCAL% remote %REMOTE%>>"%LOG%"
if not "%LOCAL%"=="%REMOTE%" (
  echo [FAIL] GitHub does not have the latest commit yet. See deploy-log.txt
  goto :fail
)
echo.
echo [OK] Deployed %LOCAL%
echo      Site: %SITE_URL%
echo      GitHub Pages refreshes in about a minute.
echo [OK] deployed %LOCAL%>>"%LOG%"
echo.
pause
exit /b 0

:fail
echo [FAIL] deploy stopped>>"%LOG%"
echo.
echo Deploy did not finish. Details are in deploy-log.txt
pause
exit /b 1
