@echo off
cd /d "%~dp0"
node scout.mjs >> scout.log 2>&1
