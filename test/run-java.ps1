# ============================================================
#  运行 PayParser（微信/支付宝通知解析）的单元测试
#
#  PayParser 不依赖任何 Android 类，所以用普通 javac 编译即可，
#  不需要模拟器、不需要 Android SDK。
#
#  用法： powershell -ExecutionPolicy Bypass -File .\test\run-java.ps1
# ============================================================
param(
    [string]$Jdk = ""
)

$ErrorActionPreference = 'Continue'

$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = (Get-Location).Path }

function Get-JavaMajor([string]$javaExe) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $major = 0
    try {
        $out = (& $javaExe -version 2>&1 | Out-String)
        if ($out -match 'version "(\d+)') { $major = [int]$Matches[1] }
        elseif ($out -match 'version "1\.(\d+)') { $major = [int]$Matches[1] }
    } catch { $major = 0 }
    $ErrorActionPreference = $old
    return $major
}

# --- 找 JDK ---
$jdkHome = ""
$candidates = @()
if ($Jdk) { $candidates += $Jdk }
if ($env:JAVA_HOME) { $candidates += $env:JAVA_HOME }
foreach ($base in @("$env:ProgramFiles\Java", "$env:ProgramFiles\Eclipse Adoptium",
                    "$env:ProgramFiles\Microsoft", "$env:ProgramFiles\Amazon Corretto")) {
    if (Test-Path $base) {
        Get-ChildItem $base -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match 'jdk|temurin|corretto' } |
            ForEach-Object { $candidates += $_.FullName }
    }
}
foreach ($h in $candidates) {
    $javac = Join-Path $h 'bin\javac.exe'
    $java  = Join-Path $h 'bin\java.exe'
    if ((Test-Path $javac) -and (Test-Path $java)) { $jdkHome = $h; break }
}
if (-not $jdkHome) {
    Write-Host "[错误] 没找到 JDK，请用 -Jdk 指定 JDK 目录" -ForegroundColor Red
    exit 1
}

$javac = Join-Path $jdkHome 'bin\javac.exe'
$java  = Join-Path $jdkHome 'bin\java.exe'

$outDir = Join-Path $env:TEMP 'ledger-paytest'
if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Write-Host "编译解析器与测试 ..." -ForegroundColor Cyan
$src = @(
    (Join-Path $Root 'android\java\com\ledgerbook\app\PayParser.java'),
    (Join-Path $PSScriptRoot 'PayParserTest.java')
)
& $javac -encoding UTF-8 -d $outDir @src
if (-not (Test-Path (Join-Path $outDir 'PayParserTest.class'))) {
    Write-Host "[错误] 编译失败" -ForegroundColor Red
    exit 1
}

Write-Host "运行测试 ...`n" -ForegroundColor Cyan
# 用数组展开传参，避免 PowerShell 把 -Dfile.encoding=UTF-8 拆成两段
$jvmArgs = @('-Dfile.encoding=UTF-8', '-cp', $outDir, 'PayParserTest')
& $java @jvmArgs
$code = $LASTEXITCODE

Remove-Item -Recurse -Force $outDir -ErrorAction SilentlyContinue

if ($code -eq 0) {
    Write-Host "`n解析器测试全部通过。" -ForegroundColor Green
} else {
    Write-Host "`n解析器测试有失败项。" -ForegroundColor Red
}
exit $code
