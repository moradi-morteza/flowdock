$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$native = Join-Path $root "native"
$build = Join-Path $native "build"

function Find-Tool {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string[]]$Candidates
    )

    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return (Resolve-Path $candidate).Path
        }
    }

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    throw "$Name was not found. Install CMake and MinGW-w64, then add them to PATH."
}

$cmake = Find-Tool -Name "cmake.exe" -Candidates @(
    "C:\mingw64\bin\cmake.exe",
    "C:\Program Files\CMake\bin\cmake.exe"
)
$compiler = Find-Tool -Name "g++.exe" -Candidates @(
    "C:\mingw64\bin\g++.exe",
    "C:\msys64\mingw64\bin\g++.exe"
)
$make = Find-Tool -Name "mingw32-make.exe" -Candidates @(
    "C:\mingw64\bin\mingw32-make.exe",
    "C:\msys64\mingw64\bin\mingw32-make.exe"
)

Write-Host "CMake: $cmake"
Write-Host "Compiler: $compiler"
Write-Host "Make: $make"

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
