param([switch]$Publish)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$manifest = Get-Content outputs/stove100-background/manifest.json -Raw | ConvertFrom-Json
$version = $manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version' }
if ($Publish) {
    if (git status --porcelain) { throw 'Commit changes before publishing.' }
    git show-ref --verify --quiet "refs/tags/v$version"
    if ($LASTEXITCODE -eq 0) { throw 'Tag already exists.' }
}
node outputs/stove100-build.cjs
if ($LASTEXITCODE) { throw 'Engine build failed' }
& ./outputs/stove100-setup-build.ps1
$null = New-Item -ItemType Directory -Path dist -Force
$exe = "FullAuto100-Setup-v$version.exe"
$zip = "FullAuto100-Extension-v$version.zip"
Copy-Item -LiteralPath "outputs/$exe" -Destination "dist/$exe" -Force
Compress-Archive -Path outputs/stove100-background/* -DestinationPath "dist/$zip" -Force
$sums = foreach ($name in @($exe,$zip)) {
    ((Get-FileHash -LiteralPath "dist/$name" -Algorithm SHA256).Hash.ToLowerInvariant()) + "  $name"
}
[IO.File]::WriteAllLines((Join-Path (Get-Location) 'dist/SHA256SUMS.txt'), $sums, [Text.UTF8Encoding]::new($false))
if ($Publish) {
    $body = Join-Path (Get-Location) 'dist/release-notes.md'
    [IO.File]::WriteAllText($body, @"
Windows 설치 도우미와 크롬 확장 프로그램 $version.

- 확장 팝업과 설치 도우미에서 새 버전 확인 및 설치 파일 다운로드
- 설치 도우미의 업데이트 파일 SHA-256 검증 및 기존 설치 경로 전달
- 미션 먼저 처리, 누적 캡슐 보상, 완료 창, 재확인과 최근 5회 로그

EXE에서 폴더를 선택해 설치하고 처음 한 번 크롬의 '압축해제된 확장 프로그램을 로드합니다'로 등록하세요.
업데이트는 같은 폴더에 설치한 뒤 기존 확장 항목을 새로고침하세요.
EXE는 디지털 서명 없이 배포됩니다.
"@, [Text.UTF8Encoding]::new($false))
    git tag "v$version"
    if ($LASTEXITCODE) { throw 'Tag creation failed' }
    git push origin main "v$version"
    if ($LASTEXITCODE) { throw 'Push failed' }
    gh release create "v$version" "dist/$exe" "dist/$zip" dist/SHA256SUMS.txt --repo LibraLightLuda/FullAuto100 --title "FullAuto100 v$version" --notes-file $body --latest
    if ($LASTEXITCODE) { throw 'Release upload failed' }
}
Get-ChildItem dist -File
