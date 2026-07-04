# Meridian live-data sim stack: signalk-server + skiff (sibling checkout).
#
#   .\scripts\run-sim.ps1            # signalk-server on :3000, skiff feeding it
#   .\scripts\run-sim.ps1 -NoSkiff   # just the signalk-server
#
# skiff (hull/sail physics) POSTs Signal K deltas to $env:SIGNALK_HOST; the
# app connects to the signalk-server (Helm `connect localhost:3000`, Layers
# CONNECT box). Config default lives at meridian.signalk.host (Setup→Config).

param(
  [switch]$NoSkiff,
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$skiffDir = Join-Path (Split-Path -Parent $repo) "skiff"
$skiffExe = Join-Path $skiffDir "target\release\skiff.exe"

foreach ($name in @("skiff")) {
  try { Get-Process $name -ErrorAction Stop | Stop-Process -Force -Confirm:$false } catch {}
}

# signalk-server state lives under ~/.signalk (created on first run)
Write-Host ">> signalk-server on :$Port (npx)" -ForegroundColor Cyan
Start-Process -FilePath "npx.cmd" -ArgumentList "--yes", "signalk-server", "--port", "$Port" -WindowStyle Hidden
Start-Sleep -Seconds 8

try {
  $d = Invoke-RestMethod "http://127.0.0.1:$Port/signalk" -TimeoutSec 10
  Write-Host "   discovery ok: $($d.server.id ?? 'signalk-server')"
} catch {
  Write-Host "   still starting (first run downloads the package) — give it a minute" -ForegroundColor Yellow
}

if (-not $NoSkiff) {
  if (Test-Path $skiffExe) {
    Write-Host ">> skiff → SIGNALK_HOST=http://127.0.0.1:$Port" -ForegroundColor Cyan
    $env:SIGNALK_HOST = "http://127.0.0.1:$Port"
    Start-Process -FilePath $skiffExe -WorkingDirectory $skiffDir -WindowStyle Hidden
  } else {
    Write-Host ">> no skiff build at $skiffExe — cargo build --release in the skiff repo" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "connect the app:  Helm → 'connect localhost:$Port'  ·  Layers → CONNECT box"
Write-Host "skiff sim API:    http://127.0.0.1:8081/v1/sim/state"
