@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo === بناء تطبيق سطح المكتب ===
call npm run build:desktop
echo.
echo المُثبّت (إن نجح البناء):
echo   apps\desktop\release\m5azen-setup-1.0.0.exe
echo.
pause
