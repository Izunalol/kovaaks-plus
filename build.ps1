# Builds the shareable single-file KovaaksPlus.exe into .\dist
# Requires the .NET 8 SDK (winget install Microsoft.DotNet.SDK.8).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$project = Join-Path $root 'src\KovaaksPlus\KovaaksPlus.csproj'
# MSBuild mishandles the apostrophe in "Kovaak's Plus" inside publish paths, so publish to a temp folder first.
$tmp = Join-Path $env:TEMP ('kplus-publish-' + [guid]::NewGuid().ToString('N'))

dotnet publish $project -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true -p:DebugType=none -o $tmp -nologo
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

New-Item -ItemType Directory -Force (Join-Path $root 'dist') | Out-Null
Copy-Item (Join-Path $tmp 'KovaaksPlus.exe') (Join-Path $root 'dist\KovaaksPlus.exe') -Force
Remove-Item $tmp -Recurse -Force
Write-Host "Built dist\KovaaksPlus.exe"
