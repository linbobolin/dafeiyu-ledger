# ============================================================
#  把「大肥鱼记账本」发布到 GitHub
#
#  用法：
#     powershell -ExecutionPolicy Bypass -File .\tools\publish.ps1 `
#         -RepoUrl "https://github.com/<你的用户名>/dafeiyu-ledger.git"
#
#  首次运行会：检查环境 -> 初始化仓库 -> 确认密钥未被提交 -> 提交 -> 推送
#
#  ⚠️ 这个脚本会在推送前**强制检查** ledger.keystore 有没有被提交，
#     一旦发现就直接中止。签名密钥泄漏意味着别人能签出冒充你应用的安装包。
# ============================================================
param(
    [Parameter(Mandatory = $true)][string]$RepoUrl,
    [string]$Branch = "main",
    [string]$Message = "",
    [switch]$Force
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Fail($msg) { Write-Host "`n[中止] $msg" -ForegroundColor Red; exit 1 }
function Info($msg) { Write-Host "  $msg" }
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# ---------------------------------------------------------- 环境检查
Step "检查 git"
$git = (Get-Command git -ErrorAction SilentlyContinue)
if (-not $git) {
    Fail @"
没有找到 git。

先装 Git for Windows：https://git-scm.com/download/win
装完**重新打开一个终端**再运行本脚本（PATH 需要刷新）。
"@
}
Info "git: $((& git --version))"

Step "检查签名密钥是否会被提交"
# 这是最关键的一步：密钥绝不能进仓库
$dangerous = @()
foreach ($f in @('ledger.keystore')) {
    if (Test-Path $f) { $dangerous += $f }
}
Get-ChildItem -Recurse -File -Include *.keystore, *.jks, *.p12 -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notlike "*\build\*" } |
    ForEach-Object { $dangerous += $_.FullName.Replace("$Root\", '') }

$dangerous = $dangerous | Sort-Object -Unique

if ($dangerous.Count -gt 0) {
    if (-not (Test-Path '.gitignore')) {
        Fail ".gitignore 不存在，无法确认密钥会被忽略。"
    }
    $ignored = & git check-ignore $dangerous 2>$null
    $leaked = $dangerous | Where-Object { $ignored -notcontains $_ }
    if ($leaked.Count -gt 0) {
        Fail @"
以下密钥文件**不会被 .gitignore 忽略**，提交出去就泄漏了：

$($leaked -join "`n")

请先把它们加进 .gitignore，或移到仓库目录之外。
"@
    }
    Info "签名密钥已被 .gitignore 忽略，安全。"
}

# ---------------------------------------------------------- 初始化
Step "初始化仓库"
if (-not (Test-Path '.git')) {
    & git init -b $Branch 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { & git init 2>&1 | Out-Null }
    Info "已初始化"
} else {
    Info "仓库已存在"
}

& git symbolic-ref HEAD "refs/heads/$Branch" 2>&1 | Out-Null

Info "配置 user.name / user.email（只对本仓库生效）"
$name = & git config user.name
if (-not $name) { & git config user.name "dafeiyu" ; Info "  user.name 设为 dafeiyu" }
$mail = & git config user.email
if (-not $mail) { & git config user.email "dafeiyu@users.noreply.github.com"; Info "  user.email 设为占位地址" }

# ---------------------------------------------------------- 暂存
Step "暂存文件"
& git add -A

$staged = & git diff --cached --name-only
if (-not $staged) {
    Info "没有需要提交的改动"
} else {
    Info "共 $($staged.Count) 个文件"
    # 再确认一次暂存区里没有密钥
    $bad = $staged | Where-Object { $_ -match '\.(keystore|jks|p12|pem|key)$' }
    if ($bad) { Fail "暂存区里出现了密钥文件：`n$($bad -join "`n")" }
}

# ---------------------------------------------------------- 提交
Step "提交"
if (-not $Message) { $Message = "大肥鱼记账本 v1.7.0" }
$hasCommit = (& git rev-parse --verify HEAD 2>$null)
if ($staged) {
    & git commit -m $Message 2>&1 | ForEach-Object { Info $_ }
} elseif (-not $hasCommit) {
    & git commit --allow-empty -m $Message 2>&1 | ForEach-Object { Info $_ }
} else {
    Info "工作区干净，跳过提交"
}

# ---------------------------------------------------------- 推送
Step "关联远端并推送"
$remote = & git remote get-url origin 2>$null
if ($remote) {
    Info "origin 已存在：$remote"
    if ($remote -ne $RepoUrl -and $Force) { & git remote set-url origin $RepoUrl; Info "已更新为 $RepoUrl" }
} else {
    & git remote add origin $RepoUrl
    Info "已添加 origin：$RepoUrl"
}

Info "推送到 origin/$Branch ..."
& git push -u origin $Branch 2>&1 | ForEach-Object { Info $_ }

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n发布完成。" -ForegroundColor Green
    Write-Host "仓库地址：$($RepoUrl -replace '\.git$','')" -ForegroundColor Green
} else {
    Write-Host "`n推送失败。常见原因：" -ForegroundColor Yellow
    Write-Host "  · 还没在 GitHub 上创建这个仓库（先在网页上建一个空仓库，不要勾选 README）"
    Write-Host "  · 没有登录凭据（会让用浏览器登录，或改用 SSH 地址）"
    Write-Host "  · 远端已有提交，需要先 git pull --rebase"
}
