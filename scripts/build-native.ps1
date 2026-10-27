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

& $cmake --build $build --parallel

if ($LASTEXITCODE -ne 0) {
    throw "Native compilation failed."
}

$builtOutput = Join-Path $build "bin\flowdock-native.exe"
$releaseDirectory = Join-Path $build "bin\Release"
$releaseOutput = Join-Path $releaseDirectory "flowdock-native.exe"

if (-not (Test-Path $builtOutput)) {
    throw "Native helper was not produced at $builtOutput"
}

New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
Copy-Item -Force $builtOutput $releaseOutput

Write-Host "Built successfully: $releaseOutput" -ForegroundColor Green
