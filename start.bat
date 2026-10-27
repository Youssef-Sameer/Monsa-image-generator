@echo off
rem Double-click this file to start Monsa Studio. Close the window to stop it.
cd /d "%~dp0"
start "" cmd /c "timeout /t 5 >nul & start http://localhost:8080"
java Server.java
pause
