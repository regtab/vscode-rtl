# Window helpers for the "[Extension Development Host]" VS Code window.
# Usage: powershell -File win.ps1 -Action resize -W 1280 -H 800
#        powershell -File win.ps1 -Action front
param(
  [string]$Action = "resize",
  [int]$W = 1280,
  [int]$H = 800
)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinApi {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
}
'@
[WinApi]::SetProcessDPIAware() | Out-Null
$proc = Get-Process Code -ErrorAction Stop | Where-Object { $_.MainWindowTitle -like "*Extension Development Host*" } | Select-Object -First 1
if (-not $proc) { throw "Extension Development Host window not found" }
$hwnd = $proc.MainWindowHandle
[WinApi]::ShowWindow($hwnd, 9) | Out-Null   # SW_RESTORE
if ($Action -eq "resize") {
  [WinApi]::SetWindowPos($hwnd, [IntPtr]::Zero, 60, 40, $W, $H, 0x0040) | Out-Null
}
[WinApi]::SetForegroundWindow($hwnd) | Out-Null
"ok $($proc.MainWindowTitle)"
