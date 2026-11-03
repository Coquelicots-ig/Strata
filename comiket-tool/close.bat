@echo off
rem Close after a meeting: lock Firestore (nobody can read or write) and stop the web page.
rem Before this, the organizer should press "subete kesu" (delete all) in the app if the data is no longer needed.
cd /d "%~dp0"
echo.
echo === CLOSE: lock Firestore + stop the web page ===
echo.
call npx firebase-tools@15 deploy --only firestore:rules --config firebase.closed.json --project comiketmtg
if errorlevel 1 goto fail
call npx firebase-tools@15 hosting:disable --force --project comiketmtg
if errorlevel 1 goto fail
echo.
echo === DONE. Firestore is locked and the page is closed. ===
goto end
:fail
echo.
echo === FAILED. Copy the messages above and send them to Claude. ===
:end
echo.
pause
