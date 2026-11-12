@echo off
rem Task Scheduler runs this once a day. Output goes to scout.log next to this file.
cd /d "%~dp0"
node scout.mjs >> scout.log 2>&1
