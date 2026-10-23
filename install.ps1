# Agent Company installer (Windows PowerShell):
#   irm https://raw.githubusercontent.com/quaqducc/agent-office/main/install.ps1 | iex
# Installs the npm package globally. Needs Node.js 22.19+ (with npm) already installed.
$ErrorActionPreference = "Stop"
$pkg = "@quaqduc/agent-company"

$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
  Write-Host "Agent Company needs Node.js 22.19 or newer (with npm)."
  Write-Host "Install it from https://nodejs.org, or run:  winget install OpenJS.NodeJS.LTS"
  return
}

$v = [version]((& node --version).TrimStart("v"))
if ($v -lt [version]"22.19.0") {
  Write-Host "Agent Company needs Node.js 22.19 or newer; this machine has $v."
  Write-Host "Update Node.js (https://nodejs.org or: winget upgrade OpenJS.NodeJS.LTS) and run this installer again."
  return
}

Write-Host "Installing $pkg ..."
& npm install -g $pkg
if ($LASTEXITCODE -ne 0) {
  Write-Host "Global install failed (exit code $LASTEXITCODE). See the npm output above."
  return
}

Write-Host ""
Write-Host "Done. Start it with:  agent-company"
Write-Host "The office opens at http://127.0.0.1:4317 - enter your API endpoint and key there."
