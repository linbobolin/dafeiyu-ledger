# ============================================================
#  用 GitHub REST API 发布「大肥鱼记账本」——不需要安装 git
#
#  用法：
#     powershell -ExecutionPolicy Bypass -File .\tools\publish-api.ps1 `
#         -Token "ghp_xxx" `
#         -Owner "你的GitHub用户名" `
#         -Repo  "dafeiyu-ledger"
#
#  加 -Private 可以建私有仓库；加 -Tag "v1.8.0" 会同时创建一个 Release
#  并把 dist 里的 APK 作为附件上传。
#
#  ⚠️ 两条硬性安全规则：
#     1. 脚本会强制检查 ledger.keystore 有没有被上传，发现就中止
#     2. Token 用完请立刻到 GitHub 设置里撤销
# ============================================================
param(
    [Parameter(Mandatory = $true)][string]$Token,
    [Parameter(Mandatory = $true)][string]$Owner,
    [string]$Repo = "dafeiyu-ledger",
    [string]$Branch = "main",
    [string]$Tag = "",
    [string]$ReleaseNote = "",
    [switch]$Private
)

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Api = "https://api.github.com"
$Headers = @{
    'Authorization'        = "Bearer $Token"
    'Accept'               = 'application/vnd.github+json'
    'User-Agent'           = 'dafeiyu-publish'
    'X-GitHub-Api-Version' = '2022-11-28'
}

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Info($m) { Write-Host "  $m" }
function Fail($m) { Write-Host "`n[中止] $m" -ForegroundColor Red; exit 1 }

function CallApi {
    param($Method, $Path, $Body, $ContentType = 'application/json')
    $uri = if ($Path -like 'http*') { $Path } else { "$Api$Path" }
    $p = @{ Method = $Method; Uri = $uri; Headers = $Headers; TimeoutSec = 120 }
    if ($Body -ne $null) {
        if ($ContentType -eq 'application/json') {
            # 必须自己转成 UTF-8 字节再发。
            # PowerShell 5.1 直接传字符串时按 ISO-8859-1 编码，中文会被弄坏，
            # GitHub 会返回 400 且响应体为空，非常难查。
            $json = ($Body | ConvertTo-Json -Depth 20 -Compress)
            $p['Body'] = [System.Text.Encoding]::UTF8.GetBytes($json)
            $p['ContentType'] = 'application/json; charset=utf-8'
        } else {
            $p['Body'] = $Body
            $p['ContentType'] = $ContentType
        }
    }
    try { return Invoke-RestMethod @p }
    catch {
        $detail = $_.Exception.Message
        try {
            $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $detail = $sr.ReadToEnd()
        } catch { }
        throw "API $Method $Path 失败：$detail"
    }
}

# ---------------------------------------------------------- 目录排除规则
# 对应 .gitignore，但只做「够用」的匹配
$ExcludeDirs = @('build', 'node_modules', '.git', '__pycache__', '.tools', '.vscode', '.idea')
$ExcludeFilePatterns = @('*.keystore', '*.jks', '*.p12', '*.pem', '*.key',
                         '*.idsig', '*.log', '*.tmp', 'Thumbs.db', 'Desktop.ini', '.DS_Store')

function Test-Excluded([string]$rel) {
    $parts = $rel -split '[\\/]'
    foreach ($p in $parts) {
        if ($ExcludeDirs -contains $p) { return $true }
    }
    $leaf = $parts[-1]
    foreach ($pat in $ExcludeFilePatterns) {
        if ($leaf -like $pat) { return $true }
    }
    return $false
}

# ---------------------------------------------------------- 1. 校验 Token
Step "校验 Token"
$me = CallApi 'GET' '/user'
Info "已登录：$($me.login)"
if ($Owner -ne $me.login) {
    Info "提示：-Owner 是「$Owner」，而 Token 属于「$($me.login)」。"
    Info "      往别人的仓库推送需要相应权限，通常应该保持两者一致。"
}

