$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$native = Join-Path $root "native"
$build = Join-Path $native "build"

if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
  throw "CMake was not found. Install CMake and the Visual Studio C++ workload."
}

cmake -S $native -B $build -A x64
cmake --build $build --config Release --parallel

$output = Join-Path $build "bin\Release\flowdock-native.exe"
if (-not (Test-Path $output)) {
  throw "Native helper was not produced at $output"
}

Write-Host "Built $output"
