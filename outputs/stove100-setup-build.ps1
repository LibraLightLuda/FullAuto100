$ErrorActionPreference = 'Stop'

$extension = Join-Path $PSScriptRoot 'stove100-background'
$manifest = Get-Content (Join-Path $extension 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Unexpected extension version' }

$engineSource = Join-Path $PSScriptRoot 'stove-100.js'
$enginePackage = Join-Path $extension 'engine.js'
if ((Get-FileHash $engineSource).Hash -ne (Get-FileHash $enginePackage).Hash) {
    throw 'Run stove100-build.cjs before packaging the installer.'
}

$compiler = Join-Path $env:windir 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
$output = Join-Path $PSScriptRoot "FullAuto100-Setup-v$version.exe"
$resources = foreach ($name in @('manifest.json','background.js','bridge.js','update.js','engine.js','popup.html','popup.js','사용방법.md')) {
    "/resource:$(Join-Path $extension $name),payload.$name"
}
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/out:$output" $resources (Join-Path $PSScriptRoot 'stove100-setup.cs')
if ($LASTEXITCODE) { throw 'Installer compilation failed.' }
Get-Item -LiteralPath $output
