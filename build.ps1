# ============================================================
#  记账本 —— 一键构建 APK
#
#  不依赖 Android Studio / Gradle，直接调用 Android SDK 命令行工具：
#     aapt2 compile  ->  aapt2 link  ->  javac  ->  d8  ->  注入 dex
#     ->  zipalign   ->  apksigner 签名
#
#  用法（在 LedgerApp 目录下）：
#     pwsh -File .\build.ps1
#     pwsh -File .\build.ps1 -Toolchain "D:\android-sdk"
#     pwsh -File .\build.ps1 -Clean -SkipIcons
# ============================================================
[CmdletBinding()]
param(
    # Android SDK 根目录（需包含 build-tools 与 platforms）。
    # 不填则自动在常见位置查找。
    [string]$Toolchain = "",
    [switch]$Clean,
    [switch]$SkipIcons,
    [string]$VersionName = "1.7.0",
    [int]$VersionCode = 8,
    [int]$MinSdk = 24,
    [int]$TargetSdk = 34
)

# 注意：这里刻意使用 Continue 而不是 Stop。
# 原因：java / aapt2 / d8 等原生程序会把正常信息写到 stderr，
# 在 Stop 模式下 PowerShell 会把这些当成终止性错误。
# 因此所有关键步骤都显式检查 $LASTEXITCODE。
$ErrorActionPreference = 'Continue'
# 不修改 [Console]::OutputEncoding：保持控制台默认编码，
# 这样 javac / aapt2 等工具输出的中文提示才不会变成乱码。

$Root    = $PSScriptRoot
$Android = Join-Path $Root 'android'
$Build   = Join-Path $Root 'build'
$Dist    = Join-Path $Root 'dist'
$Tools   = Join-Path $Root 'tools'

$ApkName = "LedgerBook-v$VersionName.apk"

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }
function Die($msg)  { Write-Host "`n[错误] $msg" -ForegroundColor Red; exit 1 }

function Find-First {
    param([string]$Dir, [string]$Filter)
    if (-not (Test-Path $Dir)) { return $null }
    $f = Get-ChildItem -Path $Dir -Recurse -Filter $Filter -File -ErrorAction SilentlyContinue |
         Select-Object -First 1
    if ($f) { return $f.FullName }
    return $null
}

# ---------------------------------------------------------- 1. 定位工具链

Step "定位 Android 构建工具"

$candidates = @()
if ($Toolchain) { $candidates += $Toolchain }
if ($env:ANDROID_SDK_ROOT) { $candidates += $env:ANDROID_SDK_ROOT }
if ($env:ANDROID_HOME)     { $candidates += $env:ANDROID_HOME }
$candidates += (Join-Path $Root '.toolchain')
$candidates += 'G:\FeverApps\android-build'
$candidates += 'C:\Users\DELL\android-build'
$candidates += "$env:LOCALAPPDATA\Android\Sdk"
$candidates += 'C:\Android\Sdk'

$SdkRoot = $null
foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) {
        $probe = Find-First -Dir $c -Filter 'aapt2.exe'
        if ($probe) { $SdkRoot = (Resolve-Path $c).Path; break }
    }
}
if (-not $SdkRoot) {
    Die @"
未找到 Android SDK 构建工具（aapt2.exe）。
请任选一种方式：
  1) 用 -Toolchain 指定 SDK 目录，例如：
       pwsh -File .\build.ps1 -Toolchain "D:\android-sdk"
  2) 设置环境变量 ANDROID_SDK_ROOT
  3) 把 SDK 解压到 $Root\.toolchain
     （需要 build-tools 与 platforms/android-<API> 两部分）
"@
}

$aapt2        = Find-First -Dir $SdkRoot -Filter 'aapt2.exe'
$zipalign     = Find-First -Dir $SdkRoot -Filter 'zipalign.exe'
$d8Jar        = Find-First -Dir $SdkRoot -Filter 'd8.jar'
$apksignerJar = Find-First -Dir $SdkRoot -Filter 'apksigner.jar'

