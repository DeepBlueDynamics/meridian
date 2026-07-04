# Meridian release build (host) — Windows binaries into dist/.
#
#   .\scripts\build.ps1                # sidecar + radio (if sibling) + installer
#   .\scripts\build.ps1 -SkipSidecar   # reuse the existing sidecar build
#   .\scripts\build.ps1 -SkipRadio     # don't bundle Meridian Radio
#
# Produces: dist\Meridian-<version>-x64.exe (NSIS) + .zip (portable).
# The installer bundles resources\sidecar\meridian-sidecar.exe and, when the
# sibling gnosis-radio checkout has a release build, resources\radio\
# meridian-radio.exe (build\hooks\copy-radio.cjs). CI does the same minus
# the radio (no source there) — see .github\workflows\build.yml.

param(
  [switch]$SkipSidecar,
  [switch]$SkipRadio
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

if (-not $SkipSidecar) {
  # cargo relinks the exe — a running sidecar holds the file (os error 32)
  try { Get-Process meridian-sidecar -ErrorAction Stop | Stop-Process -Force -Confirm:$false
        Write-Host ">> stopped running sidecar (relink lock) — rerun scripts\run.ps1 after" -ForegroundColor Yellow } catch {}
  Write-Host ">> cargo build --release (sidecar)" -ForegroundColor Cyan
  cargo build --release --manifest-path sidecar/Cargo.toml
  if ($LASTEXITCODE -ne 0) { throw "sidecar build failed" }
}

if (-not $SkipRadio) {
  $radioDir = Join-Path (Split-Path -Parent $repo) "gnosis-radio"
  if (Test-Path (Join-Path $radioDir "Cargo.toml")) {
    try { Get-Process gnosis-radio -ErrorAction Stop | Stop-Process -Force -Confirm:$false } catch {}
    Write-Host ">> cargo build --release (radio, sibling)" -ForegroundColor Cyan
    cargo build --release --manifest-path (Join-Path $radioDir "Cargo.toml")
    if ($LASTEXITCODE -ne 0) { throw "radio build failed" }
  } else {
    Write-Host ">> no gnosis-radio sibling — installer ships without radio (fail-soft)" -ForegroundColor Yellow
  }
}

Write-Host ">> app icon" -ForegroundColor Cyan
node scripts/gen-icon.mjs

Write-Host ">> npm install (electron-builder)" -ForegroundColor Cyan
npm install --no-audit --no-fund

Write-Host ">> electron-builder --win" -ForegroundColor Cyan
npx electron-builder --win
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }

Write-Host ""
Get-ChildItem dist -File | Where-Object { $_.Name -match '\.(exe|zip)$' } |
  ForEach-Object { Write-Host ("   {0}  {1:N1} MB" -f $_.Name, ($_.Length / 1MB)) -ForegroundColor Green }
