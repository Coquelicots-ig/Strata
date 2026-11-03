@echo off
rem Open for a meeting: deploy the normal Firestore rules and the web page.
cd /d "%~dp0"
echo.
echo === OPEN: normal rules + web page (https://comiketmtg.web.app) ===
echo.
call npx firebase-tools@15 deploy --only hosting,firestore:rules --project comiketmtg
if errorlevel 1 goto fail
echo.
echo === DONE. The page is open: https://comiketmtg.web.app ===
goto end
:fail
echo.
echo === FAILED. Copy the messages above and send them to Claude. ===
:end
echo.
pause
