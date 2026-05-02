@echo off
:: To run from command line: cmd /c "C:\Users\alper\Documents\repos\steno-trainer\run.cmd"
cd /d "%~dp0"
npm install
npm run dev
pause
