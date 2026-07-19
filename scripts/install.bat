@echo off
setlocal
rem Installs the RegTab RTL extension from a VSIX located next to this script.
rem Download the VSIX for your platform from
rem https://github.com/regtab/vscode-rtl/releases and put it beside install.bat.

set "DIR=%~dp0"
set "VSIX="

rem Prefer the platform package, fall back to the universal one.
if defined PROCESSOR_ARCHITECTURE (
    if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
        for %%F in ("%DIR%regtab-rtl-*-win32-arm64.vsix") do set "VSIX=%%~fF"
    ) else (
        for %%F in ("%DIR%regtab-rtl-*-win32-x64.vsix") do set "VSIX=%%~fF"
    )
)
if not defined VSIX for %%F in ("%DIR%regtab-rtl-*-universal.vsix") do set "VSIX=%%~fF"

if not defined VSIX (
    echo No regtab-rtl VSIX found next to this script.
    echo Download one from https://github.com/regtab/vscode-rtl/releases
    exit /b 1
)

echo Installing "%VSIX%" ...
call code --install-extension "%VSIX%"
if errorlevel 1 (
    echo.
    echo Installation failed. Make sure VS Code's 'code' command is on PATH
    echo ^(in VS Code: Ctrl+Shift+P, "Shell Command: Install 'code' command"^).
    exit /b 1
)

echo Done. Reload open VS Code windows to activate the extension.