# ---------------------------------------------------------- 2. 安全门
Step "检查签名密钥"
$leaks = Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '\.(keystore|jks|p12|pem|key)$' -and -not (Test-Excluded $_.FullName.Replace("$Root\", '')) }
if ($leaks) {
    Fail @"
下列密钥文件会被上传，提交出去就泄漏了：

$($leaks | ForEach-Object { '  ' + $_.FullName.Replace("$Root\", '') } | Out-String)

请先把它们移出仓库目录，或加进 .gitignore / 排除规则。
"@
}
Info "没有发现会被上传的密钥文件。"

# ---------------------------------------------------------- 3. 创建仓库
Step "创建仓库 $Owner/$Repo"
$repoExists = $true
try { $null = CallApi 'GET' "/repos/$Owner/$Repo" }
catch { $repoExists = $false }

if ($repoExists) {
    Info "仓库已存在，直接往里推。"
} else {
    $body = @{
        name           = $Repo
        private        = [bool]$Private
        description    = "大肥鱼记账本 · 安卓记账应用（自签名侧载，无需 Gradle）"
        has_issues     = $true
        has_wiki       = $false
        auto_init      = $false
    }
    $r = CallApi 'POST' '/user/repos' $body
    Info "已创建：$($r.html_url)"
}

# ---------------------------------------------------------- 3.5 引导空仓库
# 空仓库（没有任何提交）是**不能用** Git Data API 的：
# POST /git/blobs 会返回 409 Conflict，而且响应体是空的，很难查。
# 所以先用 Contents API 建一个初始提交，把仓库「激活」。
Step "确认仓库已初始化"
$needBootstrap = $true
try {
    $null = CallApi 'GET' "/repos/$Owner/$Repo/git/ref/heads/$Branch"
    $needBootstrap = $false
    Info "分支 $Branch 已存在，跳过引导"
} catch {
    Info "分支 $Branch 还不存在，需要先建一个初始提交"
}

if ($needBootstrap) {
    $seed = "本仓库的初始提交。真正的文件由 tools/publish-api.ps1 一次性推入。`n"
    $seedB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($seed))
    $null = CallApi 'PUT' "/repos/$Owner/$Repo/contents/.bootstrap" @{
        message = "初始化仓库"
        content = $seedB64
        branch  = $Branch
    }
    Info "已建立初始提交"
}

# ---------------------------------------------------------- 4. 收集文件
Step "收集要上传的文件"
$files = Get-ChildItem -Recurse -File | Where-Object {
    -not (Test-Excluded $_.FullName.Replace("$Root\", ''))
}
Info "共 $($files.Count) 个文件，合计 $([math]::Round(($files | Measure-Object Length -Sum).Sum / 1MB, 2)) MB"

# ---------------------------------------------------------- 5. 上传 blob
Step "上传文件内容（blob）"
$treeItems = New-Object System.Collections.ArrayList
$i = 0
foreach ($f in $files) {
    $i++
    $rel = $f.FullName.Replace("$Root\", '').Replace('\', '/')
    if ($i % 25 -eq 0 -or $i -eq $files.Count) {
        Write-Host "    $i / $($files.Count)" -ForegroundColor DarkGray
    }
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    $b64 = [Convert]::ToBase64String($bytes)
    $blob = CallApi 'POST' "/repos/$Owner/$Repo/git/blobs" @{ content = $b64; encoding = 'base64' }
    $null = $treeItems.Add(@{ path = $rel; mode = '100644'; type = 'blob'; sha = $blob.sha })
}
Info "已上传 $($treeItems.Count) 个 blob"

# ---------------------------------------------------------- 6. 建 tree / commit / ref
Step "创建目录树与提交"
$tree = CallApi 'POST' "/repos/$Owner/$Repo/git/trees" @{ tree = $treeItems }
Info "tree: $($tree.sha)"

$parents = @()
try {
    $ref = CallApi 'GET' "/repos/$Owner/$Repo/git/ref/heads/$Branch"
    $parents = @($ref.object.sha)
    Info "基于已有提交 $($ref.object.sha.Substring(0,7))"
} catch { Info "分支还不存在，创建首个提交" }

$msg = "大肥鱼记账本 v1.7.0"
$commitBody = @{ message = $msg; tree = $tree.sha }
if ($parents.Count -gt 0) { $commitBody['parents'] = $parents }
$commit = CallApi 'POST' "/repos/$Owner/$Repo/git/commits" $commitBody
Info "commit: $($commit.sha.Substring(0,7))"

if ($parents.Count -gt 0) {
    $null = CallApi 'PATCH' "/repos/$Owner/$Repo/git/refs/heads/$Branch" @{
        sha = $commit.sha; force = $false
    }
} else {
    $null = CallApi 'POST' "/repos/$Owner/$Repo/git/refs" @{
        ref = "refs/heads/$Branch"; sha = $commit.sha
    }
}
Info "分支 $Branch 已更新"

# ---------------------------------------------------------- 7. 可选：发 Release
$repoUrl = "https://github.com/$Owner/$Repo"
if ($Tag) {
    Step "创建 Release $Tag"
    $note = $ReleaseNote
    if (-not $note) { $note = "大肥鱼记账本 $Tag" }
    $rel = CallApi 'POST' "/repos/$Owner/$Repo/releases" @{
        tag_name = $Tag
        name     = $Tag
        body     = $note
        draft    = $false
        prerelease = $false
    }
    Info "Release 已创建：$($rel.html_url)"

    $apks = Get-ChildItem (Join-Path $Root 'dist') -Filter '*.apk' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending
    if ($apks) {
        $apk = $apks[0]
        Info "上传附件 $($apk.Name) ..."
        $upUrl = ($rel.upload_url -replace '\{.*$', '') + "?name=$([uri]::EscapeDataString($apk.Name))"
        $upHeaders = $Headers.Clone()
        $upHeaders['Content-Type'] = 'application/vnd.android.package-archive'
        try {
            $null = Invoke-RestMethod -Method Post -Uri $upUrl -Headers $upHeaders `
                        -InFile $apk.FullName -TimeoutSec 900
            Info "附件上传完成"
        } catch {
            Info "附件上传失败（不影响仓库内容）：$($_.Exception.Message)"
            Info "可以到 Release 页面手动拖上去：$($rel.html_url)"
        }
    }
}

Write-Host "`n发布完成。" -ForegroundColor Green
Write-Host "仓库地址：$repoUrl" -ForegroundColor Green
if ($Tag) { Write-Host "Release ：$repoUrl/releases" -ForegroundColor Green }
Write-Host "`n记得去 GitHub 设置里撤销刚才用的 Token。" -ForegroundColor Yellow