# 选择 API 版本最高的 android.jar
$androidJar = Get-ChildItem -Path $SdkRoot -Recurse -Filter 'android.jar' -File -ErrorAction SilentlyContinue |
    ForEach-Object {
        $api = 0
        if ($_.Directory.Parent.Name -match '(\d+)') { $api = [int]$Matches[1] }
        elseif ($_.Directory.Name -match '(\d+)')   { $api = [int]$Matches[1] }
        [pscustomobject]@{ Path = $_.FullName; Api = $api }
    } | Sort-Object Api -Descending | Select-Object -First 1

if (-not $aapt2)        { Die "缺少 aapt2.exe（需要 build-tools）" }
if (-not $zipalign)     { Die "缺少 zipalign.exe（需要 build-tools）" }
if (-not $d8Jar)        { Die "缺少 d8.jar（需要 build-tools\lib）" }
if (-not $apksignerJar) { Die "缺少 apksigner.jar（需要 build-tools\lib）" }
if (-not $androidJar)   { Die "缺少 android.jar（需要 platforms\android-<API>）" }

Ok "SDK      : $SdkRoot"
Ok "aapt2    : $aapt2"
Ok "android  : $($androidJar.Path)  (API $($androidJar.Api))"

# ---------------------------------------------------------- 2. 定位 JDK

Step "定位 JDK（需要 11 或更高版本）"

function Get-JavaMajor([string]$javaExe) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $major = 0
    try {
        $out = (& $javaExe -version 2>&1 | Out-String)
        if ($out -match 'version "(\d+)') { $major = [int]$Matches[1] }
        elseif ($out -match 'version "1\.(\d+)') { $major = [int]$Matches[1] }
    } catch {
        $major = 0
    }
    $ErrorActionPreference = $old
    return $major
}

$jdkHomes = @()
if ($env:JAVA_HOME) { $jdkHomes += $env:JAVA_HOME }
foreach ($base in @("$env:ProgramFiles\Java", "$env:ProgramFiles\Eclipse Adoptium",
                    "$env:ProgramFiles\Microsoft", "$env:ProgramFiles\Amazon Corretto",
                    "$env:LOCALAPPDATA\Programs\Eclipse Adoptium")) {
    if (Test-Path $base) {
        Get-ChildItem $base -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match 'jdk|jre|temurin|corretto' } |
            ForEach-Object { $jdkHomes += $_.FullName }
    }
}

$Jdk = $null
foreach ($h in $jdkHomes) {
    $javac = Join-Path $h 'bin\javac.exe'
    $java  = Join-Path $h 'bin\java.exe'
    if ((Test-Path $javac) -and (Test-Path $java)) {
        $major = Get-JavaMajor $java
        if ($major -ge 11) { $Jdk = $h; break }
    }
}
if (-not $Jdk) {
    Die @"
未找到 JDK 11+。请安装 JDK 17/20/21 后重试，或设置 JAVA_HOME。
注意：Android 的 d8 / apksigner 需要 JDK 11 以上，JDK 8 无法使用。
"@
}

$Java  = Join-Path $Jdk 'bin\java.exe'
$Javac = Join-Path $Jdk 'bin\javac.exe'
$Keytool = Join-Path $Jdk 'bin\keytool.exe'

Ok "JDK      : $Jdk (Java $(Get-JavaMajor $Java))"

# ---------------------------------------------------------- 3. 定位 Node（可选）

$Node = $null
foreach ($c in @($env:NODE_EXE, 'G:\node.exe')) {
    if ($c -and (Test-Path $c)) { $Node = $c; break }
}
if (-not $Node) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $Node = $cmd.Source }
}

# ---------------------------------------------------------- 4. 清理

if ($Clean -and (Test-Path $Build)) {
    Step "清理构建目录"
    Remove-Item -Recurse -Force $Build
    Ok "已清理 $Build"
}
New-Item -ItemType Directory -Force -Path $Build, $Dist | Out-Null

# ---------------------------------------------------------- 5. 图标

if (-not $SkipIcons) {
    if ($Node) {
        Step "生成应用图标"
        & $Node (Join-Path $Tools 'make-icons.js') $Android
        if ($LASTEXITCODE -ne 0) { Die "图标生成失败" }
    } else {
        Warn "未找到 Node.js，跳过图标生成（将使用已有图标）"
    }
}

