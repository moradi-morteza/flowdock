param(
  [string]$Hwnd = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$helper = Join-Path $root "native\build\bin\Release\flowdock-native.exe"

if (-not (Test-Path $helper)) {
  throw "Native helper is missing. Run npm run build:native first."
}

$info = [System.Diagnostics.ProcessStartInfo]::new()
$info.FileName = $helper
$info.UseShellExecute = $false
$info.RedirectStandardInput = $true
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
$info.CreateNoWindow = $true

$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $info
if (-not $process.Start()) { throw "Could not start native helper." }

try {
  $initial = $process.StandardOutput.ReadLine() | ConvertFrom-Json
  if ($initial.type -ne "snapshot") { throw "Expected an initial snapshot." }

  Write-Host "Detected $($initial.windows.Count) user windows."
  $initial.windows |
    Select-Object hwnd, processName, minimized, title |
    Format-Table -AutoSize

  if ($Hwnd) {
    $process.StandardInput.WriteLine("ACTIVATE 1 $Hwnd")
    do {
      $response = $process.StandardOutput.ReadLine() | ConvertFrom-Json
    } while ($response.requestId -ne "1")
    if (-not $response.ok) { throw "Windows rejected activation for HWND $Hwnd." }
    Write-Host "Activated HWND $Hwnd."
  }
} finally {
  if (-not $process.HasExited) {
    $process.StandardInput.WriteLine("QUIT 99")
    if (-not $process.WaitForExit(1000)) { $process.Kill() }
  }
  $process.Dispose()
}
