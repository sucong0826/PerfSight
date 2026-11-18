$ErrorActionPreference = 'Stop'

function Stop-Build([string]$Message) {
  Write-Error "Build error: $Message"
  exit 1
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$appDir = Join-Path $repoRoot 'perf-sight'
$artifactsDir = Join-Path $repoRoot 'artifacts'

if ($env:OS -ne 'Windows_NT') {
  Stop-Build 'Run this script on Windows.'
}
if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) {
  Stop-Build 'This build produces the Windows x64 client and requires an x64 Windows runner.'
}

foreach ($commandName in @('node', 'npm', 'cargo', 'rustc', 'python')) {
  if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
    Stop-Build "Required command '$commandName' was not found on PATH."
  }
}

$nodeVersionText = (& node --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersionText -notmatch '^v?(\d+)\.') {
  Stop-Build 'Could not determine the Node.js version.'
}
if ([int]$Matches[1] -lt 20) {
  Stop-Build 'Node.js 20 or newer is required.'
}

$pythonVersionText = (& python --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $pythonVersionText -notmatch 'Python\s+(\d+)\.(\d+)') {
  Stop-Build 'Could not determine the Python version.'
}
if ([int]$Matches[1] -lt 3 -or ([int]$Matches[1] -eq 3 -and [int]$Matches[2] -lt 9)) {
  Stop-Build 'Python 3.9 or newer is required to build the collector sidecar.'
}

New-Item -ItemType Directory -Path $artifactsDir -Force | Out-Null
$outputFile = Join-Path $artifactsDir 'PerfSight-windows-x64.msi'
Remove-Item -LiteralPath $outputFile -Force -ErrorAction SilentlyContinue

Push-Location $appDir
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { Stop-Build 'npm ci failed.' }

  npm run sidecar:ensure
  if ($LASTEXITCODE -ne 0) { Stop-Build 'Windows collector sidecar build failed.' }

  $collectorPath = Join-Path $appDir 'src-tauri/binaries/collector-x86_64-pc-windows-msvc.exe'
  if (-not (Test-Path -LiteralPath $collectorPath -PathType Leaf)) {
    Stop-Build "Windows collector sidecar was not created at '$collectorPath'."
  }

  npm run tauri -- build --bundles msi
  if ($LASTEXITCODE -ne 0) { Stop-Build 'Tauri MSI build failed.' }
}
finally {
  Pop-Location
}

$msiDir = Join-Path $appDir 'src-tauri/target/release/bundle/msi'
$msiFiles = @(Get-ChildItem -LiteralPath $msiDir -Filter '*.msi' -File -ErrorAction SilentlyContinue)
if ($msiFiles.Count -ne 1) {
  Stop-Build "Expected one MSI in '$msiDir'; found $($msiFiles.Count)."
}

Copy-Item -LiteralPath $msiFiles[0].FullName -Destination $outputFile -Force
if (-not (Test-Path -LiteralPath $outputFile -PathType Leaf) -or (Get-Item -LiteralPath $outputFile).Length -eq 0) {
  Stop-Build 'The Windows MSI was not created.'
}

Write-Output "Created $outputFile"