# ---------------------------------------------------------- 6. aapt2 compile

Step "编译资源 (aapt2 compile)"
$ResZip = Join-Path $Build 'resources.zip'
& $aapt2 compile --dir (Join-Path $Android 'res') -o $ResZip
if ($LASTEXITCODE -ne 0) { Die "aapt2 compile 失败" }
Ok "资源已编译 -> $ResZip"

# ---------------------------------------------------------- 7. aapt2 link

Step "链接资源与清单 (aapt2 link)"
$BaseApk = Join-Path $Build 'base.apk'
$GenDir  = Join-Path $Build 'gen'
New-Item -ItemType Directory -Force -Path $GenDir | Out-Null

# 注意：这里刻意【不用】 aapt2 的 -A 参数来打包 assets。
# 原因：aapt2 在 Windows 上会把 asset 条目名写成反斜杠
# （assets/www\js\app.js），而 Android 只认正斜杠，
# 会导致 WebView 完全加载不到页面。assets 改由 apkpack.js 注入。
& $aapt2 link `
    -o $BaseApk `
    -I $androidJar.Path `
    --manifest (Join-Path $Android 'AndroidManifest.xml') `
    --java $GenDir `
    --min-sdk-version $MinSdk `
    --target-sdk-version $TargetSdk `
    --version-code $VersionCode `
    --version-name $VersionName `
    --no-version-vectors `
    $ResZip
if ($LASTEXITCODE -ne 0) { Die "aapt2 link 失败" }
if (-not (Test-Path $BaseApk)) { Die "未生成 base.apk" }
Ok "已生成 $BaseApk"

# ---------------------------------------------------------- 8. javac

Step "编译 Java 源码 (javac)"
$ClassesDir = Join-Path $Build 'classes'
New-Item -ItemType Directory -Force -Path $ClassesDir | Out-Null

$sources = @()
$sources += (Get-ChildItem -Path (Join-Path $Android 'java') -Recurse -Filter '*.java' -File |
             ForEach-Object { $_.FullName })
$sources += (Get-ChildItem -Path $GenDir -Recurse -Filter '*.java' -File |
             ForEach-Object { $_.FullName })

if ($sources.Count -eq 0) { Die "没有找到任何 Java 源文件" }

# javac 的 @参数文件会把反斜杠当成转义字符，
# 所以写入前统一把 Windows 路径换成正斜杠。
function To-Slash([string]$p) { return ($p -replace '\\', '/') }

$argFile = Join-Path $Build 'javac.args'
$argList = @()
$argList += '-source'; $argList += '8'
$argList += '-target'; $argList += '8'
$argList += '-nowarn'
$argList += '-encoding'; $argList += 'UTF-8'
$argList += '-bootclasspath'; $argList += "`"$(To-Slash $androidJar.Path)`""
$argList += '-classpath';    $argList += "`"$(To-Slash $androidJar.Path)`""
$argList += '-d';            $argList += "`"$(To-Slash $ClassesDir)`""
foreach ($s in $sources) { $argList += "`"$(To-Slash $s)`"" }
Set-Content -Path $argFile -Value $argList -Encoding ASCII

& $Javac "@$argFile"
if ($LASTEXITCODE -ne 0) { Die "javac 编译失败" }

$classCount = (Get-ChildItem -Path $ClassesDir -Recurse -Filter '*.class' -File).Count
Ok "已编译 $classCount 个 class 文件"

# ---------------------------------------------------------- 9. d8

Step "转换为 DEX (d8)"
$DexDir = Join-Path $Build 'dex'
New-Item -ItemType Directory -Force -Path $DexDir | Out-Null

$classFiles = Get-ChildItem -Path $ClassesDir -Recurse -Filter '*.class' -File |
              ForEach-Object { $_.FullName }

