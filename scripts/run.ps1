# Meridian dev runner — builds and launches the full stack.
#
#   .\scripts\run.ps1                  # radio sidecar + app (last view: layers)
#   .\scripts\run.ps1 -View radio      # open a specific view
#   .\scripts\run.ps1 -NoRadio         # app only (radio pane shows offline/setup)
#   .\scripts\run.ps1 -SkipBuild       # don't rebuild the radio crate
#
# The radio sidecar is the gnosis-radio crate (sibling dir) until radio-core
# is ported into this repo. Stale instances hold the RTL-SDR dongle and ports
# 9080/9081 — and cargo can't relink while the exe runs — so both processes
# are stopped before building/launching.

param(
  [ValidateSet("setup", "routing", "layers", "harbor", "radio")]
  [string]$View = "layers",
  [switch]$NoRadio,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$radioDir = Join-Path (Split-Path -Parent $repo) "gnosis-radio"
$radioExe = Join-Path $radioDir "target\release\gnosis-radio.exe"

# ── stop stale instances (dongle + ports 9080/9081/9123 must be free) ──
# NEVER kill electron.exe by name: other Electron apps (Hyperia, the terminal)
# run under that name too. Match Meridian's instance by its command line
# (…meridian\node_modules\electron…) instead.
Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" |
  Where-Object { $_.CommandLine -match 'meridian' } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -Confirm:$false } catch {} }
try { Get-Process gnosis-radio -ErrorAction Stop | Stop-Process -Force -Confirm:$false } catch {}
Start-Sleep -Seconds 1

# ── build ──
if (-not (Test-Path (Join-Path $repo "node_modules"))) {
  Write-Host ">> npm install" -ForegroundColor Cyan
  Push-Location $repo
  npm install
  Pop-Location
}

$haveRadio = (-not $NoRadio) -and (Test-Path (Join-Path $radioDir "Cargo.toml"))
if ($haveRadio -and -not $SkipBuild) {
  Write-Host ">> cargo build --release (radio sidecar)" -ForegroundColor Cyan
  Push-Location $radioDir
  cargo build --release
  $buildOk = $LASTEXITCODE -eq 0
  Pop-Location
  if (-not $buildOk) { throw "radio sidecar build failed" }
} elseif (-not $haveRadio -and -not $NoRadio) {
  Write-Host ">> no gnosis-radio checkout next to this repo - starting app only" -ForegroundColor Yellow
}

# ── launch ──
if ($haveRadio -and (Test-Path $radioExe)) {
  Write-Host ">> radio sidecar: $radioExe scan" -ForegroundColor Cyan
  # WorkingDirectory matters: the sidecar writes recordings/ and logs/ relative
  Start-Process -FilePath $radioExe -ArgumentList "scan" -WorkingDirectory $radioDir -WindowStyle Hidden
}

Write-Host ">> app: MERIDIAN_VIEW=$View" -ForegroundColor Cyan
Write-Host "   control API  http://127.0.0.1:9123  (/screenshot /eval /reload /window /mcp)"
Write-Host "   radio ctrl   http://127.0.0.1:9080  - stream ws://127.0.0.1:9081"
$env:MERIDIAN_VIEW = $View
Push-Location $repo
npx electron .   # foreground: Ctrl+C here closes the app; sidecar keeps running
Pop-Location
