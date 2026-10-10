$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (Test-Path -LiteralPath 'doda-desktop.exe') {
    Start-Process -FilePath (Join-Path $PSScriptRoot 'doda-desktop.exe') -WorkingDirectory $PSScriptRoot
} else {
    npm.cmd start
}
