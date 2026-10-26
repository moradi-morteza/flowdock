```powershell
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$native = Join-Path $root "native"
$build = Join-Path $native "build"

$cmake = "C:\mingw64\bin\cmake.exe"
$compiler = "C:\mingw64\bin\g++.exe"
$make = "C:\mingw64\bin\mingw32-make.exe"

if (-not (Test-Path $cmake)) {
    throw "CMake not found at $cmake"
}

if (-not (Test-Path $compiler)) {
    throw "MinGW C++ compiler not found at $compiler"
}

if (-not (Test-Path $make)) {
    throw "MinGW Make not found at $make. Check your MinGW installation."
}

# Remove the previous CMake cache because it may use Ninja.
if (Test-Path $build) {
    Remove-Item $build -Recurse -Force
}

& $cmake `
    -S $native `
    -B $build `
    -G "MinGW Makefiles" `
    "-DCMAKE_CXX_COMPILER=$compiler" `
    "-DCMAKE_MAKE_PROGRAM=$make" `
    "-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=$build/bin"

if ($LASTEXITCODE -ne 0) {
    throw "CMake configuration failed."
}

& $cmake --build $build --config Release --parallel

if ($LASTEXITCODE -ne 0) {
    throw "Native compilation failed."
}

$output = Join-Path $build "bin\flowdock-native.exe"

if (-not (Test-Path $output)) {
    throw "Native helper was not produced at $output"
}

Write-Host "Built successfully: $output" -ForegroundColor Green
```