& $Java -cp $d8Jar com.android.tools.r8.D8 `
    --release `
    --min-api $MinSdk `
    --lib $androidJar.Path `
    --output $DexDir `
    $classFiles
if ($LASTEXITCODE -ne 0) { Die "d8 转换失败" }

$dexFile = Join-Path $DexDir 'classes.dex'
if (-not (Test-Path $dexFile)) { Die "未生成 classes.dex" }
Ok ("classes.dex  " + [math]::Round((Get-Item $dexFile).Length / 1KB, 1) + " KB")

# ---------------------------------------------------------- 10. 打包 assets + dex

Step "注入网页资源与 classes.dex"
if (-not $Node) {
    Die @"
本步骤必须使用 Node.js（tools\apkpack.js）。
请安装 Node.js 后重试，或用 -Toolchain 之外的方式设置 NODE_EXE 环境变量指向 node.exe。
"@
}

$WithDex = Join-Path $Build 'withdex.apk'
$assetsSpec = "$(Join-Path $Android 'assets'):assets"
$dexSpec = "classes.dex:$dexFile"

& $Node (Join-Path $Tools 'apkpack.js') $BaseApk $WithDex --assets $assetsSpec --add $dexSpec
if ($LASTEXITCODE -ne 0) { Die "apkpack 打包失败" }
Ok "资源与 dex 已注入 -> $WithDex"

# ---------------------------------------------------------- 11. zipalign

Step "对齐 (zipalign)"
$Aligned = Join-Path $Build 'aligned.apk'
& $zipalign -f -p 4 $WithDex $Aligned
if ($LASTEXITCODE -ne 0) { Die "zipalign 失败" }

& $zipalign -c -p -v 4 $Aligned | Out-Null
if ($LASTEXITCODE -ne 0) { Warn "zipalign 校验未通过，但仍会继续签名" }
else { Ok "4 字节对齐校验通过" }

# ---------------------------------------------------------- 12. 签名

Step "签名 APK (apksigner)"
$Keystore = Join-Path $Root 'ledger.keystore'
$KsPass   = 'ledger123'
$KsAlias  = 'ledger'

if (-not (Test-Path $Keystore)) {
    Warn "未找到签名证书，正在生成自签名证书..."
    & $Keytool -genkeypair -v `
        -keystore $Keystore `
        -alias $KsAlias `
        -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass $KsPass -keypass $KsPass `
        -dname "CN=Ledger Book, OU=Personal, O=LedgerBook, L=Beijing, ST=Beijing, C=CN" | Out-Null
    if ($LASTEXITCODE -ne 0) { Die "生成签名证书失败" }
    Ok "已生成 $Keystore （口令 $KsPass / 别名 $KsAlias）"
}

$OutApk = Join-Path $Dist $ApkName
if (Test-Path $OutApk) { Remove-Item $OutApk -Force }

& $Java -jar $apksignerJar sign `
    --ks $Keystore `
    --ks-key-alias $KsAlias `
    --ks-pass "pass:$KsPass" `
    --key-pass "pass:$KsPass" `
    --v1-signing-enabled true `
    --v2-signing-enabled true `
    --out $OutApk `
    $Aligned
if ($LASTEXITCODE -ne 0) { Die "apksigner 签名失败" }
Ok "已签名 -> $OutApk"

# ---------------------------------------------------------- 13. 验证

Step "验证签名"
& $Java -jar $apksignerJar verify --verbose --print-certs $OutApk
if ($LASTEXITCODE -ne 0) { Die "签名验证失败" }

$size = [math]::Round((Get-Item $OutApk).Length / 1MB, 2)
Write-Host ""
Write-Host "===================================================" -ForegroundColor Green
Write-Host " 构建成功！" -ForegroundColor Green
Write-Host " APK : $OutApk"
Write-Host " 大小: $size MB"
Write-Host " 包名: com.ledgerbook.app"
Write-Host " 版本: $VersionName ($VersionCode)  minSdk=$MinSdk  targetSdk=$TargetSdk"
Write-Host "===================================================" -ForegroundColor Green
Write-Host ""
Write-Host "安装方式：把该 APK 传到手机，点击安装（需允许安装未知来源应用）。"
Write-Host ""

# 显式返回 0：前面原生工具写到 stderr 的提示会污染 $LASTEXITCODE
exit 0
